package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestHandleLoginUsesAuthorizationCodeFlow(t *testing.T) {
	srv, err := newServer(config{
		appOrigin:        "http://localhost:5173",
		traqBaseURL:      "https://q.trap.jp",
		oauthClientID:    "client-id",
		oauthRedirectURL: "http://localhost:5173/oauth/callback",
		oauthScope:       "read",
	})
	if err != nil {
		t.Fatalf("newServer returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/login", nil)
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusFound)
	}
	location, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatalf("Location is invalid: %v", err)
	}
	values := location.Query()
	if values.Get("response_type") != "code" {
		t.Fatalf("response_type = %q, want code", values.Get("response_type"))
	}
	if values.Get("client_id") != "client-id" {
		t.Fatalf("client_id = %q, want client-id", values.Get("client_id"))
	}
	if values.Get("state") == "" {
		t.Fatal("state was empty")
	}
}

func TestSessionTokenRejectsExpiredSession(t *testing.T) {
	srv, err := newServer(config{})
	if err != nil {
		t.Fatalf("newServer returned error: %v", err)
	}

	srv.sessions["expired-session"] = authSession{
		Token:     tokenResponse{AccessToken: "expired-access-token"},
		ExpiresAt: time.Now().Add(-time.Second),
	}

	req := httptest.NewRequest(http.MethodGet, "/api/events", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "expired-session"})

	if token, ok := srv.sessionToken(req); ok {
		t.Fatalf("sessionToken returned ok with token %#v, want expired session rejection", token)
	}
	if _, ok := srv.sessions["expired-session"]; ok {
		t.Fatal("expired session was not removed")
	}
}

func TestSessionTokenLoadsPersistedSession(t *testing.T) {
	srv, err := newServer(config{})
	if err != nil {
		t.Fatalf("newServer returned error: %v", err)
	}
	expiresAt := time.Now().Add(time.Hour)
	srv.store = &fakePersistenceStore{
		sessions: map[string]authSession{
			"persisted-session": {
				Token:     tokenResponse{AccessToken: "persisted-access-token"},
				ExpiresAt: expiresAt,
			},
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/events", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "persisted-session"})

	token, ok := srv.sessionToken(req)
	if !ok {
		t.Fatal("sessionToken rejected persisted session")
	}
	if token.AccessToken != "persisted-access-token" {
		t.Fatalf("access token = %q, want persisted-access-token", token.AccessToken)
	}
	if _, ok := srv.sessions["persisted-session"]; !ok {
		t.Fatal("persisted session was not cached in memory")
	}
}

func TestSessionTokenDeletesExpiredPersistedSession(t *testing.T) {
	srv, err := newServer(config{})
	if err != nil {
		t.Fatalf("newServer returned error: %v", err)
	}
	store := &fakePersistenceStore{
		sessions: map[string]authSession{
			"expired-persisted-session": {
				Token:     tokenResponse{AccessToken: "expired-access-token"},
				ExpiresAt: time.Now().Add(-time.Second),
			},
		},
	}
	srv.store = store

	req := httptest.NewRequest(http.MethodGet, "/api/events", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "expired-persisted-session"})

	if token, ok := srv.sessionToken(req); ok {
		t.Fatalf("sessionToken returned ok with token %#v, want expired session rejection", token)
	}
	if !store.deleted["expired-persisted-session"] {
		t.Fatal("expired persisted session was not deleted")
	}
}

type fakePersistenceStore struct {
	sessions map[string]authSession
	deleted  map[string]bool
}

func (s *fakePersistenceStore) SaveAuthSession(_ context.Context, sessionID string, session authSession) error {
	if s.sessions == nil {
		s.sessions = map[string]authSession{}
	}
	s.sessions[sessionID] = session
	return nil
}

func (s *fakePersistenceStore) FindAuthSession(_ context.Context, sessionID string) (authSession, bool, error) {
	session, ok := s.sessions[sessionID]
	return session, ok, nil
}

func (s *fakePersistenceStore) DeleteAuthSession(_ context.Context, sessionID string) error {
	if s.deleted == nil {
		s.deleted = map[string]bool{}
	}
	s.deleted[sessionID] = true
	delete(s.sessions, sessionID)
	return nil
}

func (s *fakePersistenceStore) DeleteExpiredAuthSessions(_ context.Context, now time.Time) error {
	for sessionID, session := range s.sessions {
		if !now.Before(session.ExpiresAt) {
			_ = s.DeleteAuthSession(context.Background(), sessionID)
		}
	}
	return nil
}

func (s *fakePersistenceStore) LoadChannelScores(context.Context) (map[string]scoreRecord, error) {
	return nil, nil
}

func (s *fakePersistenceStore) SaveChannelScores(context.Context, []scoreRecord) error {
	return nil
}

func (s *fakePersistenceStore) Close() error {
	return nil
}
