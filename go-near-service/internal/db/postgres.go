package db

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DB wraps a pgx connection pool for PostgreSQL.
type DB struct {
	Pool *pgxpool.Pool
}

// UserIdentity represents a record in x_identities.
type UserIdentity struct {
	XID         string    `json:"xId"`
	XHandle     string    `json:"xHandle"`
	XName       string    `json:"xName"`
	NearAccount *string   `json:"nearAccount,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// UserSession represents an active session in user_sessions.
type UserSession struct {
	SessionID   string    `json:"sessionId"`
	XID         string    `json:"xId"`
	XHandle     string    `json:"xHandle"`
	XName       string    `json:"xName"`
	NearAccount *string   `json:"nearAccount,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

// Passkey represents a WebAuthn passkey in passkeys.
type Passkey struct {
	ID           string    `json:"id"`
	XID          string    `json:"xId"`
	CredentialID string    `json:"credentialId"`
	PublicKey    string    `json:"publicKey"`
	Counter      int64     `json:"counter"`
	CreatedAt    time.Time `json:"createdAt"`
}

// New constructs and connects to PostgreSQL.
func New(ctx context.Context, connString string) (*DB, error) {
	cleanConn := strings.TrimSpace(connString)
	if cleanConn == "" {
		cleanConn = "postgres://postgres@127.0.0.1:5432/uprail"
	}

	config, err := pgxpool.ParseConfig(cleanConn)
	if err != nil {
		return nil, fmt.Errorf("parse postgres config: %w", err)
	}

	config.MaxConns = 10
	config.MinConns = 2
	config.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("connect to postgres: %w", err)
	}

	// Verify connection
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}

	return &DB{Pool: pool}, nil
}

// Close closes the underlying pool.
func (d *DB) Close() {
	if d.Pool != nil {
		d.Pool.Close()
	}
}

// UpsertIdentity inserts or updates an X user identity.
func (d *DB) UpsertIdentity(ctx context.Context, xID, handle, name string) (*UserIdentity, error) {
	query := `
		INSERT INTO x_identities (x_id, x_handle, x_name, created_at, updated_at)
		VALUES ($1, $2, $3, NOW(), NOW())
		ON CONFLICT (x_id) DO UPDATE SET
			x_handle = EXCLUDED.x_handle,
			x_name = EXCLUDED.x_name,
			updated_at = NOW()
		RETURNING x_id, x_handle, x_name, near_account, created_at, updated_at;
	`
	row := d.Pool.QueryRow(ctx, query, xID, strings.ToLower(handle), name)

	var user UserIdentity
	if err := row.Scan(&user.XID, &user.XHandle, &user.XName, &user.NearAccount, &user.CreatedAt, &user.UpdatedAt); err != nil {
		return nil, fmt.Errorf("upsert identity: %w", err)
	}
	return &user, nil
}

// GetIdentity retrieves an identity by X ID.
func (d *DB) GetIdentity(ctx context.Context, xID string) (*UserIdentity, error) {
	query := `
		SELECT x_id, x_handle, x_name, near_account, created_at, updated_at
		FROM x_identities
		WHERE x_id = $1;
	`
	row := d.Pool.QueryRow(ctx, query, xID)

	var user UserIdentity
	if err := row.Scan(&user.XID, &user.XHandle, &user.XName, &user.NearAccount, &user.CreatedAt, &user.UpdatedAt); err != nil {
		return nil, fmt.Errorf("get identity: %w", err)
	}
	return &user, nil
}

// UpdateNearAccount binds a NEAR account to an X identity.
func (d *DB) UpdateNearAccount(ctx context.Context, xID, nearAccount string) error {
	query := `
		UPDATE x_identities
		SET near_account = $1, updated_at = NOW()
		WHERE x_id = $2;
	`
	_, err := d.Pool.Exec(ctx, query, nearAccount, xID)
	return err
}

// SaveSession writes an active user session to Postgres.
func (d *DB) SaveSession(ctx context.Context, session UserSession) error {
	query := `
		INSERT INTO user_sessions (session_id, x_id, x_handle, x_name, near_account, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (session_id) DO UPDATE SET
			near_account = EXCLUDED.near_account,
			expires_at = EXCLUDED.expires_at;
	`
	_, err := d.Pool.Exec(ctx, query,
		session.SessionID,
		session.XID,
		strings.ToLower(session.XHandle),
		session.XName,
		session.NearAccount,
		session.CreatedAt,
		session.ExpiresAt,
	)
	return err
}

// GetSession reads an unexpired session from Postgres.
func (d *DB) GetSession(ctx context.Context, sessionID string) (*UserSession, error) {
	query := `
		SELECT session_id, x_id, x_handle, x_name, near_account, created_at, expires_at
		FROM user_sessions
		WHERE session_id = $1 AND expires_at > NOW();
	`
	row := d.Pool.QueryRow(ctx, query, sessionID)

	var sess UserSession
	if err := row.Scan(
		&sess.SessionID,
		&sess.XID,
		&sess.XHandle,
		&sess.XName,
		&sess.NearAccount,
		&sess.CreatedAt,
		&sess.ExpiresAt,
	); err != nil {
		return nil, fmt.Errorf("get session: %w", err)
	}
	return &sess, nil
}

// DeleteSession removes a session on logout.
func (d *DB) DeleteSession(ctx context.Context, sessionID string) error {
	query := `DELETE FROM user_sessions WHERE session_id = $1;`
	_, err := d.Pool.Exec(ctx, query, sessionID)
	return err
}
