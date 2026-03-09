// store — PostgreSQL data access for declaration-service
package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

// Declaration mirrors the declarations table
type Declaration struct {
	ID                  int64      `json:"id"`
	DeclarationNumber   string     `json:"declarationNumber"`
	TraderId            int64      `json:"traderId"`
	Status              string     `json:"status"`
	RiskScore           *float64   `json:"riskScore,omitempty"`
	RiskLane            *string    `json:"riskLane,omitempty"`
	HSCode              string     `json:"hsCode"`
	GoodsDescription    string     `json:"goodsDescription"`
	OriginCountry       string     `json:"originCountry"`
	DestinationCountry  string     `json:"destinationCountry"`
	DeclaredValue       float64    `json:"declaredValue"`
	Currency            string     `json:"currency"`
	GrossWeight         *float64   `json:"grossWeight,omitempty"`
	NetWeight           *float64   `json:"netWeight,omitempty"`
	Packages            *int       `json:"packages,omitempty"`
	VesselName          *string    `json:"vesselName,omitempty"`
	VoyageNumber        *string    `json:"voyageNumber,omitempty"`
	PortOfLoading       *string    `json:"portOfLoading,omitempty"`
	PortOfDischarge     *string    `json:"portOfDischarge,omitempty"`
	SubmittedAt         *time.Time `json:"submittedAt,omitempty"`
	ClearedAt           *time.Time `json:"clearedAt,omitempty"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
}

// OGAPermit mirrors the oga_permits table
type OGAPermit struct {
	ID           int64      `json:"id"`
	DeclarationId int64     `json:"declarationId"`
	AgencyCode   string     `json:"agencyCode"`
	AgencyName   string     `json:"agencyName"`
	PermitType   *string    `json:"permitType,omitempty"`
	Status       string     `json:"status"`
	PermitNumber *string    `json:"permitNumber,omitempty"`
	RespondedAt  *time.Time `json:"respondedAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

// Store provides database access
type Store struct {
	db *sql.DB
}

// New creates a new Store connected to PostgreSQL
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

// Close closes the database connection
func (s *Store) Close() error {
	return s.db.Close()
}

// GetDeclaration retrieves a declaration by ID
func (s *Store) GetDeclaration(ctx context.Context, id int64) (*Declaration, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, declaration_number, trader_id, status, risk_score, risk_lane,
		       hs_code, goods_description, origin_country, destination_country,
		       declared_value, currency, gross_weight, net_weight, packages,
		       vessel_name, voyage_number, port_of_loading, port_of_discharge,
		       submitted_at, cleared_at, created_at, updated_at
		FROM declarations WHERE id = $1`, id)

	d := &Declaration{}
	err := row.Scan(
		&d.ID, &d.DeclarationNumber, &d.TraderId, &d.Status, &d.RiskScore, &d.RiskLane,
		&d.HSCode, &d.GoodsDescription, &d.OriginCountry, &d.DestinationCountry,
		&d.DeclaredValue, &d.Currency, &d.GrossWeight, &d.NetWeight, &d.Packages,
		&d.VesselName, &d.VoyageNumber, &d.PortOfLoading, &d.PortOfDischarge,
		&d.SubmittedAt, &d.ClearedAt, &d.CreatedAt, &d.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get declaration: %w", err)
	}
	return d, nil
}

// UpdateDeclarationStatus updates the status of a declaration
func (s *Store) UpdateDeclarationStatus(ctx context.Context, id int64, status string) error {
	var clearedAt interface{}
	if status == "cleared" {
		now := time.Now()
		clearedAt = now
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE declarations
		SET status = $1, cleared_at = COALESCE($2, cleared_at), updated_at = NOW()
		WHERE id = $3`,
		status, clearedAt, id)
	return err
}

// UpdateDeclarationRiskScore updates the risk score and lane
func (s *Store) UpdateDeclarationRiskScore(ctx context.Context, id int64, score float64, lane string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE declarations
		SET risk_score = $1, risk_lane = $2, updated_at = NOW()
		WHERE id = $3`,
		score, lane, id)
	return err
}

// GetOGAPermits retrieves all OGA permits for a declaration
func (s *Store) GetOGAPermits(ctx context.Context, declarationId int64) ([]OGAPermit, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, declaration_id, agency_code, agency_name, permit_type, status,
		       permit_number, responded_at, created_at, updated_at
		FROM oga_permits WHERE declaration_id = $1 ORDER BY created_at`, declarationId)
	if err != nil {
		return nil, fmt.Errorf("get oga permits: %w", err)
	}
	defer rows.Close()

	var permits []OGAPermit
	for rows.Next() {
		p := OGAPermit{}
		err := rows.Scan(
			&p.ID, &p.DeclarationId, &p.AgencyCode, &p.AgencyName, &p.PermitType,
			&p.Status, &p.PermitNumber, &p.RespondedAt, &p.CreatedAt, &p.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan oga permit: %w", err)
		}
		permits = append(permits, p)
	}
	return permits, rows.Err()
}

// CreateOGAPermit creates a new OGA permit
func (s *Store) CreateOGAPermit(ctx context.Context, p *OGAPermit) (int64, error) {
	var id int64
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO oga_permits (declaration_id, agency_code, agency_name, permit_type, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, 'pending', NOW(), NOW())
		RETURNING id`,
		p.DeclarationId, p.AgencyCode, p.AgencyName, p.PermitType,
	).Scan(&id)
	return id, err
}

// UpdateOGAPermitStatus updates the status of an OGA permit
func (s *Store) UpdateOGAPermitStatus(ctx context.Context, id int64, status, permitNumber string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE oga_permits
		SET status = $1, permit_number = COALESCE(NULLIF($2,''), permit_number),
		    responded_at = CASE WHEN $1 IN ('approved','rejected') THEN NOW() ELSE responded_at END,
		    updated_at = NOW()
		WHERE id = $3`,
		status, permitNumber, id)
	return err
}

// AllOGAPermitsResolved checks if all OGA permits for a declaration are resolved
func (s *Store) AllOGAPermitsResolved(ctx context.Context, declarationId int64) (allApproved bool, anyRejected bool, err error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT status FROM oga_permits WHERE declaration_id = $1`, declarationId)
	if err != nil {
		return false, false, err
	}
	defer rows.Close()

	total := 0
	approved := 0
	rejected := 0
	for rows.Next() {
		var status string
		if err := rows.Scan(&status); err != nil {
			return false, false, err
		}
		total++
		if status == "approved" {
			approved++
		} else if status == "rejected" {
			rejected++
		}
	}
	if total == 0 {
		return true, false, nil // No permits required
	}
	return approved == total, rejected > 0, rows.Err()
}

// ListDeclarations retrieves declarations with optional filters
func (s *Store) ListDeclarations(ctx context.Context, traderId *int64, status *string, limit, offset int) ([]Declaration, int, error) {
	query := `SELECT id, declaration_number, trader_id, status, risk_score, risk_lane,
		       hs_code, goods_description, origin_country, destination_country,
		       declared_value, currency, gross_weight, net_weight, packages,
		       vessel_name, voyage_number, port_of_loading, port_of_discharge,
		       submitted_at, cleared_at, created_at, updated_at
		FROM declarations WHERE 1=1`
	args := []interface{}{}
	argIdx := 1

	if traderId != nil {
		query += fmt.Sprintf(" AND trader_id = $%d", argIdx)
		args = append(args, *traderId)
		argIdx++
	}
	if status != nil {
		query += fmt.Sprintf(" AND status = $%d", argIdx)
		args = append(args, *status)
		argIdx++
	}

	countQuery := "SELECT COUNT(*) FROM (" + query + ") t"
	var total int
	if err := s.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count declarations: %w", err)
	}

	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list declarations: %w", err)
	}
	defer rows.Close()

	var decls []Declaration
	for rows.Next() {
		d := Declaration{}
		err := rows.Scan(
			&d.ID, &d.DeclarationNumber, &d.TraderId, &d.Status, &d.RiskScore, &d.RiskLane,
			&d.HSCode, &d.GoodsDescription, &d.OriginCountry, &d.DestinationCountry,
			&d.DeclaredValue, &d.Currency, &d.GrossWeight, &d.NetWeight, &d.Packages,
			&d.VesselName, &d.VoyageNumber, &d.PortOfLoading, &d.PortOfDischarge,
			&d.SubmittedAt, &d.ClearedAt, &d.CreatedAt, &d.UpdatedAt,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("scan declaration: %w", err)
		}
		decls = append(decls, d)
	}
	return decls, total, rows.Err()
}
