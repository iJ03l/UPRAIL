package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/uprail/near-service/internal/account"
	"github.com/uprail/near-service/internal/auth"
	"github.com/uprail/near-service/internal/config"
	"github.com/uprail/near-service/internal/escrow"
	"github.com/uprail/near-service/internal/handler"
	"github.com/uprail/near-service/internal/intents"
	"github.com/uprail/near-service/internal/middleware"
	"github.com/uprail/near-service/internal/oneclick"
)

func main() {
	// 1. Initialize structured logging
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	slog.Info("starting UPRAIL NEAR Go service...")

	// 2. Load configuration
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load configuration", "error", err)
		os.Exit(1)
	}

	// Warn if signer key or escrow account is missing, but allow service to start
	// for development and health probes.
	if err := cfg.Validate(); err != nil {
		slog.Warn("escrow configuration incomplete (signer operations will fail)", "warning", err.Error())
	}

	// 3. Initialize shared HTTP client
	httpClient := &http.Client{
		Timeout: cfg.HTTPTimeout,
	}

	// 4. Initialize OneClick client
	oneClickClient := oneclick.NewClient(cfg.APIBase, cfg.PartnerAPIKey, httpClient)

	// 5. Initialize Solver Relay client
	relayClient := intents.NewRelayClient(cfg.SolverRelayURL, httpClient)

	// 6. Initialize Signer (optional if keys not provided during startup dry run)
	var signer *escrow.Signer
	if cfg.EscrowPrivateKey != "" && cfg.EscrowAccountID != "" {
		s, err := escrow.NewSigner(cfg.EscrowPrivateKey, cfg.EscrowAccountID)
		if err != nil {
			slog.Warn("failed to initialize escrow signer", "error", err)
		} else {
			signer = s
			slog.Info("escrow signer initialized", "account_id", cfg.EscrowAccountID)
		}
	}

	// 7. Initialize business services
	// Shared at-most-once guard: a payment can neither double-settle nor both
	// settle and refund concurrently.
	settlementGuard := escrow.NewGuard()
	transferService := escrow.NewTransferService(signer, relayClient, settlementGuard, oneClickClient)
	refundService := escrow.NewRefundService(signer, relayClient, settlementGuard)
	accountService := account.NewService(signer, relayClient, cfg.AllowedAccountParents, cfg.DeniedAccountIDs)
	authService := auth.NewService(cfg.APIBase, httpClient)

	// 8. Create Chi router with middlewares
	r := chi.NewRouter()
	r.Use(middleware.Logging(logger))
	r.Use(middleware.Recovery(logger))
	// Defense in depth for the internal surface: bounded bodies and a simple
	// per-IP throttle so a compromised or runaway caller cannot exhaust the
	// container. Rate limiting is keyed on the TCP peer, never spoofable
	// headers.
	r.Use(middleware.BodyLimit)
	r.Use(middleware.RateLimit(600))

	// 9. Register API routes
	deps := handler.RouterDependencies{
		OneClickClient:  oneClickClient,
		TransferService: transferService,
		RefundService:   refundService,
		AccountService:  accountService,
		AuthService:     authService,
		InternalSecret:  cfg.InternalSecret,
	}
	handler.RegisterRoutes(r, deps)

	// Root health check endpoint
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"service":"uprail-near-go","status":"ok"}`))
	})

	// 10. Start HTTP server
	addr := fmt.Sprintf(":%s", cfg.Port)
	srv := &http.Server{
		Addr:         addr,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 45 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	serverCtx, serverStopCtx := context.WithCancel(context.Background())

	// Listen for syscall signals for process shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGHUP, syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT)

	go func() {
		<-sigChan
		slog.Info("shutdown signal received, initiating graceful shutdown...")

		shutdownCtx, shutdownCancel := context.WithTimeout(serverCtx, 30*time.Second)
		defer shutdownCancel()

		go func() {
			<-shutdownCtx.Done()
			if errors.Is(shutdownCtx.Err(), context.DeadlineExceeded) {
				slog.Error("graceful shutdown timed out.. forcing exit")
				os.Exit(1)
			}
		}()

		if err := srv.Shutdown(shutdownCtx); err != nil {
			slog.Error("error during server shutdown", "error", err)
		}
		serverStopCtx()
	}()

	slog.Info("UPRAIL NEAR Go service listening", "address", addr, "env", cfg.Environment)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server failed to start", "error", err)
		os.Exit(1)
	}

	// Wait for server context to be stopped
	<-serverCtx.Done()
	slog.Info("server shutdown completed successfully")
}
