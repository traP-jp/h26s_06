package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func TestFetchMessageInfoFetchesUserBot(t *testing.T) {
	srv, err := newServer(config{traqBaseURL: "https://example.test"})
	if err != nil {
		t.Fatalf("newServer returned error: %v", err)
	}

	var paths []string
	srv.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		paths = append(paths, r.URL.Path)
		switch r.URL.Path {
		case "/api/v3/messages/message-1":
			return jsonResponse(r, `{"id":"message-1","userId":"user-1","channelId":"channel-1"}`), nil
		case "/api/v3/messages/message-2":
			return jsonResponse(r, `{"id":"message-2","userId":"user-1","channelId":"channel-2"}`), nil
		case "/api/v3/users/user-1":
			return jsonResponse(r, `{"id":"user-1","bot":true}`), nil
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
			return nil, nil
		}
	})}

	channelID, isBot, err := srv.fetchMessageInfo(context.Background(), "token", "message-1")
	if err != nil {
		t.Fatalf("fetchMessageInfo returned error: %v", err)
	}
	if channelID != "channel-1" {
		t.Fatalf("channelID = %q, want %q", channelID, "channel-1")
	}
	if !isBot {
		t.Fatal("isBot = false, want true")
	}

	channelID, isBot, err = srv.fetchMessageInfo(context.Background(), "token", "message-2")
	if err != nil {
		t.Fatalf("second fetchMessageInfo returned error: %v", err)
	}
	if channelID != "channel-2" {
		t.Fatalf("second channelID = %q, want %q", channelID, "channel-2")
	}
	if !isBot {
		t.Fatal("second isBot = false, want true")
	}

	wantPaths := []string{"/api/v3/messages/message-1", "/api/v3/users/user-1", "/api/v3/messages/message-2"}
	if !reflect.DeepEqual(paths, wantPaths) {
		t.Fatalf("paths = %v, want %v", paths, wantPaths)
	}
}

func TestUserBotCacheReplacesRandomUserAtLimit(t *testing.T) {
	srv := &server{}

	for i := 0; i < userBotCacheLimit; i++ {
		srv.storeUserIsBot(fmt.Sprintf("user-%d", i), i%2 == 0)
	}
	srv.storeUserIsBot("overflow-user", true)

	if len(srv.userBotCache) != userBotCacheLimit {
		t.Fatalf("user bot cache size = %d, want %d", len(srv.userBotCache), userBotCacheLimit)
	}
	if isBot, ok := srv.cachedUserIsBot("overflow-user"); !ok || !isBot {
		t.Fatalf("overflow user cache = (%t, %t), want (true, true)", isBot, ok)
	}
}

func jsonResponse(r *http.Request, body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Status:     "200 OK",
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    r,
	}
}
