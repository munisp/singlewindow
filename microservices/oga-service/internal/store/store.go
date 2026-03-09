// store — PostgreSQL data access for oga-service
package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

// OGAPermit mirrors the oga_permits table
type OGAPermit struct {
	ID            int64      `json:"id"`
	DeclarationId int64      `json:"declarationId"`
	AgencyCode    string     `json:"agencyCode"`
	AgencyName    string     `json:"agencyName"`
	PermitType    *string    `json:"permitType,omitempty"`
	Status        string     `json:"status"`
	PermitNumber  *string    `json:"permitNumber,omitempty"`
	ReviewNotes   *string    `json:"reviewNotes,omitempty"`
	ReviewedBy    *string    `json:"reviewedBy,omitempty"`
	SLADeadline   *time.Time `json:"slaDeadline,omitempty"`
	RespondedAt   *time.Time `json:"respondedAt,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

// SLAStats represents SLA performance metrics for an agency
type SLAStats struct {
	AgencyCode    string  `json:"agencyCode"`
	AgencyName    string  `json:"agencyName"`
	TotalPermits  int     `json:"totalPermits"`
	Approved      int     `json:"approved"`
	Rejected      int     `json:"rejected"`
	Pending       int     `json:"pending"`
	Overdue       int     `json:"overdue"`
	AvgHours      float64 `json:"avgResponseHours"`
	SLACompliance float64 `json:"slaCompliancePercent"`
}

// Store provides database access
type Store struct {
	db *sql.DB
}

func New(dsn string) (*Store, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

// GetPermit retrieves an OGA permit by ID
func (s *Store) GetPermit(ctx context.Context, id int64) (*OGAPermit, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, declaration_id, agency_code, agency_name, permit_type, status,
		       permit_number, review_notes, reviewed_by, sla_deadline, responded_at, created_at, updated_at
		FROM oga_permits WHERE id = $1`, id)

	p := &OGAPermit{}
	err := row.Scan(&p.ID, &p.DeclarationId, &p.AgencyCode, &p.AgencyName, &p.PermitType,
		&p.Status, &p.PermitNumber, &p.ReviewNotes, &p.ReviewedBy, &p.SLADeadline,
		&p.RespondedAt, &p.CreatedAt, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return p, err
}

// ListPermits retrieves permits with optional filters
func (s *Store) ListPermits(ctx context.Context, agencyCode, status *string, limit, offset int) ([]OGAPermit, int, error) {
	query := `SELECT id, declaration_id, agency_code, agency_name, permit_type, status,
		       permit_number, review_notes, reviewed_by, sla_deadline, responded_at, created_at, updated_at
		FROM oga_permits WHERE 1=1`
	args := []interface{}{}
	argIdx := 1

	if agencyCode != nil {
		query += fmt.Sprintf(" AND agency_code = $%d", argIdx)
		args = append(args, *agencyCode)
		argIdx++
	}
	if status != nil {
		query += fmt.Sprintf(" AND status = $%d", argIdx)
		args = append(args, *status)
		argIdx++
	}

	countQuery := "SELECT COUNT(*) FROM (" + query + ") t"
	var total int
	s.db.QueryRowContext(ctx, countQuery, args...).Scan(&total)

	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var permits []OGAPermit
	for rows.Next() {
		p := OGAPermit{}
		err := rows.Scan(&p.ID, &p.DeclarationId, &p.AgencyCode, &p.AgencyName, &p.PermitType,
			&p.Status, &p.PermitNumber, &p.ReviewNotes, &p.ReviewedBy, &p.SLADeadline,
			&p.RespondedAt, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			return nil, 0, err
		}
		permits = append(permits, p)
	}
	return permits, total, rows.Err()
}

// ApprovePermit approves an OGA permit
func (s *Store) ApprovePermit(ctx context.Context, id int64, permitNumber, reviewedBy, notes string) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx, `
		UPDATE oga_permits
		SET status = 'approved', permit_number = $1, reviewed_by = $2,
		    review_notes = $3, responded_at = $4, updated_at = NOW()
		WHERE id = $5`,
		permitNumber, reviewedBy, notes, now, id)
	return err
}

// RejectPermit rejects an OGA permit
func (s *Store) RejectPermit(ctx context.Context, id int64, reviewedBy, reason string) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx, `
		UPDATE oga_permits
		SET status = 'rejected', reviewed_by = $1, review_notes = $2,
		    responded_at = $3, updated_at = NOW()
		WHERE id = $4`,
		reviewedBy, reason, now, id)
	return err
}

// GetOverduePermits retrieves permits past their SLA deadline
func (s *Store) GetOverduePermits(ctx context.Context) ([]OGAPermit, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, declaration_id, agency_code, agency_name, permit_type, status,
		       permit_number, review_notes, reviewed_by, sla_deadline, responded_at, created_at, updated_at
		FROM oga_permits
		WHERE status = 'pending' AND sla_deadline IS NOT NULL AND sla_deadline < NOW()
		ORDER BY sla_deadline`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var permits []OGAPermit
	for rows.Next() {
		p := OGAPermit{}
		rows.Scan(&p.ID, &p.DeclarationId, &p.AgencyCode, &p.AgencyName, &p.PermitType,
			&p.Status, &p.PermitNumber, &p.ReviewNotes, &p.ReviewedBy, &p.SLADeadline,
			&p.RespondedAt, &p.CreatedAt, &p.UpdatedAt)
		permits = append(permits, p)
	}
	return permits, rows.Err()
}

// GetSLAStats returns SLA performance statistics per agency
func (s *Store) GetSLAStats(ctx context.Context) ([]SLAStats, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT
			agency_code,
			agency_name,
			COUNT(*) as total,
			SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
			SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
			SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
			SUM(CASE WHEN status = 'pending' AND sla_deadline < NOW() THEN 1 ELSE 0 END) as overdue,
			COALESCE(AVG(EXTRACT(EPOCH FROM (responded_at - created_at))/3600), 0) as avg_hours,
			COALESCE(
				100.0 * SUM(CASE WHEN responded_at IS NOT NULL AND responded_at <= sla_deadline THEN 1 ELSE 0 END) /
				NULLIF(SUM(CASE WHEN responded_at IS NOT NULL THEN 1 ELSE 0 END), 0),
				0
			) as sla_compliance
		FROM oga_permits
		GROUP BY agency_code, agency_name
		ORDER BY agency_code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stats []SLAStats
	for rows.Next() {
		s := SLAStats{}
		rows.Scan(&s.AgencyCode, &s.AgencyName, &s.TotalPermits, &s.Approved,
			&s.Rejected, &s.Pending, &s.Overdue, &s.AvgHours, &s.SLACompliance)
		stats = append(stats, s)
	}
	return stats, rows.Err()
}
