package middleware

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

const testSecret = "test-internal-secret"

func signRequest(secret, method, path, body, ts, nonce string) string {
	sum := sha256.Sum256([]byte(body))
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("v1." + ts + "." + nonce + "." + method + "." + path + "." + hex.EncodeToString(sum[:])))
	return hex.EncodeToString(mac.Sum(nil))
}

func doSigned(handler http.Handler, method, path, body, ts, nonce string, mutate func(*http.Request)) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if ts != "" {
		req.Header.Set(headerTimestamp, ts)
	}
	if nonce != "" {
		req.Header.Set(headerNonce, nonce)
	}
	req.Header.Set(headerSignature, signRequest(testSecret, method, path, body, ts, nonce))
	if mutate != nil {
		mutate(req)
	}

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func echoOK() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok:" + string(body)))
	})
}

func TestInternalAuthAcceptsValidSignature(t *testing.T) {
	h := InternalAuth(testSecret)(echoOK())
	now := strconv.FormatInt(time.Now().Unix(), 10)
	rec := doSigned(h, http.MethodPost, "/internal/transfer", `{"amount":"1"}`, now, "nonce-valid", nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != `ok:{"amount":"1"}` {
		t.Fatalf("handler body = %q, want original request body preserved", got)
	}
}

func TestInternalAuthRejectsMissingHeaders(t *testing.T) {
	h := InternalAuth(testSecret)(echoOK())
	rec := doSigned(h, http.MethodPost, "/internal/transfer", `{}`,
		strconv.FormatInt(time.Now().Unix(), 10), "n1",
		func(r *http.Request) { r.Header.Del(headerTimestamp) })
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing timestamp status = %d, want 401", rec.Code)
	}
}

func TestInternalAuthRejectsRawSecretOnly(t *testing.T) {
	// A raw shared secret without a request signature must not pass: it is
	// replayable and body-agnostic.
	h := InternalAuth(testSecret)(echoOK())
	req := httptest.NewRequest(http.MethodPost, "/internal/transfer", strings.NewReader(`{}`))
	req.Header.Set(headerSecret, testSecret)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("raw secret status = %d, want 401", rec.Code)
	}
}

func TestInternalAuthRejectsBadSignature(t *testing.T) {
	h := InternalAuth(testSecret)(echoOK())
	rec := doSigned(h, http.MethodPost, "/internal/transfer", `{}`,
		strconv.FormatInt(time.Now().Unix(), 10), "nonce-bad",
		func(r *http.Request) { r.Header.Set(headerSignature, strings.Repeat("0", 64)) })
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad signature status = %d, want 401", rec.Code)
	}
}

func TestInternalAuthRejectsBodyTampering(t *testing.T) {
	h := InternalAuth(testSecret)(echoOK())
	// Signature computed over a different body than the one actually sent.
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	req := httptest.NewRequest(http.MethodPost, "/internal/transfer", strings.NewReader(`{"amount":"999"}`))
	req.Header.Set(headerTimestamp, ts)
	req.Header.Set(headerNonce, "nonce-tamper")
	req.Header.Set(headerSignature, signRequest(testSecret, http.MethodPost, "/internal/transfer", `{"amount":"1"}`, ts, "nonce-tamper"))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("tampered body status = %d, want 401", rec.Code)
	}
}

func TestInternalAuthRejectsReplay(t *testing.T) {
	h := InternalAuth(testSecret)(echoOK())
	ts := strconv.FormatInt(time.Now().Unix(), 10)

	first := doSigned(h, http.MethodPost, "/internal/transfer", `{"amount":"1"}`, ts, "nonce-replay", nil)
	if first.Code != http.StatusOK {
		t.Fatalf("first request status = %d, want 200", first.Code)
	}
	second := doSigned(h, http.MethodPost, "/internal/transfer", `{"amount":"1"}`, ts, "nonce-replay", nil)
	if second.Code != http.StatusUnauthorized {
		t.Fatalf("replayed request status = %d, want 401", second.Code)
	}
}

func TestInternalAuthRejectsStaleTimestamp(t *testing.T) {
	h := InternalAuth(testSecret)(echoOK())
	stale := strconv.FormatInt(time.Now().Add(-time.Hour).Unix(), 10)
	rec := doSigned(h, http.MethodPost, "/internal/transfer", `{}`, stale, "nonce-stale", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("stale timestamp status = %d, want 401", rec.Code)
	}
}

func TestInternalAuthFailsClosedWithoutSecret(t *testing.T) {
	h := InternalAuth("   ")(echoOK())
	req := httptest.NewRequest(http.MethodPost, "/internal/transfer", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("empty secret status = %d, want 503", rec.Code)
	}
}
