-- cargo-tracking-service migrations — 0001_vessel_positions.sql
-- Phase-9 WP-B: persisted vessel positions ingested from verified
-- blueeconomy-geo-service geo.vessel-position.v1 envelopes (topic
-- vessels.events). /api/v1/vessels serves EXCLUSIVELY from this store —
-- there is no synthetic data path.

CREATE TABLE IF NOT EXISTS vessel_positions (
    position_report_id TEXT        PRIMARY KEY,     -- contract dedup key
    event_id           TEXT        NOT NULL UNIQUE, -- envelope eventId (idempotent ingest)
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
    signer_kid         TEXT        NOT NULL,        -- verified JWS kid (audit trail)
    correlation_id     TEXT        NOT NULL,
    ingested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vessel_positions_mmsi_observed_idx
    ON vessel_positions (mmsi, observed_at DESC);
