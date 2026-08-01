// Package auth validates Cognito ID tokens presented as the `token` query
// parameter on $connect. WebSocket APIs cannot use the HTTP API's JWT
// authorizer, so architecture.md §9's "same JWT, no separate auth mechanism"
// is implemented here: same issuer, same audience (client id), ID tokens only.
package auth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TokenValidator is the handler-facing seam; tests supply fakes.
type TokenValidator interface {
	// Validate returns the Cognito sub for a valid ID token.
	Validate(ctx context.Context, token string) (string, error)
}

type jwksDoc struct {
	Keys []struct {
		Kty string `json:"kty"`
		Kid string `json:"kid"`
		N   string `json:"n"`
		E   string `json:"e"`
	} `json:"keys"`
}

// Validator checks RS256 signature (JWKS kid), iss, exp, aud (client id) and
// token_use == "id". JWKS is fetched lazily once per container and cached for
// its lifetime — Cognito signing keys don't rotate short of pool recreation,
// and container turnover provides refresh (recorded tradeoff, notes §6.1).
type Validator struct {
	issuer   string
	clientID string
	jwksURL  string
	httpc    *http.Client

	mu   sync.Mutex
	keys map[string]*rsa.PublicKey
}

func New(issuer, clientID, jwksURL string) *Validator {
	return &Validator{
		issuer:   issuer,
		clientID: clientID,
		jwksURL:  jwksURL,
		httpc:    &http.Client{Timeout: 5 * time.Second},
	}
}

func (v *Validator) getKeys(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.keys != nil {
		return v.keys, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.jwksURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := v.httpc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("jwks endpoint returned %d", resp.StatusCode)
	}
	var doc jwksDoc
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return nil, err
	}
	keys := make(map[string]*rsa.PublicKey, len(doc.Keys))
	for _, k := range doc.Keys {
		if k.Kty != "RSA" {
			continue
		}
		nb, err := base64.RawURLEncoding.DecodeString(k.N)
		if err != nil {
			return nil, fmt.Errorf("jwks key %s: bad n: %w", k.Kid, err)
		}
		eb, err := base64.RawURLEncoding.DecodeString(k.E)
		if err != nil {
			return nil, fmt.Errorf("jwks key %s: bad e: %w", k.Kid, err)
		}
		keys[k.Kid] = &rsa.PublicKey{
			N: new(big.Int).SetBytes(nb),
			E: int(new(big.Int).SetBytes(eb).Int64()),
		}
	}
	if len(keys) == 0 {
		return nil, errors.New("jwks document contained no RSA keys")
	}
	v.keys = keys
	return keys, nil
}

func (v *Validator) Validate(ctx context.Context, tokenStr string) (string, error) {
	keys, err := v.getKeys(ctx)
	if err != nil {
		return "", fmt.Errorf("jwks fetch: %w", err)
	}
	tok, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		key, ok := keys[kid]
		if !ok {
			return nil, fmt.Errorf("unknown kid %q", kid)
		}
		return key, nil
	},
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer(v.issuer),
		jwt.WithAudience(v.clientID),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return "", err
	}
	claims, ok := tok.Claims.(jwt.MapClaims)
	if !ok {
		return "", errors.New("unexpected claims type")
	}
	// A Cognito access token has token_use "access" (and client_id instead of
	// aud) — only ID tokens are the project standard.
	if use, _ := claims["token_use"].(string); use != "id" {
		return "", fmt.Errorf("token_use %q is not an ID token", use)
	}
	sub, _ := claims["sub"].(string)
	if sub == "" {
		return "", errors.New("token has no sub")
	}
	return sub, nil
}
