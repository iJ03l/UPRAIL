package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/uprail/near-service/internal/escrow"
)

// ErrorResponse represents standard error payload format.
type ErrorResponse struct {
	Error string `json:"error"`
}

// writeJSON serializes data as JSON and writes it to the response writer with the specified status code.
func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		_ = json.NewEncoder(w).Encode(data)
	}
}

// writeError writes a structured JSON error response.
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, ErrorResponse{Error: message})
}

// writeUpstreamError logs the real (possibly verbose) error server-side and
// returns only a generic message. Upstream failures embed third-party
// response bodies, which must never reach the client.
func writeUpstreamError(w http.ResponseWriter, scope string, err error) {
	slog.Error("upstream failure", "scope", scope, "error", err)
	writeError(w, http.StatusBadGateway, scope+" upstream failure")
}

// writeServiceError maps service errors onto HTTP statuses:
//   - escrow.ValidationError -> 400 (bad request, do not retry)
//   - escrow.ConflictError   -> 409 (idempotency conflict)
//   - everything else        -> 502 (settlement/upstream failure, message sanitized)
func writeServiceError(w http.ResponseWriter, err error) {
	var verr *escrow.ValidationError
	if errors.As(err, &verr) {
		writeError(w, http.StatusBadRequest, verr.Error())
		return
	}
	var cerr *escrow.ConflictError
	if errors.As(err, &cerr) {
		writeError(w, http.StatusConflict, cerr.Error())
		return
	}
	writeUpstreamError(w, "settlement", err)
}
