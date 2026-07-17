CREATE TABLE "aeo_document_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"renewal_doc_id" integer NOT NULL,
	"file_url" varchar(1024) NOT NULL,
	"file_key" varchar(512),
	"uploaded_by" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "aeo_renewal_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"renewal_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"author_role" varchar(20) DEFAULT 'user' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_validation_errors" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"row_index" integer NOT NULL,
	"field" varchar(100),
	"error_code" varchar(50) NOT NULL,
	"error_message" text NOT NULL,
	"raw_value" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_type" varchar(100) NOT NULL,
	"label" varchar(255) NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"expiry_days" integer,
	"created_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_templates_doc_type_unique" UNIQUE("doc_type")
);
--> statement-breakpoint
CREATE TABLE "sanctions_entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer,
	"entity_name" varchar(512) NOT NULL,
	"entity_type" varchar(50),
	"country" varchar(100),
	"risk_score" integer DEFAULT 5,
	"aliases" text,
	"metadata" json,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sanctions_watchlist_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" integer NOT NULL,
	"sanction_entity_id" integer NOT NULL,
	"matched_field" varchar(100) NOT NULL,
	"matched_value" varchar(512) NOT NULL,
	"risk_score" integer DEFAULT 5 NOT NULL,
	"status" varchar(30) DEFAULT 'open' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_delivery_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"total_deliveries" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"total_rows_exported" integer DEFAULT 0 NOT NULL,
	"total_bytes_exported" bigint DEFAULT 0 NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_dependencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"depends_on_schedule_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
