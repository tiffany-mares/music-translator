package handler

import (
	"context"
	"errors"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

type fakeValidator struct {
	sub   string
	err   error
	calls int
}

func (f *fakeValidator) Validate(_ context.Context, _ string) (string, error) {
	f.calls++
	return f.sub, f.err
}

type fakeStore struct {
	putConn, putUser string
	putCalls         int
	putErr           error
	delConn          string
	delCalls         int
	delErr           error
}

func (f *fakeStore) Put(_ context.Context, c, u string) error {
	f.putCalls++
	f.putConn, f.putUser = c, u
	return f.putErr
}

func (f *fakeStore) Delete(_ context.Context, c string) error {
	f.delCalls++
	f.delConn = c
	return f.delErr
}

func connectReq(connID, token string) events.APIGatewayWebsocketProxyRequest {
	req := events.APIGatewayWebsocketProxyRequest{}
	req.RequestContext.ConnectionID = connID
	if token != "" {
		req.QueryStringParameters = map[string]string{"token": token}
	}
	return req
}

func TestConnectHappyPathPutsRowAnd200(t *testing.T) {
	v, s := &fakeValidator{sub: "sub-1"}, &fakeStore{}
	got, err := (&Connect{Auth: v, Store: s}).Handle(context.Background(), connectReq("conn-abc", "tok"))
	if err != nil || got.StatusCode != 200 {
		t.Fatalf("got (%v, %v), want (200, nil)", got.StatusCode, err)
	}
	if s.putConn != "conn-abc" || s.putUser != "sub-1" {
		t.Fatalf("put (%q,%q), want (conn-abc, sub-1)", s.putConn, s.putUser)
	}
}

func TestConnectMissingToken401NoValidateNoPut(t *testing.T) {
	v, s := &fakeValidator{sub: "sub-1"}, &fakeStore{}
	got, err := (&Connect{Auth: v, Store: s}).Handle(context.Background(), connectReq("conn-abc", ""))
	if err != nil || got.StatusCode != 401 {
		t.Fatalf("got (%v, %v), want (401, nil)", got.StatusCode, err)
	}
	if v.calls != 0 || s.putCalls != 0 {
		t.Fatalf("validate=%d put=%d, want 0/0", v.calls, s.putCalls)
	}
}

func TestConnectInvalidToken401NoPut(t *testing.T) {
	v, s := &fakeValidator{err: errors.New("bad token")}, &fakeStore{}
	got, err := (&Connect{Auth: v, Store: s}).Handle(context.Background(), connectReq("conn-abc", "tok"))
	if err != nil || got.StatusCode != 401 {
		t.Fatalf("got (%v, %v), want (401, nil)", got.StatusCode, err)
	}
	if s.putCalls != 0 {
		t.Fatalf("put called %d times, want 0", s.putCalls)
	}
}

func TestConnectPutError500(t *testing.T) {
	v, s := &fakeValidator{sub: "sub-1"}, &fakeStore{putErr: errors.New("throttled")}
	got, err := (&Connect{Auth: v, Store: s}).Handle(context.Background(), connectReq("conn-abc", "tok"))
	if err != nil || got.StatusCode != 500 {
		t.Fatalf("got (%v, %v), want (500, nil)", got.StatusCode, err)
	}
}

func TestDisconnectDeletesByConnectionIDAnd200(t *testing.T) {
	s := &fakeStore{}
	req := events.APIGatewayWebsocketProxyRequest{}
	req.RequestContext.ConnectionID = "conn-abc"
	got, err := (&Disconnect{Store: s}).Handle(context.Background(), req)
	if err != nil || got.StatusCode != 200 {
		t.Fatalf("got (%v, %v), want (200, nil)", got.StatusCode, err)
	}
	if s.delConn != "conn-abc" {
		t.Fatalf("deleted %q, want conn-abc", s.delConn)
	}
}

func TestDisconnectDeleteErrorStill200(t *testing.T) {
	s := &fakeStore{delErr: errors.New("throttled")}
	req := events.APIGatewayWebsocketProxyRequest{}
	req.RequestContext.ConnectionID = "conn-abc"
	got, err := (&Disconnect{Store: s}).Handle(context.Background(), req)
	if err != nil || got.StatusCode != 200 {
		t.Fatalf("got (%v, %v), want (200, nil) — the socket is gone regardless", got.StatusCode, err)
	}
}
