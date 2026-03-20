CREATE TYPE "public"."port_congestion_status" AS ENUM('clear', 'moderate', 'congested', 'critical');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'customs_officer';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'oga_officer';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'inspector';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'finance';--> statement-breakpoint
CREATE TABLE "port_congestion_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"port_code" varchar(16) NOT NULL,
	"congestion_status" "port_congestion_status" NOT NULL,
	"vessel_count" integer DEFAULT 0,
	"wait_time_hours" real DEFAULT 0,
	"declaration_backlog" integer DEFAULT 0,
	"inspection_queue_size" integer DEFAULT 0,
	"metadata" json,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "port_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"port_code" varchar(16) NOT NULL,
	"port_name" varchar(128) NOT NULL,
	"country" varchar(3) NOT NULL,
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"port_type" varchar(32) DEFAULT 'seaport',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "port_locations_port_code_unique" UNIQUE("port_code")
);
--> statement-breakpoint
CREATE TABLE "vessel_tracking_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"mmsi" varchar(16) NOT NULL,
	"vessel_name" varchar(128),
	"imo_number" varchar(16),
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"speed" real,
	"heading" real,
	"destination_port" varchar(64),
	"eta" timestamp,
	"cargo_type" varchar(64),
	"flag_country" varchar(3),
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_pce_port_code" ON "port_congestion_events" USING btree ("port_code");--> statement-breakpoint
CREATE INDEX "idx_pce_recorded_at" ON "port_congestion_events" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "idx_vte_mmsi" ON "vessel_tracking_events" USING btree ("mmsi");--> statement-breakpoint
CREATE INDEX "idx_vte_recorded_at" ON "vessel_tracking_events" USING btree ("recorded_at");