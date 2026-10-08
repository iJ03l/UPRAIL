package middleware

import (
	"net/http"
	"strings"
)

// InternalAuth verifies that incoming requests contain a valid internal service secret,
// preventing unauthenticated direct access to internal intent/account microservices.
func InternalAuth(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cleanSecret := strings.TrimSpace(secret)
			if cleanSecret == "" {
				// If no secret configured in environment, permit for local standalone testing
				next.ServeHTTP(w, r)
				return
			}

			// Check X-Internal-Secret header
			if headerSecret := strings.TrimSpace(r.Header.Get("X-Internal-Secret")); headerSecret == cleanSecret {
				next.ServeHTTP(w, r)
				return
			}

			// Check Authorization: Bearer <secret>
			authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
			if strings.HasPrefix(authHeader, "Bearer ") {
				if token := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer ")); token == cleanSecret {
					next.ServeHTTP(w, r)
					return
				}
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"unauthorized: invalid or missing internal service secret","code":"UNAUTHORIZED"}`))
		})
	}
}
