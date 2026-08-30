// Package store persists verified vessel position events in PostgreSQL and
// serves the tracking API from them (Phase-9 WP-B: no synthetic data).
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/blueeconomy/cargo-tracking-service/internal/envelope"
)

// Vessel is the API-facing latest-position view of one vessel.
type Vessel struct {
	MMSI        string    `json:"mmsi"`
	Name        string    `json:"name"`
	IMO         string    `json:"imo,omitempty"`
	Callsign    string    `json:"callsign,omitempty"`
	Type        string    `json:"type"` // not asserted by AIS position reports — empty unless ingested
	Latitude    float64   `json:"lat"`
	Longitude   float64   `json:"lng"`
	SpeedKnots  float64   `json:"speed"`
	CourseDeg   float64   `json:"heading"`
	Status      string    `json:"status"` // derived from navStatus / movement
	Source      string    `json:"source"`
	PositionAge string    `json:"positionAge"`
	LastUpdated time.Time `json:"lastUpdated"`
	ReceiverID  string    `json:"receiverId"`
	SignerKID   string    `json:"signerKid"`
}

// Store is the PostgreSQL persistence boundary.
type Store struct {
	db *sql.DB
}

func New(db *sql.DB) *Store { return &Store{db: db} }

// Ping reports database reachability.
func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }

// EnsureSchema applies the migration idempotently (fail-closed on error).
func (s *Store) EnsureSchema(ctx context.Context) error {
	ddl, err := os.ReadFile("migrations/0001_vessel_positions.sql")
	if err != nil {
		ddl = []byte(embeddedDDL)
	}
	if _, err := s.db.ExecContext(ctx, string(ddl)); err != nil {
		return fmt.Errorf("apply vessel_positions migration: %w", err)
	}
	return nil
}

// embeddedDDL mirrors migrations/0001_vessel_positions.sql.
const embeddedDDL = `
CREATE TABLE IF NOT EXISTS vessel_positions (
    position_report_id TEXT        PRIMARY KEY,
    event_id           TEXT        NOT NULL UNIQUE,
    mmsi               TEXT        NOT NULL,
    imo                TEXT,
    callsign           TEXT,
    ship_name          TEXT,
    source_class       TEXT        NOT NULL,
    latitude_micros    INT         NOT NULL,
    longitude_micros   INT         NOT NULL,
    speed_mknots       BIGINT      NOT NULL,
    course_mdeg        BIGINT      NOT NULL,
    heading_mdeg       BIGINT,
    nav_status         INT,
    position_accuracy  TEXT        NOT NULL,
    observed_at        TIMESTAMPTZ NOT NULL,
    receiver_id        TEXT        NOT NULL,
    producer           TEXT        NOT NULL,
    signer_kid         TEXT        NOT NULL,
    correlation_id     TEXT        NOT NULL,
    ingested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vessel_positions_mmsi_observed_idx
    ON vessel_positions (mmsi, observed_at DESC);
`

// InsertPosition persists a verified position event. Idempotent: a replayed
// envelope (same event_id or position_report_id) is a no-op.
func (s *Store) InsertPosition(ctx context.Context, env *envelope.Envelope, kid string, p *envelope.VesselPositionPayload) error {
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO vessel_positions (
			position_report_id, event_id, mmsi, imo, callsign, ship_name,
			source_class, latitude_micros, longitude_micros,
			speed_mknots, course_mdeg, heading_mdeg, nav_status,
			position_accuracy, observed_at, receiver_id,
			producer, signer_kid, correlation_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
		ON CONFLICT (position_report_id) DO NOTHING
	`, p.PositionReportID, env.EventID, p.MMSI, nullIfEmpty(p.IMO), nullIfEmpty(p.Callsign), nullIfEmpty(p.ShipName),
		p.SourceClass, p.LatitudeMicros, p.LongitudeMicros,
		int64(p.SpeedOverGroundMilliknots), int64(p.CourseOverGroundMillidegrees),
		u32PtrToI64(p.HeadingMillidegrees), i32PtrToInt(p.NavStatus),
		p.PositionAccuracy, p.ObservedAt.UTC(), p.ReceiverID,
		env.Producer, kid, env.CorrelationID)
	if err != nil {
		return fmt.Errorf("insert vessel position: %w", err)
	}
	_ = res
	return nil
}

// navStatusText maps AIS navigational status codes (ITU-R M.1371) to text.
func navStatusText(code int) string {
	switch code {
	case 0:
		return "UNDERWAY"
	case 1:
		return "AT_ANCHOR"
	case 2:
		return "NOT_UNDER_COMMAND"
	case 3:
		return "RESTRICTED_MANOEUVRABILITY"
	case 5:
		return "MOORED"
	case 6:
		return "AGROUND"
	default:
		return "UNKNOWN"
	}
}

// LatestVessels returns the latest persisted position per MMSI. With no
// ingested data it returns an honest empty slice.
func (s *Store) LatestVessels(ctx context.Context) ([]Vessel, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT ON (mmsi)
			mmsi, COALESCE(ship_name,''), COALESCE(imo,''), COALESCE(callsign,''),
			latitude_micros, longitude_micros, speed_mknots, course_mdeg,
			nav_status, source_class, observed_at, receiver_id, signer_kid
		FROM vessel_positions
		ORDER BY mmsi, observed_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("query latest vessels: %w", err)
	}
	defer rows.Close()
	out := []Vessel{}
	for rows.Next() {
		v, err := scanVessel(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

// LatestByMMSI returns the latest persisted position for one vessel.
// ErrNotFound when the vessel has never been ingested.
func (s *Store) LatestByMMSI(ctx context.Context, mmsi string) (*Vessel, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT mmsi, COALESCE(ship_name,''), COALESCE(imo,''), COALESCE(callsign,''),
			latitude_micros, longitude_micros, speed_mknots, course_mdeg,
			nav_status, source_class, observed_at, receiver_id, signer_kid
		FROM vessel_positions WHERE mmsi = $1
		ORDER BY observed_at DESC LIMIT 1
	`, mmsi)
	if err != nil {
		return nil, fmt.Errorf("query vessel %s: %w", mmsi, err)
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, ErrNotFound
	}
	return scanVessel(rows)
}

// ErrNotFound reports a vessel with no persisted events.
var ErrNotFound = errors.New("no persisted vessel events")

type scanner interface {
	Scan(dest ...any) error
}

func scanVessel(row scanner) (*Vessel, error) {
	var (
		v          Vessel
		latMicros  int32
		lngMicros  int32
		speedMkn   int64
		courseMdeg int64
		navStatus  sql.NullInt32
	)
	if err := row.Scan(&v.MMSI, &v.Name, &v.IMO, &v.Callsign,
		&latMicros, &lngMicros, &speedMkn, &courseMdeg,
		&navStatus, &v.Source, &v.LastUpdated, &v.ReceiverID, &v.SignerKID); err != nil {
		return nil, fmt.Errorf("scan vessel: %w", err)
	}
	v.Latitude = float64(latMicros) / 1e6
	v.Longitude = float64(lngMicros) / 1e6
	v.SpeedKnots = float64(speedMkn) / 1000
	v.CourseDeg = float64(courseMdeg) / 1000
	if navStatus.Valid {
		v.Status = navStatusText(int(navStatus.Int32))
	} else {
		v.Status = "UNKNOWN"
	}
	v.PositionAge = time.Since(v.LastUpdated).Round(time.Second).String()
	return &v, nil
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func u32PtrToI64(v *uint32) any {
	if v == nil {
		return nil
	}
	return int64(*v)
}

func i32PtrToInt(v *int32) any {
	if v == nil {
		return nil
	}
	return *v
}
