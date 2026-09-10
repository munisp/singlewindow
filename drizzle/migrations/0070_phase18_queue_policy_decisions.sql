-- Phase 18 (W3): officer decisions on RL queue-policy SHADOW suggestions.
-- Appended to the chain; no history rewritten. Hand-written minimal delta
-- (snapshot chain only reaches 0048), following the 0069 precedent.
-- queue_policy_decisions is an append-only log for future offline-RL reward
-- joins: did the officer accept or override the shadow policy's suggested
-- position for a declaration, keyed by policy_version.
CREATE TABLE "queue_policy_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"officer_id" integer NOT NULL,
	"declaration_id" integer NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"suggested_position" integer NOT NULL,
	"authoritative_position" integer NOT NULL,
	"decision" varchar(16) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "queue_policy_decisions_decision_check" CHECK ("decision" IN ('accepted', 'overrode'))
);
--> statement-breakpoint
ALTER TABLE "queue_policy_decisions" ADD CONSTRAINT "queue_policy_decisions_officer_id_users_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_policy_decisions" ADD CONSTRAINT "queue_policy_decisions_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_qpd_declaration" ON "queue_policy_decisions" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_qpd_officer" ON "queue_policy_decisions" USING btree ("officer_id");
