CREATE TABLE "document_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"token" varchar(128) NOT NULL,
	"password_hash" varchar(256),
	"expires_at" timestamp NOT NULL,
	"max_downloads" integer,
	"download_count" integer DEFAULT 0 NOT NULL,
	"label" varchar(255),
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_document_id_document_vault_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document_vault"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ds_token" ON "document_shares" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_ds_document_id" ON "document_shares" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_ds_created_by" ON "document_shares" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "idx_ds_expires_at" ON "document_shares" USING btree ("expires_at");