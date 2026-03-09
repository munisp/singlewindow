// store — PostgreSQL data access for profile-service
package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

// TraderProfile mirrors the trader_profiles table
type TraderProfile struct {
	ID                  int64      `json:"id"`
	UserId              int64      `json:"userId"`
	TIN                 string     `json:"tin"`
	CompanyName         string     `json:"companyName"`
	CompanyType         string     `json:"companyType"`
	RegistrationNumber  string     `json:"registrationNumber"`
	Country             string     `json:"country"`
	Address             *string    `json:"address,omitempty"`
	Phone               *string    `json:"phone,omitempty"`
	Email               *string    `json:"email,omitempty"`
	KYCStatus           string     `json:"kycStatus"`
	KYCVerifiedAt       *time.Time `json:"kycVerifiedAt,omitempty"`
	AEOStatus           string     `json:"aeoStatus"`
	AEOTier             *string    `json:"aeoTier,omitempty"`
	ComplianceScore     float64    `json:"complianceScore"`
	TotalDeclarations   int        `json:"totalDeclarations"`
	ClearedDeclarations int        `json:"clearedDeclarations"`
	RejectedDeclarations int       `json:"rejectedDeclarations"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
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

// GetProfile retrieves a trader profile by ID
func (s *Store) GetProfile(ctx context.Context, id int64) (*TraderProfile, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, tin, company_name, company_type, registration_number,
		       country, address, phone, email, kyc_status, kyc_verified_at,
		       aeo_status, aeo_tier, compliance_score,
		       total_declarations, cleared_declarations, rejected_declarations,
		       created_at, updated_at
		FROM trader_profiles WHERE id = $1`, id)

	p := &TraderProfile{}
	err := row.Scan(
		&p.ID, &p.UserId, &p.TIN, &p.CompanyName, &p.CompanyType, &p.RegistrationNumber,
		&p.Country, &p.Address, &p.Phone, &p.Email, &p.KYCStatus, &p.KYCVerifiedAt,
		&p.AEOStatus, &p.AEOTier, &p.ComplianceScore,
		&p.TotalDeclarations, &p.ClearedDeclarations, &p.RejectedDeclarations,
		&p.CreatedAt, &p.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return p, err
}

// UpdateProfile updates a trader profile
func (s *Store) UpdateProfile(ctx context.Context, id int64, address, phone, email *string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE trader_profiles
		SET address = COALESCE($1, address),
		    phone = COALESCE($2, phone),
		    email = COALESCE($3, email),
		    updated_at = NOW()
		WHERE id = $4`,
		address, phone, email, id)
	return err
}

// UpdateKYCStatus updates KYC verification status
func (s *Store) UpdateKYCStatus(ctx context.Context, id int64, status string) error {
	var verifiedAt interface{}
	if status == "verified" {
		verifiedAt = time.Now()
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE trader_profiles
		SET kyc_status = $1, kyc_verified_at = COALESCE($2, kyc_verified_at), updated_at = NOW()
		WHERE id = $3`,
		status, verifiedAt, id)
	return err
}

// UpdateAEOStatus updates AEO certification status
func (s *Store) UpdateAEOStatus(ctx context.Context, id int64, status, tier string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE trader_profiles
		SET aeo_status = $1, aeo_tier = NULLIF($2, ''), updated_at = NOW()
		WHERE id = $3`,
		status, tier, id)
	return err
}

// RecordDeclarationOutcome updates declaration counters and recalculates compliance score
func (s *Store) RecordDeclarationOutcome(ctx context.Context, traderId int64, cleared bool) error {
	var clearIncr, rejectIncr int
	if cleared {
		clearIncr = 1
	} else {
		rejectIncr = 1
	}

	_, err := s.db.ExecContext(ctx, `
		UPDATE trader_profiles
		SET total_declarations = total_declarations + 1,
		    cleared_declarations = cleared_declarations + $1,
		    rejected_declarations = rejected_declarations + $2,
		    compliance_score = CASE
		        WHEN (total_declarations + 1) = 0 THEN 100
		        ELSE ROUND(100.0 * (cleared_declarations + $1) / (total_declarations + 1), 2)
		    END,
		    updated_at = NOW()
		WHERE id = (SELECT id FROM trader_profiles WHERE user_id = $3 LIMIT 1)`,
		clearIncr, rejectIncr, traderId)
	return err
}

// ListProfiles retrieves trader profiles with optional filters
func (s *Store) ListProfiles(ctx context.Context, kycStatus, aeoStatus *string, limit, offset int) ([]TraderProfile, int, error) {
	query := `SELECT id, user_id, tin, company_name, company_type, registration_number,
		       country, address, phone, email, kyc_status, kyc_verified_at,
		       aeo_status, aeo_tier, compliance_score,
		       total_declarations, cleared_declarations, rejected_declarations,
		       created_at, updated_at
		FROM trader_profiles WHERE 1=1`
	args := []interface{}{}
	argIdx := 1

	if kycStatus != nil {
		query += fmt.Sprintf(" AND kyc_status = $%d", argIdx)
		args = append(args, *kycStatus)
		argIdx++
	}
	if aeoStatus != nil {
		query += fmt.Sprintf(" AND aeo_status = $%d", argIdx)
		args = append(args, *aeoStatus)
		argIdx++
	}

	countQuery := "SELECT COUNT(*) FROM (" + query + ") t"
	var total int
	s.db.QueryRowContext(ctx, countQuery, args...).Scan(&total)

	query += fmt.Sprintf(" ORDER BY compliance_score DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var profiles []TraderProfile
	for rows.Next() {
		p := TraderProfile{}
		err := rows.Scan(
			&p.ID, &p.UserId, &p.TIN, &p.CompanyName, &p.CompanyType, &p.RegistrationNumber,
			&p.Country, &p.Address, &p.Phone, &p.Email, &p.KYCStatus, &p.KYCVerifiedAt,
			&p.AEOStatus, &p.AEOTier, &p.ComplianceScore,
			&p.TotalDeclarations, &p.ClearedDeclarations, &p.RejectedDeclarations,
			&p.CreatedAt, &p.UpdatedAt,
		)
		if err != nil {
			return nil, 0, err
		}
		profiles = append(profiles, p)
	}
	return profiles, total, rows.Err()
}
