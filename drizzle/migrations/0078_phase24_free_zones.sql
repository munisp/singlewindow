-- Phase 24: persist free zone registry and goods inventory for freezone-service.
-- Replaces the in-memory zoneStore/goodsStore maps. No seed data.
-- (Goods records do NOT map onto the existing free_zone_operations table —
-- that table models approval operations, not inventory with duty/transfer
-- state — so a dedicated freezone_goods table is created.)
CREATE TABLE IF NOT EXISTS free_zones (
	id text PRIMARY KEY,
	name varchar(255) NOT NULL,
	code varchar(32) NOT NULL,
	location varchar(255) NOT NULL,
	operator_name varchar(255) NOT NULL,
	licence_number varchar(64) NOT NULL,
	zone_type varchar(32) NOT NULL,
	capacity_m3 double precision NOT NULL DEFAULT 0,
	used_m3 double precision NOT NULL DEFAULT 0,
	status varchar(16) NOT NULL DEFAULT 'ACTIVE',
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_free_zones_status ON free_zones (status);
CREATE INDEX IF NOT EXISTS idx_free_zones_code ON free_zones (code);

CREATE TABLE IF NOT EXISTS freezone_goods (
	id text PRIMARY KEY,
	zone_id text NOT NULL,
	ucr varchar(64) NOT NULL DEFAULT '',
	trader_ref varchar(128) NOT NULL DEFAULT '',
	hs_code varchar(16) NOT NULL DEFAULT '',
	description text NOT NULL DEFAULT '',
	origin_country varchar(2) NOT NULL DEFAULT '',
	gross_weight_kg double precision NOT NULL DEFAULT 0,
	volume_m3 double precision NOT NULL DEFAULT 0,
	invoice_value double precision NOT NULL DEFAULT 0,
	currency varchar(3) NOT NULL DEFAULT '',
	duty_rate double precision NOT NULL DEFAULT 0,
	duty_owed double precision NOT NULL DEFAULT 0,
	status varchar(16) NOT NULL DEFAULT 'ADMITTED',
	current_zone_id text NOT NULL DEFAULT '',
	exit_destination varchar(16) NOT NULL DEFAULT '',
	exit_duty_paid double precision NOT NULL DEFAULT 0,
	admitted_at timestamptz NOT NULL DEFAULT now(),
	exited_at timestamptz,
	transfer_history jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_freezone_goods_status ON freezone_goods (status);
CREATE INDEX IF NOT EXISTS idx_freezone_goods_current_zone ON freezone_goods (current_zone_id);
CREATE INDEX IF NOT EXISTS idx_freezone_goods_zone ON freezone_goods (zone_id);
CREATE INDEX IF NOT EXISTS idx_freezone_goods_ucr ON freezone_goods (ucr);
