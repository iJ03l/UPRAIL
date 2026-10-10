package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/uprail/near-service/internal/auth"
	"github.com/uprail/near-service/internal/intents"
)

// BalanceHandler handles POST /internal/balance.
type BalanceHandler struct {
	authService *auth.Service
}

// NewBalanceHandler constructs a BalanceHandler.
func NewBalanceHandler(service *auth.Service) *BalanceHandler {
	return &BalanceHandler{authService: service}
}

// BalanceRequestBody represents payload for checking balances.
type BalanceRequestBody struct {
	AccessToken  string              `json:"accessToken,omitempty"`
	RefreshToken string              `json:"refreshToken,omitempty"`
	SignedData   *intents.SignedData `json:"signedData,omitempty"`
}

// ServeHTTP handles requests to query user balances via session tokens or signed authentications.
func (h *BalanceHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req BalanceRequestBody
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	accessToken := strings.TrimSpace(req.AccessToken)

	// If accessToken is missing, check if refreshToken is provided
	if accessToken == "" && strings.TrimSpace(req.RefreshToken) != "" {
		authResult, err := h.authService.Refresh(r.Context(), req.RefreshToken)
		if err != nil {
			// Sanitized: upstream auth errors embed provider details.
			writeUpstreamError(w, "token-refresh", err)
			return
		}
		accessToken = authResult.AccessToken
	}

	// If still missing, check if signedData is provided to authenticate
	if accessToken == "" && req.SignedData != nil {
		authResult, err := h.authService.Authenticate(r.Context(), auth.AuthRequest{
			SignedData: req.SignedData,
		})
		if err != nil {
			// Sanitized: upstream auth errors embed provider details.
			writeUpstreamError(w, "authentication", err)
			return
		}
		accessToken = authResult.AccessToken
	}

	if accessToken == "" {
		writeError(w, http.StatusBadRequest, "accessToken or signedData is required")
		return
	}

	balances, err := h.authService.GetBalances(r.Context(), accessToken)
	if err != nil {
		writeUpstreamError(w, "balance", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"balances": balances,
	})
}
