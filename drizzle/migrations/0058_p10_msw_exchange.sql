-- Phase 10 WP-3: cross-border MSW-to-MSW exchange (IMO Compendium wire layer).
-- Contract: blueeconomy-contracts docs/imo-wco-conformance.md +
-- mappings/msw/v1/*.yaml (branch phase10/wp3-conformance, NORMATIVE).
-- Inbound foreign-MSW messages persist as DRAFTS only (never auto-accepted);
-- replay protection reuses webhook_receipts with source 'msw_exchange'
-- (service-enforced reserve-before-process, mirroring port-interop
-- nswsecurity.ReplayStore).

CREATE TYPE "msw_foreign_draft_status" AS ENUM ('DRAFT','ADMITTED','REJECTED');--> statement-breakpoint
CREATE TABLE "msw_foreign_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" varchar(40) NOT NULL,
	"form_type" "msw_form_type" NOT NULL,
	"foreign_sender" varchar(128) NOT NULL,
	"source_message_id" varchar(128) NOT NULL,
	"envelope_event_id" varchar(80) NOT NULL,
	"envelope_digest_sha256" varchar(80) NOT NULL,
	"form_payload" jsonb NOT NULL,
	"contains_personal_data" boolean NOT NULL,
	"status" "msw_foreign_draft_status" DEFAULT 'DRAFT' NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "msw_foreign_drafts_draft_id_unique" UNIQUE("draft_id"),
	CONSTRAINT "msw_foreign_drafts_message_unique" UNIQUE("foreign_sender","source_message_id")
);--> statement-breakpoint
CREATE INDEX "idx_msw_foreign_drafts_sender" ON "msw_foreign_drafts" USING btree ("foreign_sender");
