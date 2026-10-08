package handler

import (
	"encoding/json"
	"net/http"
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
