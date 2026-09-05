CREATE TYPE "public"."amendment_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."bonded_inventory_status" AS ENUM('in_bond', 'ex_bonded', 're_exported', 'destroyed', 'seized');--> statement-breakpoint
CREATE TYPE "public"."bonded_warehouse_status" AS ENUM('active', 'suspended', 'revoked', 'pending_renewal');--> statement-breakpoint
CREATE TYPE "public"."cep_alert_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."cep_alert_status" AS ENUM('open', 'investigating', 'resolved', 'false_positive');--> statement-breakpoint
CREATE TYPE "public"."cep_pattern_status" AS ENUM('enabled', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."cost_category" AS ENUM('compute', 'storage', 'network', 'database', 'monitoring', 'security', 'other');--> statement-breakpoint
CREATE TYPE "public"."ex_bond_permit_status" AS ENUM('active', 'used', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_account_type" AS ENUM('trader', 'customs_duty', 'vat', 'levy', 'bond', 'suspense');--> statement-breakpoint
CREATE TYPE "public"."payment_archival_job_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_archival_tier" AS ENUM('hot', 'warm', 'cold');--> statement-breakpoint
CREATE TYPE "public"."payment_queue_status" AS ENUM('queued', 'processing', 'committed', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TABLE "bonded_inventory" (
	"id" serial PRIMARY KEY NOT NULL,
	"warehouse_id" integer NOT NULL,
	"declaration_id" integer,
	"ucr" varchar(50) NOT NULL,
	"hs_code" varchar(20) NOT NULL,
	"description" text NOT NULL,
	"quantity_kg" integer DEFAULT 0 NOT NULL,
	"volume_cbm" integer DEFAULT 0 NOT NULL,
	"invoice_value_usd" bigint DEFAULT 0 NOT NULL,
	"duty_liability_usd" bigint DEFAULT 0 NOT NULL,
	"origin_country" varchar(3),
	"deposited_at" timestamp DEFAULT now() NOT NULL,
	"expiry_date" timestamp,
	"status" "bonded_inventory_status" DEFAULT 'in_bond' NOT NULL,
	"released_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bonded_warehouses" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_no" varchar(50) NOT NULL,
	"name" varchar(200) NOT NULL,
	"operator_id" integer,
	"operator_name" varchar(200) NOT NULL,
	"country" varchar(3) DEFAULT 'NGA' NOT NULL,
	"address" text NOT NULL,
	"port_code" varchar(10),
	"capacity_cbm" integer DEFAULT 0 NOT NULL,
	"used_cbm" integer DEFAULT 0 NOT NULL,
	"bond_amount_usd" bigint DEFAULT 0 NOT NULL,
	"bond_expiry" timestamp,
	"status" "bonded_warehouse_status" DEFAULT 'active' NOT NULL,
	"approved_at" timestamp,
	"approved_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bonded_warehouses_license_no_unique" UNIQUE("license_no")
);
--> statement-breakpoint
CREATE TABLE "cep_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_id" varchar(100) NOT NULL,
	"pattern_id" varchar(100) NOT NULL,
	"pattern_name" varchar(200) NOT NULL,
	"declaration_id" integer,
	"trader_id" integer,
	"severity" "cep_alert_severity" DEFAULT 'medium' NOT NULL,
	"status" "cep_alert_status" DEFAULT 'open' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk_score" integer DEFAULT 0 NOT NULL,
	"assigned_to" integer,
	"resolved_at" timestamp,
	"resolved_by" integer,
	"resolution_note" text,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cep_alerts_alert_id_unique" UNIQUE("alert_id")
);
--> statement-breakpoint
CREATE TABLE "cep_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"pattern_id" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"status" "cep_pattern_status" DEFAULT 'enabled' NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trigger_count" integer DEFAULT 0 NOT NULL,
	"last_triggered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cep_patterns_pattern_id_unique" UNIQUE("pattern_id")
);
--> statement-breakpoint
CREATE TABLE "cost_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"tenant_name" varchar(200),
	"namespace" varchar(100),
	"service" varchar(100),
	"category" "cost_category" DEFAULT 'compute' NOT NULL,
	"period_date" date NOT NULL,
	"compute_cost_usd" integer DEFAULT 0 NOT NULL,
	"storage_cost_usd" integer DEFAULT 0 NOT NULL,
	"network_cost_usd" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" integer DEFAULT 0 NOT NULL,
	"cpu_request_millicores" integer,
	"memory_request_mib" integer,
	"cpu_usage_millicores" integer,
	"memory_usage_mib" integer,
	"efficiency" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "declaration_amendments" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" integer NOT NULL,
	"requested_by" integer NOT NULL,
	"reviewed_by" integer,
	"status" "amendment_status" DEFAULT 'pending' NOT NULL,
	"field_name" varchar(128) NOT NULL,
	"old_value" text,
	"new_value" text NOT NULL,
	"reason" text NOT NULL,
	"review_notes" text,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ex_bond_permits" (
	"id" serial PRIMARY KEY NOT NULL,
	"permit_no" varchar(50) NOT NULL,
	"inventory_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"requested_by_id" integer,
	"approved_by_id" integer,
	"quantity_kg" integer NOT NULL,
	"duty_paid_usd" bigint DEFAULT 0 NOT NULL,
	"payment_ref" varchar(100),
	"status" "ex_bond_permit_status" DEFAULT 'active' NOT NULL,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"used_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ex_bond_permits_permit_no_unique" UNIQUE("permit_no")
);
--> statement-breakpoint
CREATE TABLE "kpi_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"metric_key" varchar(128) NOT NULL,
	"label" varchar(255) NOT NULL,
	"target_value" numeric(15, 4) NOT NULL,
	"unit" varchar(32),
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_targets_metric_key_unique" UNIQUE("metric_key")
);
--> statement-breakpoint
CREATE TABLE "payment_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" varchar(128) NOT NULL,
	"trader_id" integer,
	"account_type" "payment_account_type" DEFAULT 'trader' NOT NULL,
	"currency" varchar(8) DEFAULT 'GHS' NOT NULL,
	"ledger" integer DEFAULT 1 NOT NULL,
	"shard_key" integer DEFAULT 0 NOT NULL,
	"debits_posted" bigint DEFAULT 0 NOT NULL,
	"credits_posted" bigint DEFAULT 0 NOT NULL,
	"debits_pending" bigint DEFAULT 0 NOT NULL,
	"credits_pending" bigint DEFAULT 0 NOT NULL,
	"last_sync_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_accounts_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "payment_archival_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" varchar(128) NOT NULL,
	"tier" "payment_archival_tier" NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"transfers_archived" integer DEFAULT 0 NOT NULL,
	"bytes_written" bigint DEFAULT 0 NOT NULL,
	"storage_uri" text,
	"status" "payment_archival_job_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_archival_jobs_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "payment_idempotency_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"transfer_id" varchar(128) NOT NULL,
	"response_snapshot" jsonb,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_idempotency_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "payment_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" varchar(128) NOT NULL,
	"debit_account_id" varchar(128) NOT NULL,
	"credit_account_id" varchar(128) NOT NULL,
	"amount_minor_units" bigint NOT NULL,
	"currency" varchar(8) DEFAULT 'GHS' NOT NULL,
	"ledger" integer DEFAULT 1 NOT NULL,
	"status" "payment_queue_status" DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"next_retry_at" timestamp,
	"dead_lettered_at" timestamp,
	"committed_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_queue_transfer_id_unique" UNIQUE("transfer_id")
);
--> statement-breakpoint
CREATE TABLE "trader_ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" integer NOT NULL,
	"trader_id" integer NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trader_ratings_decl_trader_unique" UNIQUE("declaration_id","trader_id")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "entry_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "prev_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "bonded_inventory" ADD CONSTRAINT "bonded_inventory_warehouse_id_bonded_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."bonded_warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonded_inventory" ADD CONSTRAINT "bonded_inventory_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonded_warehouses" ADD CONSTRAINT "bonded_warehouses_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonded_warehouses" ADD CONSTRAINT "bonded_warehouses_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cep_alerts" ADD CONSTRAINT "cep_alerts_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cep_alerts" ADD CONSTRAINT "cep_alerts_trader_id_users_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cep_alerts" ADD CONSTRAINT "cep_alerts_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cep_alerts" ADD CONSTRAINT "cep_alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- moved to 0029 (FK requires uuid tenant_id; type conversion happens there)--> statement-breakpoint
ALTER TABLE "declaration_amendments" ADD CONSTRAINT "declaration_amendments_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declaration_amendments" ADD CONSTRAINT "declaration_amendments_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declaration_amendments" ADD CONSTRAINT "declaration_amendments_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ex_bond_permits" ADD CONSTRAINT "ex_bond_permits_inventory_id_bonded_inventory_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."bonded_inventory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ex_bond_permits" ADD CONSTRAINT "ex_bond_permits_warehouse_id_bonded_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."bonded_warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ex_bond_permits" ADD CONSTRAINT "ex_bond_permits_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ex_bond_permits" ADD CONSTRAINT "ex_bond_permits_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_targets" ADD CONSTRAINT "kpi_targets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_trader_id_users_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_ratings" ADD CONSTRAINT "trader_ratings_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_ratings" ADD CONSTRAINT "trader_ratings_trader_id_users_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bi_warehouse" ON "bonded_inventory" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "idx_bi_declaration" ON "bonded_inventory" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_bi_ucr" ON "bonded_inventory" USING btree ("ucr");--> statement-breakpoint
CREATE INDEX "idx_bi_status" ON "bonded_inventory" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_bw_operator" ON "bonded_warehouses" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "idx_bw_status" ON "bonded_warehouses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_bw_port" ON "bonded_warehouses" USING btree ("port_code");--> statement-breakpoint
CREATE INDEX "idx_cep_alert_pattern" ON "cep_alerts" USING btree ("pattern_id");--> statement-breakpoint
CREATE INDEX "idx_cep_alert_status" ON "cep_alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_cep_alert_severity" ON "cep_alerts" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_cep_alert_trader" ON "cep_alerts" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_cep_alert_detected" ON "cep_alerts" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "idx_cep_pattern_status" ON "cep_patterns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_cr_tenant" ON "cost_records" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_cr_period" ON "cost_records" USING btree ("period_date");--> statement-breakpoint
CREATE INDEX "idx_cr_service" ON "cost_records" USING btree ("service");--> statement-breakpoint
CREATE INDEX "idx_cr_category" ON "cost_records" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_da_declaration" ON "declaration_amendments" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_da_status" ON "declaration_amendments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_da_requester" ON "declaration_amendments" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "idx_ebp_inventory" ON "ex_bond_permits" USING btree ("inventory_id");--> statement-breakpoint
CREATE INDEX "idx_ebp_warehouse" ON "ex_bond_permits" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "idx_ebp_status" ON "ex_bond_permits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_kpi_key" ON "kpi_targets" USING btree ("metric_key");--> statement-breakpoint
CREATE INDEX "idx_pa_account_id" ON "payment_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_pa_trader_id" ON "payment_accounts" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_pa_shard_key" ON "payment_accounts" USING btree ("shard_key");--> statement-breakpoint
CREATE INDEX "idx_paj_tier_created" ON "payment_archival_jobs" USING btree ("tier","created_at");--> statement-breakpoint
CREATE INDEX "idx_paj_job_id" ON "payment_archival_jobs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_pik_key_hash" ON "payment_idempotency_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "idx_pik_expires_at" ON "payment_idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_pq_status_retry" ON "payment_queue" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "idx_pq_transfer_id" ON "payment_queue" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "idx_pq_created_at" ON "payment_queue" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_trader_ratings_trader" ON "trader_ratings" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_trader_ratings_created" ON "trader_ratings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_ae_entry_hash" ON "audit_events" USING btree ("entry_hash");