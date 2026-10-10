package escrow

import (
	"strings"
	"sync"
	"time"
)

// GuardOutcome describes what happened when an operation key was claimed.
type GuardOutcome int

const (
	// GuardAcquired — the caller now owns the operation and must execute it.
	GuardAcquired GuardOutcome = iota
	// GuardDuplicate — the operation already completed; use the cached result.
	GuardDuplicate
	// GuardInFlight — the operation is currently executing; retry later.
	GuardInFlight
)

const (
	guardTTL         = 15 * time.Minute
	guardMaxEntries  = 5000
	guardSweepEveryN = 64
)

type guardEntry struct {
	inFlight bool
	payload  any
	expires  time.Time
}

// Guard provides at-most-once execution for money-moving operations, keyed by
// payment ID. It is process-local (single container) and intentionally small.
type Guard struct {
	mu      sync.Mutex
	entries map[string]guardEntry
	calls   int
}

// NewGuard constructs an empty Guard.
func NewGuard() *Guard {
	return &Guard{entries: make(map[string]guardEntry)}
}

// Begin claims the key. Callers must follow up with Complete (success) or
// Release (failure).
func (g *Guard) Begin(key string) GuardOutcome {
	now := time.Now()

	g.mu.Lock()
	defer g.mu.Unlock()

	g.calls++
	if g.calls%guardSweepEveryN == 0 || len(g.entries) >= guardMaxEntries {
		for k, e := range g.entries {
			if now.After(e.expires) {
				delete(g.entries, k)
			}
		}
		// Hard cap: drop oldest-expiring entries if still oversized.
		for len(g.entries) >= guardMaxEntries {
			var oldestKey string
			var oldest time.Time
			for k, e := range g.entries {
				if oldestKey == "" || e.expires.Before(oldest) {
					oldestKey, oldest = k, e.expires
				}
			}
			if oldestKey == "" {
				break
			}
			delete(g.entries, oldestKey)
		}
	}

	if e, ok := g.entries[key]; ok && now.Before(e.expires) {
		if e.inFlight {
			return GuardInFlight
		}
		return GuardDuplicate
	}

	g.entries[key] = guardEntry{inFlight: true, expires: now.Add(guardTTL)}
	return GuardAcquired
}

// Result returns the payload recorded by Complete for a GuardDuplicate outcome.
func (g *Guard) Result(key string) any {
	g.mu.Lock()
	defer g.mu.Unlock()
	if e, ok := g.entries[key]; ok && !e.inFlight {
		return e.payload
	}
	return nil
}

// Complete stores the successful result for future duplicate calls.
func (g *Guard) Complete(key string, payload any) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.entries[key] = guardEntry{inFlight: false, payload: payload, expires: time.Now().Add(guardTTL)}
}

// Release drops an in-flight claim so a retry may execute again.
func (g *Guard) Release(key string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if e, ok := g.entries[key]; ok && e.inFlight {
		delete(g.entries, key)
	}
}

// settlementRecord binds a payment id to the single settlement operation
// (transfer XOR refund) it may ever have, plus a fingerprint of the original
// request terms so an idempotent retry must match exactly.
type settlementRecord struct {
	kind        string // "transfer" | "refund"
	fingerprint string
	result      any
}

// settlementGuardKey is the single guard key per payment: one payment can
// either be transferred or refunded, never both, and never twice with
// different terms.
func settlementGuardKey(paymentID string) string {
	return "settlement:" + strings.TrimSpace(paymentID)
}

// settlementFingerprint binds asset, amount, and destination so a retry with
// different terms is rejected as a conflict instead of silently replayed.
func settlementFingerprint(asset, amount, destination string) string {
	return strings.ToLower(strings.TrimSpace(asset)) + "|" +
		strings.TrimSpace(amount) + "|" +
		strings.ToLower(strings.TrimSpace(destination))
}

// settlementReplay interprets a GuardDuplicate outcome. It returns the cached
// result only when the original operation was the same kind with identical
// terms; anything else (cross-kind settlement or changed terms) is a conflict.
func settlementReplay(payload any, kind, fingerprint, paymentID string) (any, error) {
	rec, ok := payload.(*settlementRecord)
	if !ok || rec == nil {
		return nil, conflict("%s: payment %s already has a settlement recorded", kind, paymentID)
	}
	if rec.kind != kind {
		return nil, conflict("%s: payment %s was already settled by a %s", kind, paymentID, rec.kind)
	}
	if rec.fingerprint != fingerprint {
		return nil, conflict("%s: payment %s was already settled with different asset, amount, or destination", kind, paymentID)
	}
	if rec.result == nil {
		return nil, conflict("%s: payment %s settlement record is inconsistent", kind, paymentID)
	}
	return rec.result, nil
}
