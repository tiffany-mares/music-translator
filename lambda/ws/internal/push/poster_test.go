package push

import (
	"context"
	"errors"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi"
	"github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi/types"
)

type fakeMgmt struct {
	in  *apigatewaymanagementapi.PostToConnectionInput
	err error
}

func (f *fakeMgmt) PostToConnection(_ context.Context, in *apigatewaymanagementapi.PostToConnectionInput, _ ...func(*apigatewaymanagementapi.Options)) (*apigatewaymanagementapi.PostToConnectionOutput, error) {
	f.in = in
	return &apigatewaymanagementapi.PostToConnectionOutput{}, f.err
}

func TestPostSendsDataToConnection(t *testing.T) {
	f := &fakeMgmt{}
	if err := NewAPIPoster(f).Post(context.Background(), "conn-1", []byte(`{"x":1}`)); err != nil {
		t.Fatal(err)
	}
	if *f.in.ConnectionId != "conn-1" || string(f.in.Data) != `{"x":1}` {
		t.Fatalf("posted (%q, %q)", *f.in.ConnectionId, f.in.Data)
	}
}

func TestGoneExceptionMapsToErrGone(t *testing.T) {
	f := &fakeMgmt{err: &types.GoneException{Message: aws.String("gone")}}
	err := NewAPIPoster(f).Post(context.Background(), "conn-1", []byte("x"))
	if !errors.Is(err, ErrGone) {
		t.Fatalf("err = %v, want ErrGone", err)
	}
}

func TestOtherErrorsPassThroughUnmapped(t *testing.T) {
	boom := errors.New("throttled")
	f := &fakeMgmt{err: boom}
	err := NewAPIPoster(f).Post(context.Background(), "conn-1", []byte("x"))
	if err == nil || errors.Is(err, ErrGone) {
		t.Fatalf("err = %v, want passthrough non-Gone", err)
	}
}
