-- Phase 16 (Wave P1 / A2): AEO export fast-lane + transshipment declaration lane.
-- Appended to the chain; no history rewritten.
-- 1. declaration_type enum gains 'transshipment'.
-- 2. AEO fast-lane flags: duty_drawback_claims.fast_track(+fast_track_at) for
--    drawback acceleration; origin_certificates.fast_path for the
--    rules-of-origin fast path.
-- 3. Transshipment lane: transshipment_links couples ONE inbound and ONE
--    outbound manifest to a transshipment declaration; bonded_transfers is the
--    append-only bonded-transfer status audit trail.
ALTER TYPE "public"."declaration_type" ADD VALUE 'transshipment';--> statement-breakpoint
CREATE TYPE "public"."bonded_transfer_status" AS ENUM('initiated', 'in_transit', 'arrived_bond', 'under_supervision', 'released', 'completed', 'cancelled');--> statement-breakpoint
ALTER TABLE "duty_drawback_claims" ADD COLUMN "fast_track" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "duty_drawback_claims" ADD COLUMN "fast_track_at" timestamp;--> statement-breakpoint
ALTER TABLE "origin_certificates" ADD COLUMN "fast_path" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "transshipment_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" integer NOT NULL,
	"inbound_manifest_id" integer NOT NULL,
	"outbound_manifest_id" integer NOT NULL,
	"transshipment_port" varchar(64) NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transshipment_links_declaration_id_unique" UNIQUE("declaration_id")
);
--> statement-breakpoint
CREATE TABLE "bonded_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"transshipment_link_id" integer NOT NULL,
	"from_status" "bonded_transfer_status",
	"to_status" "bonded_transfer_status" NOT NULL,
	"actor_id" integer NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transshipment_links" ADD CONSTRAINT "transshipment_links_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transshipment_links" ADD CONSTRAINT "transshipment_links_inbound_manifest_id_manifests_id_fk" FOREIGN KEY ("inbound_manifest_id") REFERENCES "public"."manifests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transshipment_links" ADD CONSTRAINT "transshipment_links_outbound_manifest_id_manifests_id_fk" FOREIGN KEY ("outbound_manifest_id") REFERENCES "public"."manifests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transshipment_links" ADD CONSTRAINT "transshipment_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonded_transfers" ADD CONSTRAINT "bonded_transfers_transshipment_link_id_transshipment_links_id_fk" FOREIGN KEY ("transshipment_link_id") REFERENCES "public"."transshipment_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonded_transfers" ADD CONSTRAINT "bonded_transfers_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tsl_inbound_manifest" ON "transshipment_links" USING btree ("inbound_manifest_id");--> statement-breakpoint
CREATE INDEX "idx_tsl_outbound_manifest" ON "transshipment_links" USING btree ("outbound_manifest_id");--> statement-breakpoint
CREATE INDEX "idx_btr_link" ON "bonded_transfers" USING btree ("transshipment_link_id");
