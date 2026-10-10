package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/uprail/near-service/internal/oneclick"
)

// DepositHandler handles deposit status queries and deposit hash submissions.
type DepositHandler struct {
	client *oneclick.Client
}

// NewDepositHandler constructs a DepositHandler.
func NewDepositHandler(client *oneclick.Client) *DepositHandler {
	return &DepositHandler{client: client}
}

// Status handles GET /internal/deposit/status?depositAddress=...
func (h *DepositHandler) Status(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	depositAddress := strings.TrimSpace(r.URL.Query().Get("depositAddress"))
	if depositAddress == "" {
		writeError(w, http.StatusBadRequest, "depositAddress query parameter is required")
		return
	}

	status, err := h.client.GetStatus(r.Context(), depositAddress)
	if err != nil {
		writeUpstreamError(w, "deposit-status", err)
		return
	}

	writeJSON(w, http.StatusOK, status)
}

// Submit handles POST /internal/deposit/submit
func (h *DepositHandler) Submit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req oneclick.SubmitDepositRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if strings.TrimSpace(req.TxHash) == "" {
		writeError(w, http.StatusBadRequest, "txHash is required")
		return
	}
	if strings.TrimSpace(req.DepositAddress) == "" {
		writeError(w, http.StatusBadRequest, "depositAddress is required")
		return
	}

	if err := h.client.SubmitDeposit(r.Context(), req.TxHash, req.DepositAddress); err != nil {
		writeUpstreamError(w, "deposit-submit", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status": "submitted",
	})
}
