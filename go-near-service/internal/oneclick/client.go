package oneclick

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client handles interaction with the 1Click Swap API.
type Client struct {
	apiBase    string
	partnerKey string
	httpClient *http.Client
}

// NewClient initializes a new 1Click Swap API client.
func NewClient(apiBase, partnerKey string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{
			Timeout: 30 * time.Second,
		}
	}
	return &Client{
		apiBase:    strings.TrimRight(apiBase, "/"),
		partnerKey: strings.TrimSpace(partnerKey),
		httpClient: httpClient,
	}
}

// newRequest creates an HTTP request with configured headers.
func (c *Client) newRequest(ctx context.Context, method, path string, body any) (*http.Request, error) {
	fullURL := fmt.Sprintf("%s%s", c.apiBase, path)

	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, fullURL, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if c.partnerKey != "" {
		req.Header.Set("X-API-Key", c.partnerKey)
		// If partnerKey appears to be a JWT, also attach Bearer for compatibility
		if strings.HasPrefix(c.partnerKey, "eyJ") {
			req.Header.Set("Authorization", "Bearer "+c.partnerKey)
		}
	}

	return req, nil
}

// do executes an HTTP request and decodes the response body.
func (c *Client) do(req *http.Request, target any) error {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("execute request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response body: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("api error (status %d): %s", resp.StatusCode, string(respBody))
	}

	if target != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, target); err != nil {
			return fmt.Errorf("unmarshal response (status %d): %w", resp.StatusCode, err)
		}
	}

	return nil
}

// GetQuote requests a swap quote from 1Click API. Confidentiality is enforced to "advanced".
func (c *Client) GetQuote(ctx context.Context, req QuoteRequest) (*QuoteResponse, error) {
	// Enforce confidential routing
	req.Confidentiality = "advanced"

	if req.SwapType == "" {
		req.SwapType = "EXACT_INPUT"
	}
	if req.DepositType == "" {
		req.DepositType = "INTENTS"
	}
	if req.RecipientType == "" {
		req.RecipientType = "INTENTS"
	}
	if req.RefundTo == "" {
		req.RefundTo = req.Recipient
	}
	if req.RefundType == "" {
		req.RefundType = "INTENTS"
	}
	if req.Deadline == "" {
		req.Deadline = time.Now().Add(30 * time.Minute).UTC().Format(time.RFC3339)
	}
	if req.SlippageTolerance == 0 {
		req.SlippageTolerance = 100 // 1%
	}

	httpReq, err := c.newRequest(ctx, http.MethodPost, "/v0/quote", req)
	if err != nil {
		return nil, fmt.Errorf("get quote: %w", err)
	}

	var res QuoteResponse
	if err := c.do(httpReq, &res); err != nil {
		return nil, fmt.Errorf("get quote: %w", err)
	}

	return &res, nil
}

// GetStatus checks the status of a swap or deposit by deposit address.
func (c *Client) GetStatus(ctx context.Context, depositAddress string) (*StatusResponse, error) {
	if strings.TrimSpace(depositAddress) == "" {
		return nil, fmt.Errorf("get status: depositAddress is required")
	}

	endpoint := fmt.Sprintf("/v0/deposit/status?depositAddress=%s", url.QueryEscape(depositAddress))
	httpReq, err := c.newRequest(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("get status: %w", err)
	}

	var res StatusResponse
	if err := c.do(httpReq, &res); err != nil {
		// Fallback check to /v0/status if /v0/deposit/status fails with 404
		fallbackEndpoint := fmt.Sprintf("/v0/status?depositAddress=%s", url.QueryEscape(depositAddress))
		fbReq, fbErr := c.newRequest(ctx, http.MethodGet, fallbackEndpoint, nil)
		if fbErr == nil {
			if fbErr := c.do(fbReq, &res); fbErr == nil {
				return &res, nil
			}
		}
		return nil, fmt.Errorf("get status: %w", err)
	}

	return &res, nil
}

// SubmitDeposit notifies 1Click API of a completed deposit transaction hash.
func (c *Client) SubmitDeposit(ctx context.Context, txHash, depositAddress string) error {
	if strings.TrimSpace(txHash) == "" {
		return fmt.Errorf("submit deposit: txHash is required")
	}
	if strings.TrimSpace(depositAddress) == "" {
		return fmt.Errorf("submit deposit: depositAddress is required")
	}

	payload := SubmitDepositRequest{
		TxHash:         txHash,
		DepositAddress: depositAddress,
	}

	httpReq, err := c.newRequest(ctx, http.MethodPost, "/v0/deposit/submit", payload)
	if err != nil {
		return fmt.Errorf("submit deposit: %w", err)
	}

	if err := c.do(httpReq, nil); err != nil {
		return fmt.Errorf("submit deposit: %w", err)
	}

	return nil
}

// GetTokens retrieves the dynamic list of supported tokens from /v0/tokens.
func (c *Client) GetTokens(ctx context.Context) ([]Token, error) {
	httpReq, err := c.newRequest(ctx, http.MethodGet, "/v0/tokens", nil)
	if err != nil {
		return nil, fmt.Errorf("get tokens: %w", err)
	}

	// 1Click /v0/tokens may return an array directly or { "tokens": [...] }
	var raw json.RawMessage
	if err := c.do(httpReq, &raw); err != nil {
		return nil, fmt.Errorf("get tokens: %w", err)
	}

	var tokens []Token
	if err := json.Unmarshal(raw, &tokens); err == nil {
		return tokens, nil
	}

	var wrapper struct {
		Tokens []Token `json:"tokens"`
	}
	if err := json.Unmarshal(raw, &wrapper); err == nil {
		return wrapper.Tokens, nil
	}

	return nil, fmt.Errorf("get tokens: unable to parse token list response")
}
