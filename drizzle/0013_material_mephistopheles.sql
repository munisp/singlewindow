CREATE TYPE "public"."mojaloop_fsp_type" AS ENUM('BANK', 'MOBILE_MONEY', 'RTGS');--> statement-breakpoint
CREATE TYPE "public"."mojaloop_transfer_status" AS ENUM('PENDING', 'PROCESSING', 'COMMITTED', 'ABORTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."tb_entry_status" AS ENUM('pending', 'posted', 'voided', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tb_entry_type" AS ENUM('duty_payment', 'vat_payment', 'levy_payment', 'penalty', 'bond_deposit', 'bond_release', 'drawback_credit', 'refund', 'adjustment');--> statement-breakpoint
CREATE TABLE "keycloak_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"realm_url" text,
	"client_id" varchar(128),
	"client_secret" text,
	"discovery_url" text,
	"jwks_uri" text,
	"issuer" text,
	"role_mappings" json DEFAULT '{}'::json,
	"scopes" json DEFAULT '["openid","profile","email"]'::json,
	"fallback_enabled" boolean DEFAULT true NOT NULL,
	"last_tested_at" timestamp,
	"last_test_result" varchar(32),
	"last_test_error" text,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mojaloop_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" varchar(128) NOT NULL,
	"declaration_id" integer,
	"payment_id" integer,
	"initiated_by" integer NOT NULL,
	"fsp_id" varchar(64) NOT NULL,
	"fsp_name" varchar(128) NOT NULL,
	"fsp_type" "mojaloop_fsp_type" NOT NULL,
	"payer_account" varchar(128) NOT NULL,
	"payer_name" varchar(255) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'GHS' NOT NULL,
	"status" "mojaloop_transfer_status" DEFAULT 'PENDING' NOT NULL,
	"ilp_packet" text,
	"condition" varchar(128),
	"fulfilment" varchar(128),
	"payment_note" varchar(128),
	"expires_at" timestamp,
	"committed_at" timestamp,
	"aborted_at" timestamp,
	"failure_reason" text,
	"webhook_payload" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mojaloop_transactions_transfer_id_unique" UNIQUE("transfer_id")
);
--> statement-breakpoint
CREATE TABLE "tigerbeetle_ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"tb_transfer_id" varchar(40) NOT NULL,
	"debit_account_id" varchar(40) NOT NULL,
	"credit_account_id" varchar(40) NOT NULL,
	"amount_minor_units" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'GHS' NOT NULL,
	"ledger" integer DEFAULT 1 NOT NULL,
	"entry_type" "tb_entry_type" NOT NULL,
	"status" "tb_entry_status" DEFAULT 'pending' NOT NULL,
	"declaration_id" integer,
	"payment_id" integer,
	"mojaloop_transfer_id" varchar(128),
	"reference" varchar(128),
	"description" text,
	"metadata" json,
	"posted_at" timestamp,
	"voided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tigerbeetle_ledger_entries_tb_transfer_id_unique" UNIQUE("tb_transfer_id")
);
--> statement-breakpoint
ALTER TABLE "keycloak_config" ADD CONSTRAINT "keycloak_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mojaloop_transactions" ADD CONSTRAINT "mojaloop_transactions_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mojaloop_transactions" ADD CONSTRAINT "mojaloop_transactions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mojaloop_transactions" ADD CONSTRAINT "mojaloop_transactions_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tigerbeetle_ledger_entries" ADD CONSTRAINT "tigerbeetle_ledger_entries_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tigerbeetle_ledger_entries" ADD CONSTRAINT "tigerbeetle_ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mjtx_transfer_id" ON "mojaloop_transactions" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "idx_mjtx_declaration_id" ON "mojaloop_transactions" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_mjtx_initiated_by" ON "mojaloop_transactions" USING btree ("initiated_by");--> statement-breakpoint
CREATE INDEX "idx_mjtx_status" ON "mojaloop_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_mjtx_created_at" ON "mojaloop_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_tble_tb_transfer_id" ON "tigerbeetle_ledger_entries" USING btree ("tb_transfer_id");--> statement-breakpoint
CREATE INDEX "idx_tble_declaration_id" ON "tigerbeetle_ledger_entries" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_tble_payment_id" ON "tigerbeetle_ledger_entries" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "idx_tble_entry_type" ON "tigerbeetle_ledger_entries" USING btree ("entry_type");--> statement-breakpoint
CREATE INDEX "idx_tble_status" ON "tigerbeetle_ledger_entries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tble_created_at" ON "tigerbeetle_ledger_entries" USING btree ("created_at");