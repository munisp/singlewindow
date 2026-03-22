CREATE TABLE "bulk_exports" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"declaration_ids" text NOT NULL,
	"declaration_count" integer NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"s3_url" text NOT NULL,
	"s3_key" text NOT NULL,
	"file_size_bytes" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"label" varchar(256)
);
--> statement-breakpoint
ALTER TABLE "bulk_exports" ADD CONSTRAINT "bulk_exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bulk_exports_user_id" ON "bulk_exports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_bulk_exports_created_at" ON "bulk_exports" USING btree ("created_at");