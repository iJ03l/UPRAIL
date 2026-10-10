package intents

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

// RelayClient connects to the Defuse Solver Relay JSON-RPC 2.0 endpoint.
type RelayClient struct {
	relayURL   string
	httpClient *http.Client
}

// JSONRPCRequest represents a standard JSON-RPC 2.0 request.
type JSONRPCRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      string `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params"`
}

// JSONRPCResponse represents a standard JSON-RPC 2.0 response.
type JSONRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      string          `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *JSONRPCError   `json:"error,omitempty"`
}

// JSONRPCError represents a JSON-RPC error.
type JSONRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// PublishIntentParams defines the params object for the publish_intent method.
type PublishIntentParams struct {
	SignedData SignedData `json:"signed_data"`
}

// NewRelayClient creates a new client for publishing signed intents to a solver relay.
func NewRelayClient(relayURL string, httpClient *http.Client) *RelayClient {
	if httpClient == nil {
		httpClient = &http.Client{
			Timeout: 30 * time.Second,
		}
	}
	return &RelayClient{
		relayURL:   strings.TrimSpace(relayURL),
		httpClient: httpClient,
	}
}

// PublishIntent sends a signed intent to the solver relay and returns the intent hash.
func (c *RelayClient) PublishIntent(ctx context.Context, signedData SignedData) (string, error) {
	reqID := uuid.New().String()

	rpcReq := JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      reqID,
		Method:  "publish_intent",
		Params: PublishIntentParams{
			SignedData: signedData,
		},
	}

	bodyBytes, err := json.Marshal(rpcReq)
	if err != nil {
		return "", fmt.Errorf("publish intent: marshal json-rpc request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.relayURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("publish intent: create http request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	httpResp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("publish intent: relay call failed: %w", err)
	}
	defer httpResp.Body.Close()

	respBytes, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return "", fmt.Errorf("publish intent: read relay response: %w", err)
	}

	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		return "", fmt.Errorf("publish intent: http error %d: %s", httpResp.StatusCode, string(respBytes))
	}

	var rpcResp JSONRPCResponse
	if err := json.Unmarshal(respBytes, &rpcResp); err != nil {
		return "", fmt.Errorf("publish intent: unmarshal json-rpc response: %w", err)
	}

	if rpcResp.Error != nil {
		return "", fmt.Errorf("publish intent: relay rejected with code %d: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}

	// Result can be a direct string (e.g. "intent_hash") or an object with
	// "intent_hash"/"hash". Anything that does not look like a real hash is an
	// error: callers persist this value as the settlement transaction hash, and
	// a fabricated value would make an unsettled payment look settled.
	var directHash string
	if err := json.Unmarshal(rpcResp.Result, &directHash); err == nil && directHash != "" {
		if !looksLikeIntentHash(directHash) {
			return "", fmt.Errorf("publish intent: relay returned a malformed intent hash")
		}
		return directHash, nil
	}

	var resultMap map[string]any
	if err := json.Unmarshal(rpcResp.Result, &resultMap); err == nil {
		for _, key := range []string{"intent_hash", "hash"} {
			if hash, ok := resultMap[key].(string); ok && hash != "" {
				if !looksLikeIntentHash(hash) {
					return "", fmt.Errorf("publish intent: relay returned a malformed intent hash")
				}
				return hash, nil
			}
		}
	}

	return "", fmt.Errorf(
		"publish intent: relay response contained no intent hash: %s",
		truncateForLog(string(rpcResp.Result), 200),
	)
}

// looksLikeIntentHash rejects empty, oversized and structured values (JSON
// objects, error strings, statuses) that must never be recorded as a tx hash.
func looksLikeIntentHash(value string) bool {
	if len(value) < 8 || len(value) > 128 {
		return false
	}
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '_' || r == '-' || r == ':' || r == '.':
		default:
			return false
		}
	}
	return true
}

func truncateForLog(value string, max int) string {
	value = strings.TrimSpace(value)
	if len(value) <= max {
		return value
	}
	return value[:max] + "…"
}
