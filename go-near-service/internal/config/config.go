package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultAPIBase     = "https://1click.chaindefuser.com"
	DefaultSolverRelay = "https://solver-relay-v2.chaindefuser.com/rpc"
	DefaultPort        = "8080"
	DefaultHTTPTimeout = 30 * time.Second
)

// Config holds runtime configuration loaded from environment variables.
type Config struct {
	EscrowPrivateKey string        `json:"-"` // Never serialized or logged
	PartnerAPIKey    string        `json:"-"`
	InternalSecret   string        `json:"-"` // Inter-service auth secret
	APIBase          string        `json:"api_base"`
	SolverRelayURL   string        `json:"solver_relay_url"`
	EscrowAccountID  string        `json:"escrow_account_id"`
	Port             string        `json:"port"`
	HTTPTimeout      time.Duration `json:"http_timeout"`
	Environment      string        `json:"environment"`
	// AllowedAccountParents restricts /internal/account/create to subaccounts
	// of these parent accounts (comma separated in ALLOWED_ACCOUNT_PARENTS).
	AllowedAccountParents []string `json:"-"`
	// DeniedAccountIDs are platform accounts that must never be targeted.
	DeniedAccountIDs []string `json:"-"`
}

const (
	defaultAllowedAccountParents = "uprail.near"
	defaultDeniedAccountIDs      = "escrow.uprail.near,fees.uprail.near,uprail.near"
)

// loadDotEnv parses simple KEY=VAL definitions from .env files if present.
func loadDotEnv(files ...string) {
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				k := strings.TrimSpace(parts[0])
				v := strings.Trim(strings.TrimSpace(parts[1]), "\"'`")
				if os.Getenv(k) == "" {
					_ = os.Setenv(k, v)
				}
			}
		}
	}
}

// Load loads configuration from environment variables with sensible defaults.
func Load() (*Config, error) {
	loadDotEnv(".env", "../.env")

	cfg := &Config{
		EscrowPrivateKey: strings.TrimSpace(os.Getenv("ESCROW_PRIVATE_KEY")),
		PartnerAPIKey:    strings.TrimSpace(os.Getenv("NEAR_PARTNER_API_KEY")),
		InternalSecret:   strings.TrimSpace(os.Getenv("INTERNAL_SERVICE_KEY")),
		APIBase:          strings.TrimSpace(os.Getenv("NEAR_API_BASE")),
		SolverRelayURL:   strings.TrimSpace(os.Getenv("SOLVER_RELAY_URL")),
		EscrowAccountID:  strings.TrimSpace(os.Getenv("ESCROW_ACCOUNT_ID")),
		Port:             strings.TrimSpace(os.Getenv("PORT")),
		Environment:      strings.TrimSpace(os.Getenv("ENVIRONMENT")),
		HTTPTimeout:      DefaultHTTPTimeout,
	}

	cfg.AllowedAccountParents = splitCSV(
		getenvOrDefault("ALLOWED_ACCOUNT_PARENTS", defaultAllowedAccountParents))
	cfg.DeniedAccountIDs = splitCSV(
		getenvOrDefault("DENIED_ACCOUNT_IDS", defaultDeniedAccountIDs))

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

func getenvOrDefault(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func splitCSV(raw string) []string {
	var out []string
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(strings.ToLower(part))
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

// Validate validates that critical configuration fields are populated for operations.
func (c *Config) Validate() error {
	if c.EscrowPrivateKey == "" {
		return fmt.Errorf("config validation: ESCROW_PRIVATE_KEY environment variable is required")
	}
	if c.EscrowAccountID == "" {
		return fmt.Errorf("config validation: ESCROW_ACCOUNT_ID environment variable is required")
	}
	if c.InternalSecret == "" {
		return fmt.Errorf("config validation: INTERNAL_SERVICE_KEY environment variable is required")
	}
	return nil
}
