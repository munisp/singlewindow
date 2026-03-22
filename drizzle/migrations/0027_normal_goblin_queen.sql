CREATE TABLE "document_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"original_document_id" integer NOT NULL,
	"declaration_id" integer,
	"uploaded_by" integer,
	"category" varchar(64) NOT NULL,
	"description" text,
	"file_name" text NOT NULL,
	"file_size" integer,
	"mime_type" varchar(128),
	"s3_key" text NOT NULL,
	"s3_url" text NOT NULL,
	"replaced_at" timestamp DEFAULT now() NOT NULL,
	"replaced_by" integer,
	"version_note" text
);
--> statement-breakpoint
CREATE TABLE "settings_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"setting_key" varchar(128) NOT NULL,
	"old_value" text,
	"new_value" text NOT NULL,
	"changed_by" integer,
	"changed_by_name" text,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_replaced_by_users_id_fk" FOREIGN KEY ("replaced_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings_audit_log" ADD CONSTRAINT "settings_audit_log_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_docver_original_doc_id" ON "document_versions" USING btree ("original_document_id");--> statement-breakpoint
CREATE INDEX "idx_docver_declaration_id" ON "document_versions" USING btree ("declaration_id");