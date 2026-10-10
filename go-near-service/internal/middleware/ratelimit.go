package middleware

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// RateLimit throttles requests per client IP using a fixed one-minute window.
// It is intentionally process-local: this service is only reachable from the
// worker over the internal network, and the goal is to stop a runaway or
// compromised caller, not to provide distributed quotas. The client key is
// taken from RemoteAddr (the TCP peer) — never from spoofable headers.
func RateLimit(requestsPerMinute int) func(http.Handler) http.Handler {
	type window struct {
		count     int
		resetEach time.Time
	}
	var (
		mu      sync.Mutex
		windows = make(map[string]*window)
	)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
			if err != nil || ip == "" {
				ip = strings.TrimSpace(r.RemoteAddr)
			}
			if ip == "" {
				ip = "unknown"
			}

			now := time.Now()
			mu.Lock()
			win := windows[ip]
			if win == nil || now.After(win.resetEach) {
				win = &window{resetEach: now.Add(time.Minute)}
				windows[ip] = win
			}
			win.count++
			count := win.count
			reset := win.resetEach
			if len(windows) > 10000 {
				for k, existing := range windows {
					if now.After(existing.resetEach) {
						delete(windows, k)
					}
				}
			}
			mu.Unlock()

			remaining := requestsPerMinute - count
			if remaining < 0 {
				remaining = 0
			}
			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(requestsPerMinute))
			w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))

			if count > requestsPerMinute {
				retryAfter := int(time.Until(reset).Seconds()) + 1
				if retryAfter < 1 {
					retryAfter = 1
				}
				w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
				writeJSONError(w, http.StatusTooManyRequests, "too many requests", "RATE_LIMITED")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}