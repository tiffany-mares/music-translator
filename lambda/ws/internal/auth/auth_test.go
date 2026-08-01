package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	testKid      = "test-kid"
	testIssuer   = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST"
	testClientID = "test-client-id"
	testSub      = "user-sub-123"
)

// harness: locally generated RSA keypair, its public half served as a JWKS
// document from an httptest server, and a token-minting helper.
type harness struct {
	priv   *rsa.PrivateKey
	server *httptest.Server
	hits   atomic.Int32
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	h := &harness{priv: priv}
	body, err := json.Marshal(map[string]any{"keys": []map[string]string{{
		"kty": "RSA", "alg": "RS256", "use": "sig", "kid": testKid,
		"n": base64.RawURLEncoding.EncodeToString(priv.N.Bytes()),
		"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(priv.E)).Bytes()),
	}}})
	if err != nil {
		t.Fatal(err)
	}
	h.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		h.hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.Write(body)
	}))
	t.Cleanup(h.server.Close)
	return h
}

func (h *harness) validator() *Validator {
	return New(testIssuer, testClientID, h.server.URL)
}

// mint signs a well-formed ID token with the harness key; mutate tweaks claims.
func (h *harness) mint(t *testing.T, kid string, key *rsa.PrivateKey, mutate func(jwt.MapClaims)) string {
	t.Helper()
	claims := jwt.MapClaims{
		"sub": testSub, "iss": testIssuer, "aud": testClientID,
		"token_use": "id",
		"iat":       time.Now().Unix(),
		"exp":       time.Now().Add(time.Hour).Unix(),
	}
	if mutate != nil {
		mutate(claims)
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = kid
	s, err := tok.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestValidTokenReturnsSub(t *testing.T) {
	h := newHarness(t)
	sub, err := h.validator().Validate(context.Background(), h.mint(t, testKid, h.priv, nil))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sub != testSub {
		t.Fatalf("sub = %q, want %q", sub, testSub)
	}
}

func TestExpiredTokenRejected(t *testing.T) {
	h := newHarness(t)
	tok := h.mint(t, testKid, h.priv, func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Hour).Unix() })
	if _, err := h.validator().Validate(context.Background(), tok); err == nil {
		t.Fatal("expired token accepted")
	}
}

func TestWrongIssuerRejected(t *testing.T) {
	h := newHarness(t)
	tok := h.mint(t, testKid, h.priv, func(c jwt.MapClaims) { c["iss"] = "https://evil.example.com" })
	if _, err := h.validator().Validate(context.Background(), tok); err == nil {
		t.Fatal("wrong-issuer token accepted")
	}
}

func TestWrongAudienceRejected(t *testing.T) {
	h := newHarness(t)
	tok := h.mint(t, testKid, h.priv, func(c jwt.MapClaims) { c["aud"] = "some-other-client" })
	if _, err := h.validator().Validate(context.Background(), tok); err == nil {
		t.Fatal("wrong-audience token accepted")
	}
}

func TestAccessTokenUseRejected(t *testing.T) {
	// aud kept valid so this test isolates the token_use check.
	h := newHarness(t)
	tok := h.mint(t, testKid, h.priv, func(c jwt.MapClaims) { c["token_use"] = "access" })
	if _, err := h.validator().Validate(context.Background(), tok); err == nil {
		t.Fatal("access token accepted")
	}
}

func TestUnknownKidRejected(t *testing.T) {
	h := newHarness(t)
	if _, err := h.validator().Validate(context.Background(), h.mint(t, "other-kid", h.priv, nil)); err == nil {
		t.Fatal("unknown-kid token accepted")
	}
}

func TestWrongKeySignatureRejected(t *testing.T) {
	h := newHarness(t)
	rogue, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	// Correct kid, wrong private key: signature must fail verification.
	if _, err := h.validator().Validate(context.Background(), h.mint(t, testKid, rogue, nil)); err == nil {
		t.Fatal("rogue-key token accepted")
	}
}

func TestGarbageTokenRejected(t *testing.T) {
	h := newHarness(t)
	if _, err := h.validator().Validate(context.Background(), "not.a.jwt"); err == nil {
		t.Fatal("garbage accepted")
	}
}

func TestJWKSFetchedOncePerValidator(t *testing.T) {
	h := newHarness(t)
	v := h.validator()
	tok := h.mint(t, testKid, h.priv, nil)
	for i := 0; i < 3; i++ {
		if _, err := v.Validate(context.Background(), tok); err != nil {
			t.Fatal(err)
		}
	}
	if got := h.hits.Load(); got != 1 {
		t.Fatalf("JWKS endpoint hit %d times, want 1 (container-lifetime cache)", got)
	}
}

func TestJWKSUnreachableFailsClosed(t *testing.T) {
	h := newHarness(t)
	tok := h.mint(t, testKid, h.priv, nil)
	h.server.Close()
	if _, err := h.validator().Validate(context.Background(), tok); err == nil {
		t.Fatal("validated with unreachable JWKS")
	}
}
