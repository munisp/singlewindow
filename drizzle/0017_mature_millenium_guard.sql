CREATE TYPE "public"."api_change_type" AS ENUM('added', 'modified', 'deprecated', 'removed', 'breaking');--> statement-breakpoint
CREATE TYPE "public"."geofence_status" AS ENUM('active', 'inactive', 'draft');--> statement-breakpoint
CREATE TYPE "public"."geofence_type" AS ENUM('port_entry', 'port_exit', 'restricted_zone', 'customs_zone');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_type" AS ENUM('declaration.submitted', 'declaration.approved', 'declaration.rejected', 'declaration.released', 'payment.confirmed', 'payment.failed', 'kyc.approved', 'kyc.rejected', 'permit.issued', 'permit.expiring', 'vessel.geofence_entry', 'vessel.geofence_exit', 'alert.high_risk', 'alert.sanctions_hit');--> statement-breakpoint
CREATE TABLE "api_changelog" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" varchar(32) NOT NULL,
	"change_type" "api_change_type" NOT NULL,
	"endpoint" varchar(256) NOT NULL,
	"description" text NOT NULL,
	"breaking_change" boolean DEFAULT false NOT NULL,
	"migration_guide" text,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"published_by" integer
);
--> statement-breakpoint
CREATE TABLE "geofence_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"geofence_id" integer NOT NULL,
	"mmsi" varchar(20) NOT NULL,
	"vessel_name" varchar(128),
	"event_type" varchar(16) NOT NULL,
	"lat" real NOT NULL,
	"lon" real NOT NULL,
	"speed" real,
	"notification_sent" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geofences" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"port_code" varchar(16),
	"geofence_type" "geofence_type" DEFAULT 'port_entry' NOT NULL,
	"status" "geofence_status" DEFAULT 'active' NOT NULL,
	"polygon" json NOT NULL,
	"radius_meters" integer,
	"alert_on_entry" boolean DEFAULT true NOT NULL,
	"alert_on_exit" boolean DEFAULT false NOT NULL,
	"notify_owner_on_trigger" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_analytics" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"step" varchar(64) NOT NULL,
	"action" varchar(32) NOT NULL,
	"time_spent_seconds" integer,
	"error_count" integer DEFAULT 0 NOT NULL,
	"metadata" json DEFAULT '{}'::json,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"payload" json NOT NULL,
	"status_code" integer,
	"response_body" text,
	"success" boolean DEFAULT false NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"delivered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"url" varchar(512) NOT NULL,
	"secret" varchar(256) NOT NULL,
	"events" json NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_delivered_at" timestamp,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_changelog" ADD CONSTRAINT "api_changelog_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_geofence_id_geofences_id_fk" FOREIGN KEY ("geofence_id") REFERENCES "public"."geofences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_analytics" ADD CONSTRAINT "onboarding_analytics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."webhook_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_api_changelog_version" ON "api_changelog" USING btree ("version");--> statement-breakpoint
CREATE INDEX "idx_api_changelog_published_at" ON "api_changelog" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_geofence_events_geofence_id" ON "geofence_events" USING btree ("geofence_id");--> statement-breakpoint
CREATE INDEX "idx_geofence_events_mmsi" ON "geofence_events" USING btree ("mmsi");--> statement-breakpoint
CREATE INDEX "idx_geofence_events_occurred_at" ON "geofence_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_geofences_port_code" ON "geofences" USING btree ("port_code");--> statement-breakpoint
CREATE INDEX "idx_geofences_status" ON "geofences" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_onboarding_analytics_user_id" ON "onboarding_analytics" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_onboarding_analytics_step" ON "onboarding_analytics" USING btree ("step");--> statement-breakpoint
CREATE INDEX "idx_onboarding_analytics_recorded_at" ON "onboarding_analytics" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_sub_id" ON "webhook_deliveries" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_success" ON "webhook_deliveries" USING btree ("success");--> statement-breakpoint
CREATE INDEX "idx_webhook_subs_user_id" ON "webhook_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_subs_active" ON "webhook_subscriptions" USING btree ("is_active");