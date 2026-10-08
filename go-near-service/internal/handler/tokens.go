package handler

import (
	"net/http"

	"github.com/uprail/near-service/internal/oneclick"
)

// TokensHandler handles GET /internal/tokens.
type TokensHandler struct {
	client *oneclick.Client
}

// NewTokensHandler constructs a TokensHandler.
func NewTokensHandler(client *oneclick.Client) *TokensHandler {
	return &TokensHandler{client: client}
}

// ServeHTTP fetches supported tokens dynamically from the 1Click API.
func (h *TokensHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	tokens, err := h.client.GetTokens(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"tokens": tokens,
	})
}
