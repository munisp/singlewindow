CREATE TYPE "public"."origin_cert_status" AS ENUM('draft', 'submitted', 'under_review', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."origin_cert_type" AS ENUM('form_a', 'eur1', 'afcfta_co', 'comesa_co', 'ecowas_co', 'bilateral_co');--> statement-breakpoint
CREATE TYPE "public"."origin_criteria_met" AS ENUM('wholly_obtained', 'substantial_transformation', 'value_added_rule', 'tariff_shift_rule');--> statement-breakpoint
CREATE TYPE "public"."pilot_role" AS ENUM('ncs_officer', 'trader', 'oga_officer', 'port_operator');--> statement-breakpoint
CREATE TYPE "public"."pilot_scope" AS ENUM('apapa_apmt', 'tin_can_island', 'both');--> statement-breakpoint
CREATE TABLE "origin_certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" integer,
	"trader_id" integer NOT NULL,
	"reviewed_by" integer,
	"cert_type" "origin_cert_type" DEFAULT 'afcfta_co' NOT NULL,
	"status" "origin_cert_status" DEFAULT 'draft' NOT NULL,
	"cert_number" varchar(64),
	"exporter_name" varchar(256) NOT NULL,
	"exporter_address" text NOT NULL,
	"importer_name" varchar(256) NOT NULL,
	"importer_address" text NOT NULL,
	"origin_country" varchar(3) NOT NULL,
	"destination_country" varchar(3) NOT NULL,
	"hs_code" varchar(16) NOT NULL,
	"goods_description" text NOT NULL,
	"gross_weight" varchar(64),
	"net_weight" varchar(64),
	"quantity" varchar(64),
	"invoice_number" varchar(128),
	"invoice_date" timestamp,
	"origin_criteria" "origin_criteria_met" DEFAULT 'substantial_transformation' NOT NULL,
	"local_value_added_pct" integer,
	"review_notes" text,
	"approved_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"pilot_role" "pilot_role" NOT NULL,
	"scope" "pilot_scope" DEFAULT 'both' NOT NULL,
	"organisation" varchar(256),
	"contact_email" varchar(256),
	"is_active" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "pilot_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_date" timestamp DEFAULT now() NOT NULL,
	"total_declarations" integer DEFAULT 0 NOT NULL,
	"green_lane" integer DEFAULT 0 NOT NULL,
	"yellow_lane" integer DEFAULT 0 NOT NULL,
	"red_lane" integer DEFAULT 0 NOT NULL,
	"avg_clearance_hours_x100" integer DEFAULT 0 NOT NULL,
	"total_duty_collected_kobo" bigint DEFAULT 0 NOT NULL,
	"active_traders" integer DEFAULT 0 NOT NULL,
	"active_officers" integer DEFAULT 0 NOT NULL,
	"system_uptime_pct_x100" integer DEFAULT 10000 NOT NULL,
	"report_pdf_url" text,
	"generated_by" integer,
	"emailed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "origin_certificates" ADD CONSTRAINT "origin_certificates_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origin_certificates" ADD CONSTRAINT "origin_certificates_trader_id_users_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origin_certificates" ADD CONSTRAINT "origin_certificates_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_participants" ADD CONSTRAINT "pilot_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_reports" ADD CONSTRAINT "pilot_reports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_origin_certs_trader_id" ON "origin_certificates" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_origin_certs_declaration_id" ON "origin_certificates" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_origin_certs_status" ON "origin_certificates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_origin_certs_cert_number" ON "origin_certificates" USING btree ("cert_number");--> statement-breakpoint
CREATE INDEX "idx_pilot_participants_user_id" ON "pilot_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_pilot_participants_role" ON "pilot_participants" USING btree ("pilot_role");--> statement-breakpoint
CREATE INDEX "idx_pilot_reports_date" ON "pilot_reports" USING btree ("report_date");