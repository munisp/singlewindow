CREATE TYPE "public"."bond_status" AS ENUM('active', 'released', 'forfeited', 'expired');--> statement-breakpoint
CREATE TYPE "public"."bond_type" AS ENUM('import_bond', 'transit_bond', 'aeo_bond');--> statement-breakpoint
CREATE TYPE "public"."penalty_code" AS ENUM('UNDER_DECLARATION', 'PROHIBITED_GOODS', 'LATE_FILING', 'MISDESCRIPTION', 'SMUGGLING');--> statement-breakpoint
CREATE TYPE "public"."penalty_status" AS ENUM('assessed', 'paid', 'appealed', 'waived', 'written_off');--> statement-breakpoint
CREATE TYPE "public"."risk_tier" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."transit_guarantee_status" AS ENUM('active', 'discharged', 'forfeited', 'expired');--> statement-breakpoint
CREATE TABLE "ab_divergence_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(128),
	"user_id" integer,
	"production_decision" varchar(32) NOT NULL,
	"shadow_decision" varchar(32) NOT NULL,
	"production_score" numeric(5, 4),
	"shadow_score" numeric(5, 4),
	"diverged" boolean NOT NULL,
	"feature_vector" jsonb DEFAULT '{}'::jsonb,
	"model_version_production" varchar(64),
	"model_version_shadow" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hs_classification_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"hs_code" varchar(10) NOT NULL,
	"description" text NOT NULL,
	"chapter" varchar(2) NOT NULL,
	"heading" varchar(4) NOT NULL,
	"subheading" varchar(6) NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"classified_by" varchar(32) DEFAULT 'hs-classifier-rust' NOT NULL,
	"model_version" varchar(64),
	"valid_from" timestamp DEFAULT now() NOT NULL,
	"valid_until" timestamp,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_risk_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" integer,
	"trader_id" integer,
	"risk_score" numeric(5, 4) NOT NULL,
	"risk_tier" "risk_tier" NOT NULL,
	"recommended_action" varchar(32) NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb,
	"model_version" varchar(64),
	"fsp_id" varchar(64),
	"fsp_type" varchar(32),
	"amount" numeric(18, 2),
	"currency" varchar(3),
	"scored_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tigerbeetle_bonds" (
	"id" serial PRIMARY KEY NOT NULL,
	"bond_id" varchar(40) NOT NULL,
	"tb_transfer_id" varchar(40) NOT NULL,
	"declaration_id" integer,
	"trader_id" integer,
	"bond_type" "bond_type" NOT NULL,
	"bond_amount" numeric(18, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'GHS' NOT NULL,
	"status" "bond_status" DEFAULT 'active' NOT NULL,
	"expiry_date" timestamp,
	"released_at" timestamp,
	"release_reason" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tigerbeetle_bonds_bond_id_unique" UNIQUE("bond_id")
);
--> statement-breakpoint
CREATE TABLE "tigerbeetle_penalties" (
	"id" serial PRIMARY KEY NOT NULL,
	"penalty_id" varchar(40) NOT NULL,
	"tb_transfer_id" varchar(40) NOT NULL,
	"declaration_id" integer,
	"trader_id" integer,
	"officer_id" integer,
	"penalty_code" "penalty_code" NOT NULL,
	"penalty_amount" numeric(18, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'GHS' NOT NULL,
	"status" "penalty_status" DEFAULT 'assessed' NOT NULL,
	"appeal_deadline" timestamp,
	"paid_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tigerbeetle_penalties_penalty_id_unique" UNIQUE("penalty_id")
);
--> statement-breakpoint
CREATE TABLE "tigerbeetle_transit_guarantees" (
	"id" serial PRIMARY KEY NOT NULL,
	"guarantee_id" varchar(40) NOT NULL,
	"tb_transfer_id" varchar(40) NOT NULL,
	"declaration_id" integer,
	"trader_id" integer,
	"guarantee_amount" numeric(18, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'GHS' NOT NULL,
	"destination_country" varchar(2) NOT NULL,
	"transit_days" integer NOT NULL,
	"status" "transit_guarantee_status" DEFAULT 'active' NOT NULL,
	"valid_until" timestamp NOT NULL,
	"discharged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tigerbeetle_transit_guarantees_guarantee_id_unique" UNIQUE("guarantee_id")
);
--> statement-breakpoint
ALTER TABLE "ab_divergence_log" ADD CONSTRAINT "ab_divergence_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_scores" ADD CONSTRAINT "payment_risk_scores_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_scores" ADD CONSTRAINT "payment_risk_scores_trader_id_users_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tigerbeetle_bonds" ADD CONSTRAINT "tigerbeetle_bonds_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tigerbeetle_bonds" ADD CONSTRAINT "tigerbeetle_bonds_trader_id_users_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tigerbeetle_penalties" ADD CONSTRAINT "tigerbeetle_penalties_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tigerbeetle_penalties" ADD CONSTRAINT "tigerbeetle_penalties_trader_id_users_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tigerbeetle_penalties" ADD CONSTRAINT "tigerbeetle_penalties_officer_id_users_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tigerbeetle_transit_guarantees" ADD CONSTRAINT "tigerbeetle_transit_guarantees_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tigerbeetle_transit_guarantees" ADD CONSTRAINT "tigerbeetle_transit_guarantees_trader_id_users_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ab_div_user" ON "ab_divergence_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_ab_div_diverged" ON "ab_divergence_log" USING btree ("diverged");--> statement-breakpoint
CREATE INDEX "idx_ab_div_created" ON "ab_divergence_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_hs_cache_code" ON "hs_classification_cache" USING btree ("hs_code");--> statement-breakpoint
CREATE INDEX "idx_hs_cache_chapter" ON "hs_classification_cache" USING btree ("chapter");--> statement-breakpoint
CREATE INDEX "idx_hs_cache_confidence" ON "hs_classification_cache" USING btree ("confidence");--> statement-breakpoint
CREATE INDEX "idx_prs_declaration" ON "payment_risk_scores" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_prs_trader" ON "payment_risk_scores" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_prs_tier" ON "payment_risk_scores" USING btree ("risk_tier");--> statement-breakpoint
CREATE INDEX "idx_prs_scored_at" ON "payment_risk_scores" USING btree ("scored_at");--> statement-breakpoint
CREATE INDEX "idx_tb_bonds_declaration" ON "tigerbeetle_bonds" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_tb_bonds_trader" ON "tigerbeetle_bonds" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_tb_bonds_status" ON "tigerbeetle_bonds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tb_bonds_type" ON "tigerbeetle_bonds" USING btree ("bond_type");--> statement-breakpoint
CREATE INDEX "idx_tb_penalties_declaration" ON "tigerbeetle_penalties" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_tb_penalties_trader" ON "tigerbeetle_penalties" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_tb_penalties_code" ON "tigerbeetle_penalties" USING btree ("penalty_code");--> statement-breakpoint
CREATE INDEX "idx_tb_penalties_status" ON "tigerbeetle_penalties" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tb_tg_declaration" ON "tigerbeetle_transit_guarantees" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_tb_tg_trader" ON "tigerbeetle_transit_guarantees" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_tb_tg_status" ON "tigerbeetle_transit_guarantees" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tb_tg_valid_until" ON "tigerbeetle_transit_guarantees" USING btree ("valid_until");