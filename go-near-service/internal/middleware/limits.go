package middleware

import "net/http"

// MaxRequestBodyBytes caps every request body. This service only receives
// small JSON payloads from the worker; anything larger is abusive.
const MaxRequestBodyBytes = 1 << 20 // 1 MiB

// BodyLimit wraps every request body with http.MaxBytesReader so oversized
// payloads are rejected (handlers see the read error and answer 413/400)
// instead of being buffered without bound.
func BodyLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, MaxRequestBodyBytes)
		}
		next.ServeHTTP(w, r)
	})
}