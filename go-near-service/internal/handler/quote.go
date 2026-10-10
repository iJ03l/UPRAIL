package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/uprail/near-service/internal/oneclick"
)

// QuoteHandler handles POST /internal/quote requests.
type QuoteHandler struct {
	client *oneclick.Client
}

// NewQuoteHandler constructs a QuoteHandler.
func NewQuoteHandler(client *oneclick.Client) *QuoteHandler {
	return &QuoteHandler{client: client}
}

// ServeHTTP handles swap quote requests, strictly enforcing "advanced" confidentiality.
func (h *QuoteHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req oneclick.QuoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	// Flexible asset fallback
	if strings.TrimSpace(req.OriginAsset) == "" {
		if strings.TrimSpace(req.DestinationAsset) != "" {
			req.OriginAsset = req.DestinationAsset
		}
	}
	if strings.TrimSpace(req.DestinationAsset) == "" {
		req.DestinationAsset = req.OriginAsset
	}

	// Validate required fields
	if strings.TrimSpace(req.OriginAsset) == "" {
		writeError(w, http.StatusBadRequest, "originAsset or asset is required")
		return
	}
	if strings.TrimSpace(req.Amount) == "" {
		writeError(w, http.StatusBadRequest, "amount is required")
		return
	}
	if strings.TrimSpace(req.Recipient) == "" {
		writeError(w, http.StatusBadRequest, "recipient is required")
		return
	}

	// Enforce confidential routing
	req.Confidentiality = "advanced"

	quote, err := h.client.GetQuote(r.Context(), req)
	if err != nil {
		writeUpstreamError(w, "quote", err)
		return
	}

	writeJSON(w, http.StatusOK, quote)
}
