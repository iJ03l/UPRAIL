package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultAPIBase       = "https://1click.chaindefuser.com"
	DefaultSolverRelay   = "https://solver-relay-v2.chaindefuser.com/rpc"
	DefaultPort          = "8080"
	DefaultHTTPTimeout   = 30 * time.Second
)

// Config holds runtime configuration loaded from environment variables.
type Config struct {
	EscrowPrivateKey string        `json:"-"` // Never serialized or logged
	PartnerAPIKey    string        `json:"-"`
	APIBase          string        `json:"api_base"`
	SolverRelayURL   string        `json:"solver_relay_url"`
	EscrowAccountID  string        `json:"escrow_account_id"`
	Port             string        `json:"port"`
	HTTPTimeout      time.Duration `json:"http_timeout"`
	Environment      string        `json:"environment"`
}

// Load loads configuration from environment variables with sensible defaults.
func Load() (*Config, error) {
	cfg := &Config{
		EscrowPrivateKey: strings.TrimSpace(os.Getenv("ESCROW_PRIVATE_KEY")),
		PartnerAPIKey:    strings.TrimSpace(os.Getenv("NEAR_PARTNER_API_KEY")),
		APIBase:          strings.TrimSpace(os.Getenv("NEAR_API_BASE")),
		SolverRelayURL:   strings.TrimSpace(os.Getenv("SOLVER_RELAY_URL")),
		EscrowAccountID:  strings.TrimSpace(os.Getenv("ESCROW_ACCOUNT_ID")),
		Port:             strings.TrimSpace(os.Getenv("PORT")),
		Environment:      strings.TrimSpace(os.Getenv("ENVIRONMENT")),
		HTTPTimeout:      DefaultHTTPTimeout,
	}

	if cfg.APIBase == "" {
		cfg.APIBase = DefaultAPIBase
	}
	cfg.APIBase = strings.TrimRight(cfg.APIBase, "/")

	if cfg.SolverRelayURL == "" {
		cfg.SolverRelayURL = DefaultSolverRelay
	}

	if cfg.Port == "" {
		cfg.Port = DefaultPort
	}

	if cfg.Environment == "" {
		cfg.Environment = "production"
	}

	if timeoutStr := strings.TrimSpace(os.Getenv("HTTP_TIMEOUT_SECONDS")); timeoutStr != "" {
		if sec, err := strconv.Atoi(timeoutStr); err == nil && sec > 0 {
			cfg.HTTPTimeout = time.Duration(sec) * time.Second
		}
	}

	return cfg, nil
}

// Validate validates that critical configuration fields are populated for operations.
func (c *Config) Validate() error {
	if c.EscrowPrivateKey == "" {
		return fmt.Errorf("config validation: ESCROW_PRIVATE_KEY environment variable is required")
	}
	if c.EscrowAccountID == "" {
		return fmt.Errorf("config validation: ESCROW_ACCOUNT_ID environment variable is required")
	}
	return nil
}
