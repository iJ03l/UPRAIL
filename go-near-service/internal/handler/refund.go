package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/uprail/near-service/internal/escrow"
)

// RefundHandler handles POST /internal/refund.
type RefundHandler struct {
	refundService *escrow.RefundService
}

// NewRefundHandler constructs a RefundHandler.
func NewRefundHandler(service *escrow.RefundService) *RefundHandler {
	return &RefundHandler{refundService: service}
}

// ServeHTTP handles refunding expired payments from escrow back to sender.
func (h *RefundHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req escrow.RefundRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if strings.TrimSpace(req.RefundTo) == "" {
		writeError(w, http.StatusBadRequest, "refundTo is required")
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

	result, err := h.refundService.Refund(r.Context(), req)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}
