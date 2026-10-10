package middleware

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	headerSecret      = "X-Internal-Secret"
	headerTimestamp   = "X-Internal-Timestamp"
	headerNonce       = "X-Internal-Nonce"
	headerSignature   = "X-Internal-Signature"
	signatureVersion  = "v1"
	maxClockSkew      = 5 * time.Minute
	nonceCacheTTL     = 10 * time.Minute
	nonceCacheSweep   = time.Minute
	nonceCacheMaxSize = 10000
)

// requestSigner verifies signed internal requests.
//
// Auth model (fail closed):
//   - INTERNAL_SERVICE_KEY must be configured, otherwise every request is 503.
//   - Requests carry a timestamp, a single-use nonce and an HMAC-SHA256
//     signature over `v1.<ts>.<nonce>.<METHOD>.<path>.<sha256(body)>`.
//   - Timestamps outside ±5 minutes are rejected (bounds replay window).
//   - Nonces are single-use for 10 minutes (blocks replay of an identical
//     request even inside the clock-skew window).
//
// Because the signature covers the body, a captured signature cannot be
// replayed against a different payload.
type requestSigner struct {
	secret []byte
	clock  func() time.Time

	mu     sync.Mutex
	nonces map[string]time.Time
}

func newRequestSigner(secret string) *requestSigner {
	return &requestSigner{
		secret: []byte(strings.TrimSpace(secret)),
		clock:  time.Now,
		nonces: make(map[string]time.Time),
	}
}

func (s *requestSigner) expired(ts time.Time) bool {
	return time.Since(ts) > nonceCacheTTL
}

// consumeNonce records a nonce and returns false when it was already used.
// Best effort: when the cache is full the oldest entries are swept first, and
// the cache never grows beyond nonceCacheMaxSize.
func (s *requestSigner) consumeNonce(nonce string) bool {
	now := s.clock()

	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.nonces) >= nonceCacheMaxSize || len(s.nonces)%128 == 0 {
		for k, ts := range s.nonces {
			if now.Sub(ts) > nonceCacheTTL {
				delete(s.nonces, k)
			}
		}
		// Hard cap: drop arbitrary entries if the cache is still oversized.
		for k := range s.nonces {
			if len(s.nonces) <= nonceCacheMaxSize {
				break
			}
			delete(s.nonces, k)
		}
	}

	if _, seen := s.nonces[nonce]; seen {
		return false
	}
	s.nonces[nonce] = now
	return true
}

func canonicalBodyHash(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

func (s *requestSigner) signature(ts, nonce, method, path, bodyHash string) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(signatureVersion + "." + ts + "." + nonce + "." + method + "." + path + "." + bodyHash))
	return hex.EncodeToString(mac.Sum(nil))
}

// InternalAuth verifies signed internal requests and fails closed when no
// secret is configured.
func InternalAuth(secret string) func(http.Handler) http.Handler {
	cleanSecret := strings.TrimSpace(secret)
	if cleanSecret == "" {
		slog.Error("INTERNAL_SERVICE_KEY is empty — all /internal routes are disabled (fail closed)")
		return func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				writeJSONError(w, http.StatusServiceUnavailable,
					"internal service key is not configured", "SERVICE_NOT_CONFIGURED")
			})
		}
	}

	signer := newRequestSigner(cleanSecret)

	// Periodically drop expired nonces so the cache cannot grow unbounded.
	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(nonceCacheSweep)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				signer.mu.Lock()
				for k, ts := range signer.nonces {
					if signer.expired(ts) {
						delete(signer.nonces, k)
					}
				}
				signer.mu.Unlock()
			}
		}
	}()

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Read the full body once so the signature covers it, then restore
			// it for downstream handlers. Oversized bodies are rejected with
			// 413 — never silently truncated.
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, MaxRequestBodyBytes)
			}
			body, err := io.ReadAll(r.Body)
			if err != nil {
				var maxErr *http.MaxBytesError
				if errors.As(err, &maxErr) {
					writeJSONError(w, http.StatusRequestEntityTooLarge,
						"request body too large", "PAYLOAD_TOO_LARGE")
					return
				}
				writeJSONError(w, http.StatusBadRequest, "unable to read request body", "BAD_REQUEST")
				return
			}
			defer r.Body.Close()
			r.Body = io.NopCloser(strings.NewReader(string(body)))

			ts := strings.TrimSpace(r.Header.Get(headerTimestamp))
			nonce := strings.TrimSpace(r.Header.Get(headerNonce))
			sig := strings.TrimSpace(r.Header.Get(headerSignature))
			if ts == "" || nonce == "" || sig == "" {
				// A raw shared secret without a request signature is rejected:
				// it is replayable and body-agnostic.
				writeJSONError(w, http.StatusUnauthorized,
					"missing request signature headers", "UNAUTHORIZED")
				return
			}

			epoch, err := strconv.ParseInt(ts, 10, 64)
			if err != nil {
				writeJSONError(w, http.StatusUnauthorized, "invalid timestamp", "UNAUTHORIZED")
				return
			}
			if skew := absDiff(time.Now().Unix(), epoch); skew > int64(maxClockSkew.Seconds()) {
				writeJSONError(w, http.StatusUnauthorized, "request timestamp outside allowed window", "UNAUTHORIZED")
				return
			}

			expected := signer.signature(ts, nonce, r.Method, r.URL.Path, canonicalBodyHash(body))
			if subtle.ConstantTimeCompare([]byte(expected), []byte(strings.ToLower(sig))) != 1 {
				writeJSONError(w, http.StatusUnauthorized, "invalid request signature", "UNAUTHORIZED")
				return
			}

			if !signer.consumeNonce(nonce) {
				writeJSONError(w, http.StatusUnauthorized, "request nonce already used", "REPLAY_DETECTED")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func absDiff(a, b int64) int64 {
	if a > b {
		return a - b
	}
	return b - a
}

func writeJSONError(w http.ResponseWriter, status int, message, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write([]byte(`{"error":"` + message + `","code":"` + code + `"}`))
}
