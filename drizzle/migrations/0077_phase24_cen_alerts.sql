-- Phase 24: persist CEN (WCO Customs Enforcement Network) alerts for cen-service.
-- Replaces the in-memory alertStore map. No seed data — rows are created only
-- by real outbound dispatches and inbound alert ingestion.
CREATE TABLE IF NOT EXISTS cen_alerts (
	id text PRIMARY KEY,
	direction varchar(16) NOT NULL,
	partner_code varchar(16) NOT NULL,
	alert_type varchar(32) NOT NULL,
	priority varchar(16) NOT NULL,
	subject text NOT NULL,
	description text NOT NULL,
	trader_ref varchar(128) NOT NULL DEFAULT '',
	ucr varchar(64) NOT NULL DEFAULT '',
	hs_code varchar(16) NOT NULL DEFAULT '',
	risk_score double precision NOT NULL DEFAULT 0,
	status varchar(32) NOT NULL,
	xml_payload text NOT NULL DEFAULT '',
	correlated_with jsonb NOT NULL DEFAULT '[]'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cen_alerts_status ON cen_alerts (status);
CREATE INDEX IF NOT EXISTS idx_cen_alerts_severity ON cen_alerts (priority);
CREATE INDEX IF NOT EXISTS idx_cen_alerts_direction ON cen_alerts (direction);
CREATE INDEX IF NOT EXISTS idx_cen_alerts_created ON cen_alerts (created_at);
