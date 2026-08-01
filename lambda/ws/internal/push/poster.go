package push

import (
	"context"
	"errors"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi"
	"github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi/types"
)

// ManagementAPI is the SDK subset APIPoster needs (satisfied by
// *apigatewaymanagementapi.Client configured with the WS management endpoint).
type ManagementAPI interface {
	PostToConnection(ctx context.Context, in *apigatewaymanagementapi.PostToConnectionInput, opts ...func(*apigatewaymanagementapi.Options)) (*apigatewaymanagementapi.PostToConnectionOutput, error)
}

type APIPoster struct {
	client ManagementAPI
}

func NewAPIPoster(client ManagementAPI) *APIPoster { return &APIPoster{client: client} }

// Post maps the management API's 410 (types.GoneException) onto ErrGone so
// the handler's stale-row branch stays SDK-free.
func (p *APIPoster) Post(ctx context.Context, connectionID string, data []byte) error {
	_, err := p.client.PostToConnection(ctx, &apigatewaymanagementapi.PostToConnectionInput{
		ConnectionId: aws.String(connectionID),
		Data:         data,
	})
	var gone *types.GoneException
	if errors.As(err, &gone) {
		return fmt.Errorf("%s: %w", connectionID, ErrGone)
	}
	return err
}
