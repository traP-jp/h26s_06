package main

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

type persistenceStore interface {
	SaveAuthSession(context.Context, string, authSession) error
	FindAuthSession(context.Context, string) (authSession, bool, error)
	DeleteAuthSession(context.Context, string) error
	DeleteExpiredAuthSessions(context.Context, time.Time) error
	LoadChannelScores(context.Context) (map[string]scoreRecord, error)
	SaveChannelScores(context.Context, []scoreRecord) error
	Close() error
}

type mariaDBStore struct {
	db *sql.DB
}

func openMariaDBStore(ctx context.Context, cfg mariaDBConfig) (*mariaDBStore, error) {
	db, err := sql.Open("mysql", cfg.dsn())
	if err != nil {
		return nil, err
	}
	store := &mariaDBStore{db: db}
	if err := db.PingContext(ctx); err != nil {
		_ = store.Close()
		return nil, err
	}
	if err := store.ensureSchema(ctx); err != nil {
		_ = store.Close()
		return nil, err
	}
	return store, nil
}

func (cfg mariaDBConfig) dsn() string {
	mysqlCfg := mysql.Config{
		User:      cfg.user,
		Passwd:    cfg.password,
		Net:       "tcp",
		Addr:      net.JoinHostPort(cfg.hostname, cfg.port),
		DBName:    cfg.database,
		ParseTime: true,
		Loc:       time.UTC,
		Params: map[string]string{
			"charset": "utf8mb4",
		},
	}
	return mysqlCfg.FormatDSN()
}

func (s *mariaDBStore) ensureSchema(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS oauth_sessions (
			session_id VARCHAR(128) NOT NULL PRIMARY KEY,
			access_token TEXT NOT NULL,
			token_type VARCHAR(64) NOT NULL,
			expires_in INT NOT NULL,
			refresh_token TEXT NOT NULL,
			scope TEXT NOT NULL,
			expires_at DATETIME(6) NOT NULL,
			created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
			updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
			INDEX idx_oauth_sessions_expires_at (expires_at)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
		`CREATE TABLE IF NOT EXISTS channel_scores (
			channel_id VARCHAR(128) NOT NULL PRIMARY KEY,
			score DOUBLE NOT NULL,
			last_sync_score DOUBLE NOT NULL,
			last_sync_at DATETIME(6) NOT NULL,
			last_decay_at DATETIME(6) NOT NULL,
			last_view_at DATETIME(6) NULL,
			updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
	}
	for _, stmt := range statements {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func (s *mariaDBStore) SaveAuthSession(ctx context.Context, sessionID string, session authSession) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO oauth_sessions (
			session_id, access_token, token_type, expires_in, refresh_token, scope, expires_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			access_token = VALUES(access_token),
			token_type = VALUES(token_type),
			expires_in = VALUES(expires_in),
			refresh_token = VALUES(refresh_token),
			scope = VALUES(scope),
			expires_at = VALUES(expires_at)
	`, sessionID, session.Token.AccessToken, session.Token.TokenType, session.Token.ExpiresIn,
		session.Token.RefreshToken, session.Token.Scope, dbTime(session.ExpiresAt))
	return err
}

func (s *mariaDBStore) FindAuthSession(ctx context.Context, sessionID string) (authSession, bool, error) {
	var session authSession
	err := s.db.QueryRowContext(ctx, `
		SELECT access_token, token_type, expires_in, refresh_token, scope, expires_at
		FROM oauth_sessions
		WHERE session_id = ?
	`, sessionID).Scan(
		&session.Token.AccessToken,
		&session.Token.TokenType,
		&session.Token.ExpiresIn,
		&session.Token.RefreshToken,
		&session.Token.Scope,
		&session.ExpiresAt,
	)
	if err == sql.ErrNoRows {
		return authSession{}, false, nil
	}
	if err != nil {
		return authSession{}, false, err
	}
	session.ExpiresAt = session.ExpiresAt.UTC()
	return session, true, nil
}

func (s *mariaDBStore) DeleteAuthSession(ctx context.Context, sessionID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM oauth_sessions WHERE session_id = ?`, sessionID)
	return err
}

func (s *mariaDBStore) DeleteExpiredAuthSessions(ctx context.Context, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM oauth_sessions WHERE expires_at <= ?`, dbTime(now))
	return err
}

func (s *mariaDBStore) LoadChannelScores(ctx context.Context) (map[string]scoreRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT channel_id, score, last_sync_score, last_sync_at, last_decay_at, last_view_at
		FROM channel_scores
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := map[string]scoreRecord{}
	for rows.Next() {
		var record scoreRecord
		var lastViewAt sql.NullTime
		if err := rows.Scan(
			&record.ChannelID,
			&record.Score,
			&record.LastSyncScore,
			&record.LastSyncTime,
			&record.LastDecayTime,
			&lastViewAt,
		); err != nil {
			return nil, err
		}
		record.LastSyncTime = record.LastSyncTime.UTC()
		record.LastDecayTime = record.LastDecayTime.UTC()
		if lastViewAt.Valid {
			record.LastViewTime = lastViewAt.Time.UTC()
		}
		records[record.ChannelID] = record
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return records, nil
}

func (s *mariaDBStore) SaveChannelScores(ctx context.Context, records []scoreRecord) error {
	if len(records) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO channel_scores (
			channel_id, score, last_sync_score, last_sync_at, last_decay_at, last_view_at
		) VALUES (?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			score = VALUES(score),
			last_sync_score = VALUES(last_sync_score),
			last_sync_at = VALUES(last_sync_at),
			last_decay_at = VALUES(last_decay_at),
			last_view_at = VALUES(last_view_at)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, record := range records {
		if strings.TrimSpace(record.ChannelID) == "" {
			continue
		}
		if _, err := stmt.ExecContext(
			ctx,
			record.ChannelID,
			record.Score,
			record.LastSyncScore,
			dbTime(record.LastSyncTime),
			dbTime(record.LastDecayTime),
			dbNullTime(record.LastViewTime),
		); err != nil {
			return fmt.Errorf("save channel score %s: %w", record.ChannelID, err)
		}
	}
	return tx.Commit()
}

func (s *mariaDBStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func dbTime(t time.Time) time.Time {
	return t.UTC()
}

func dbNullTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return dbTime(t)
}
