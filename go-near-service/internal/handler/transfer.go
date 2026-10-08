package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/uprail/near-service/internal/escrow"
)

// TransferHandler handles POST /internal/transfer.
type TransferHandler struct {
	transferService *escrow.TransferService
}

// NewTransferHandler constructs a TransferHandler.
func NewTransferHandler(service *escrow.TransferService) *TransferHandler {
	return &TransferHandler{transferService: service}
}

// ServeHTTP handles confidential token transfers from escrow to claimant.
func (h *TransferHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req escrow.TransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if strings.TrimSpace(req.Recipient) == "" {
		writeError(w, http.StatusBadRequest, "recipient is required")
		return
	}
	if strings.TrimSpace(req.Asset) == "" {
		writeError(w, http.StatusBadRequest, "asset is required")
		return
	}
	if strings.TrimSpace(req.Amount) == "" {
		writeError(w, http.StatusBadRequest, "amount is required")
		return
	}

	result, err := h.transferService.Transfer(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}
