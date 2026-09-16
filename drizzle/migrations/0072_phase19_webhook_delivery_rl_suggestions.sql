CREATE TABLE "queue_policy_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"candidate_ids" json NOT NULL,
	"feature_snapshot" json NOT NULL,
	"authoritative_order" json NOT NULL,
	"suggested_order" json NOT NULL,
	"served_to" integer,
	"served_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "attempt_count" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "delivered_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "delivered_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ALTER COLUMN "secret" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_policy_decisions" ADD COLUMN "suggestion_id" integer;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "delivery_id" varchar(36);--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "status" varchar(16) DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "last_attempt_at" timestamp;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "next_retry_at" timestamp;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "last_http_status" integer;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "sandbox" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD COLUMN "secret_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD COLUMN "secret_enc" text;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD COLUMN "api_id" varchar(128);--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD COLUMN "api_key_id" integer;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD COLUMN "sandbox_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_policy_suggestions" ADD CONSTRAINT "queue_policy_suggestions_served_to_users_id_fk" FOREIGN KEY ("served_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_qps_policy_version" ON "queue_policy_suggestions" USING btree ("policy_version");--> statement-breakpoint
CREATE INDEX "idx_qps_served_at" ON "queue_policy_suggestions" USING btree ("served_at");--> statement-breakpoint
ALTER TABLE "queue_policy_decisions" ADD CONSTRAINT "queue_policy_decisions_suggestion_id_queue_policy_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."queue_policy_suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_qpd_suggestion_declaration_officer" ON "queue_policy_decisions" USING btree ("suggestion_id","declaration_id","officer_id") WHERE suggestion_id is not null;--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_status" ON "webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_due" ON "webhook_deliveries" USING btree ("next_retry_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_webhook_deliveries_delivery_id" ON "webhook_deliveries" USING btree ("delivery_id");--> statement-breakpoint
-- M3: the decision CHECK constraint already exists from 0070 (created SQL-side
-- only); it is now also expressed in drizzle/schema.ts so schema-built
-- environments keep it. Re-adding it here would collide on fresh migrate
-- (42710), so this migration intentionally skips it.
