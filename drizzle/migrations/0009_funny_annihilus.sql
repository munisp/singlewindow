CREATE TYPE "public"."digest_frequency" AS ENUM('none', 'daily', 'weekly');--> statement-breakpoint
CREATE TABLE "notification_digest_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"digest_frequency" "digest_frequency" DEFAULT 'none' NOT NULL,
	"last_digest_sent_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_digest_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "port_congestion_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"port_code" varchar(16) NOT NULL,
	"last_notified_status" "port_congestion_status" DEFAULT 'clear' NOT NULL,
	"last_alert_sent_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "port_congestion_alerts_port_code_unique" UNIQUE("port_code")
);
--> statement-breakpoint
ALTER TABLE "notification_digest_settings" ADD CONSTRAINT "notification_digest_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_nds_user_id" ON "notification_digest_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_nds_frequency" ON "notification_digest_settings" USING btree ("digest_frequency");--> statement-breakpoint
CREATE INDEX "idx_pca_port_code" ON "port_congestion_alerts" USING btree ("port_code");