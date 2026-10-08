package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/uprail/near-service/internal/intents"
)

// AuthRequest represents a request to authenticate a NEAR user session using signed intents.
type AuthRequest struct {
	SignedData *intents.SignedData `json:"signedData,omitempty"`
	SignerID   string              `json:"signerId,omitempty"`
}

// AuthResult holds the authentication tokens issued by the NEAR auth service.
type AuthResult struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken,omitempty"`
	ExpiresIn    int64  `json:"expiresIn,omitempty"`
	TokenType    string `json:"tokenType,omitempty"`
}

// Balance represents a balance record for a token held in the user's intent account.
type Balance struct {
	AssetID         string `json:"assetId"`
	Symbol          string `json:"symbol,omitempty"`
	Amount          string `json:"amount"`
	Decimals        int    `json:"decimals,omitempty"`
	ContractAddress string `json:"contractAddress,omitempty"`
}

// Service manages NEAR user-session authentication and balance retrieval.
type Service struct {
	apiBase    string
	httpClient *http.Client
}

// NewService constructs an auth service.
func NewService(apiBase string, httpClient *http.Client) *Service {
	if httpClient == nil {
		httpClient = &http.Client{
			Timeout: 30 * time.Second,
		}
	}
	return &Service{
		apiBase:    strings.TrimRight(apiBase, "/"),
		httpClient: httpClient,
	}
}

// Authenticate verifies signed user credentials via POST /v0/auth/authenticate.
func (s *Service) Authenticate(ctx context.Context, req AuthRequest) (*AuthResult, error) {
	if req.SignedData == nil {
		return nil, fmt.Errorf("authenticate: signedData is required")
	}

	bodyBytes, err := json.Marshal(map[string]any{
		"signed_data": req.SignedData,
	})
	if err != nil {
		return nil, fmt.Errorf("authenticate: marshal request: %w", err)
	}

	endpoint := fmt.Sprintf("%s/v0/auth/authenticate", s.apiBase)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("authenticate: create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	httpResp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("authenticate: execute request: %w", err)
	}
	defer httpResp.Body.Close()

	respBytes, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return nil, fmt.Errorf("authenticate: read response: %w", err)
	}

	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		return nil, fmt.Errorf("authenticate failed (status %d): %s", httpResp.StatusCode, string(respBytes))
	}

	var rawMap map[string]any
	if err := json.Unmarshal(respBytes, &rawMap); err != nil {
		return nil, fmt.Errorf("authenticate: parse response: %w", err)
	}

	result := &AuthResult{
		TokenType: "Bearer",
	}

	// Support camelCase and snake_case response fields
	if tok, ok := rawMap["accessToken"].(string); ok {
		result.AccessToken = tok
	} else if tok, ok := rawMap["access_token"].(string); ok {
		result.AccessToken = tok
	}

	if tok, ok := rawMap["refreshToken"].(string); ok {
		result.RefreshToken = tok
	} else if tok, ok := rawMap["refresh_token"].(string); ok {
		result.RefreshToken = tok
	}

	if exp, ok := rawMap["expiresIn"].(float64); ok {
		result.ExpiresIn = int64(exp)
	} else if exp, ok := rawMap["expires_in"].(float64); ok {
		result.ExpiresIn = int64(exp)
	}

	return result, nil
}

// Refresh renews an access token using a refresh token via POST /v0/auth/refresh.
func (s *Service) Refresh(ctx context.Context, refreshToken string) (*AuthResult, error) {
	if strings.TrimSpace(refreshToken) == "" {
		return nil, fmt.Errorf("refresh: refreshToken is required")
	}

	bodyBytes, err := json.Marshal(map[string]string{
		"refresh_token": refreshToken,
	})
	if err != nil {
		return nil, fmt.Errorf("refresh: marshal request: %w", err)
	}

	endpoint := fmt.Sprintf("%s/v0/auth/refresh", s.apiBase)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("refresh: create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	httpResp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("refresh: execute request: %w", err)
	}
	defer httpResp.Body.Close()

	respBytes, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return nil, fmt.Errorf("refresh: read response: %w", err)
	}

	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		return nil, fmt.Errorf("refresh failed (status %d): %s", httpResp.StatusCode, string(respBytes))
	}

	var rawMap map[string]any
	if err := json.Unmarshal(respBytes, &rawMap); err != nil {
		return nil, fmt.Errorf("refresh: parse response: %w", err)
	}

	result := &AuthResult{
		TokenType: "Bearer",
	}

	if tok, ok := rawMap["accessToken"].(string); ok {
		result.AccessToken = tok
	} else if tok, ok := rawMap["access_token"].(string); ok {
		result.AccessToken = tok
	}

	if tok, ok := rawMap["refreshToken"].(string); ok {
		result.RefreshToken = tok
	} else if tok, ok := rawMap["refresh_token"].(string); ok {
		result.RefreshToken = tok
	}

	if exp, ok := rawMap["expiresIn"].(float64); ok {
		result.ExpiresIn = int64(exp)
	} else if exp, ok := rawMap["expires_in"].(float64); ok {
		result.ExpiresIn = int64(exp)
	}

	return result, nil
}

// GetBalances fetches token balances for the authenticated user via GET /v0/account/balances.
func (s *Service) GetBalances(ctx context.Context, accessToken string) ([]Balance, error) {
	if strings.TrimSpace(accessToken) == "" {
		return nil, fmt.Errorf("get balances: accessToken is required")
	}

	endpoint := fmt.Sprintf("%s/v0/account/balances", s.apiBase)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("get balances: create request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	httpReq.Header.Set("Accept", "application/json")

	httpResp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("get balances: execute request: %w", err)
	}
	defer httpResp.Body.Close()

	respBytes, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return nil, fmt.Errorf("get balances: read response: %w", err)
	}

	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		return nil, fmt.Errorf("get balances failed (status %d): %s", httpResp.StatusCode, string(respBytes))
	}

	var balances []Balance
	if err := json.Unmarshal(respBytes, &balances); err == nil {
		return balances, nil
	}

	var wrapper struct {
		Balances []Balance `json:"balances"`
	}
	if err := json.Unmarshal(respBytes, &wrapper); err == nil {
		return wrapper.Balances, nil
	}

	return nil, fmt.Errorf("get balances: unable to parse balances response")
}
