package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/uprail/near-service/internal/account"
)

// AccountHandler handles POST /internal/account/create.
type AccountHandler struct {
	accountService *account.Service
}

// NewAccountHandler constructs an AccountHandler.
func NewAccountHandler(service *account.Service) *AccountHandler {
	return &AccountHandler{accountService: service}
}

// ServeHTTP processes account creation requests with passkeys.
func (h *AccountHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req account.CreateAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if strings.TrimSpace(req.PublicKeyP256) == "" {
		writeError(w, http.StatusBadRequest, "publicKeyP256 is required")
		return
	}
	if strings.TrimSpace(req.DesiredAccountID) == "" {
		writeError(w, http.StatusBadRequest, "desiredAccountID is required")
		return
	}

	result, err := h.accountService.CreateAccount(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}
