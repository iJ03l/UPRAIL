package handler

import (
	"github.com/go-chi/chi/v5"
	"github.com/uprail/near-service/internal/account"
	"github.com/uprail/near-service/internal/auth"
	"github.com/uprail/near-service/internal/escrow"
	"github.com/uprail/near-service/internal/middleware"
	"github.com/uprail/near-service/internal/oneclick"
)

// RouterDependencies aggregates all backend services required by HTTP handlers.
type RouterDependencies struct {
	OneClickClient  *oneclick.Client
	TransferService *escrow.TransferService
	RefundService   *escrow.RefundService
	AccountService  *account.Service
	AuthService     *auth.Service
	InternalSecret  string
}

// RegisterRoutes sets up all internal endpoints on the provided chi router.
func RegisterRoutes(r chi.Router, deps RouterDependencies) {
	quoteH := NewQuoteHandler(deps.OneClickClient)
	depositH := NewDepositHandler(deps.OneClickClient)
	transferH := NewTransferHandler(deps.TransferService)
	refundH := NewRefundHandler(deps.RefundService)
	accountH := NewAccountHandler(deps.AccountService)
	balanceH := NewBalanceHandler(deps.AuthService)
	tokensH := NewTokensHandler(deps.OneClickClient)
	healthH := NewHealthHandler()

	r.Route("/internal", func(r chi.Router) {
		// Public health probe for container readiness
		r.Get("/health", healthH.ServeHTTP)

		// Inter-service authenticated routes
		r.Group(func(r chi.Router) {
			r.Use(middleware.InternalAuth(deps.InternalSecret))

			r.Post("/quote", quoteH.ServeHTTP)
			r.Get("/deposit/status", depositH.Status)
			r.Post("/deposit/submit", depositH.Submit)
			r.Post("/submit-deposit", depositH.Submit)
			r.Post("/transfer", transferH.ServeHTTP)
			r.Post("/refund", refundH.ServeHTTP)
			r.Post("/account/create", accountH.ServeHTTP)
			r.Post("/create-account", accountH.ServeHTTP)
			r.Post("/balance", balanceH.ServeHTTP)
			r.Get("/tokens", tokensH.ServeHTTP)
		})
	})
}
