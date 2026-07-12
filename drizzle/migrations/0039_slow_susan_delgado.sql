CREATE TYPE "public"."notification_channel" AS ENUM('email', 'sms', 'push', 'webhook', 'in_app');--> statement-breakpoint
CREATE TABLE "notification_channel_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"notification_type" "notification_type" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_channel_preferences" ADD CONSTRAINT "notification_channel_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ncp_user_id" ON "notification_channel_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_ncp_type_channel" ON "notification_channel_preferences" USING btree ("notification_type","channel");