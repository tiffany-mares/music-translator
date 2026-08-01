// Package handler holds the pure $connect/$disconnect logic; mains wire real
// AWS clients, tests wire fakes.
package handler

import (
	"context"
	"log"

	"github.com/aws/aws-lambda-go/events"

	"lyralearn/ws/internal/auth"
	"lyralearn/ws/internal/store"
)

func resp(code int) (events.APIGatewayProxyResponse, error) {
	return events.APIGatewayProxyResponse{StatusCode: code}, nil
}

type Connect struct {
	Auth  auth.TokenValidator
	Store store.ConnectionStore
}

// Handle implements architecture.md §5.6's connect handler. Non-200 makes API
// Gateway fail the WebSocket handshake with that status; a Go error would
// surface as a 500, so auth failures return explicit 401s instead.
func (h *Connect) Handle(ctx context.Context, req events.APIGatewayWebsocketProxyRequest) (events.APIGatewayProxyResponse, error) {
	connID := req.RequestContext.ConnectionID
	token := req.QueryStringParameters["token"]
	if token == "" {
		log.Printf("connect %s: missing token query parameter", connID)
		return resp(401)
	}
	userID, err := h.Auth.Validate(ctx, token)
	if err != nil {
		log.Printf("connect %s: token rejected: %v", connID, err)
		return resp(401)
	}
	if err := h.Store.Put(ctx, connID, userID); err != nil {
		// Reject rather than accept an untracked connection: it would never
		// receive 6.2's pushes, and the frontend's polling fallback (6.3)
		// handles a failed handshake cleanly.
		log.Printf("connect %s: put failed: %v", connID, err)
		return resp(500)
	}
	return resp(200)
}

type Disconnect struct {
	Store store.ConnectionStore
}

// Handle deletes the row. A Dynamo failure still returns 200: $disconnect is
// fire-and-forget (API GW won't retry), the socket is already gone, and the
// leaked row is the stale-row class 6.2's GoneException cleanup handles.
func (h *Disconnect) Handle(ctx context.Context, req events.APIGatewayWebsocketProxyRequest) (events.APIGatewayProxyResponse, error) {
	connID := req.RequestContext.ConnectionID
	if err := h.Store.Delete(ctx, connID); err != nil {
		log.Printf("disconnect %s: delete failed: %v", connID, err)
	}
	return resp(200)
}
