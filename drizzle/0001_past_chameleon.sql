CREATE TYPE "public"."kyc_document_status" AS ENUM('PENDING_ANALYSIS', 'ANALYSED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."kyc_document_type" AS ENUM('national_id', 'passport', 'drivers_license', 'business_registration', 'tax_certificate', 'bank_statement', 'utility_bill', 'certificate_of_incorporation', 'memorandum_of_association', 'board_resolution', 'other');--> statement-breakpoint
CREATE TYPE "public"."kyc_verification_status" AS ENUM('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."kyc_verification_type" AS ENUM('INDIVIDUAL', 'BUSINESS');--> statement-breakpoint
CREATE TYPE "public"."vision_analysis_type" AS ENUM('container_inspection', 'seal_verification', 'cargo_manifest_match', 'damage_assessment', 'prohibited_goods_screening');--> statement-breakpoint
CREATE TYPE "public"."vision_risk_level" AS ENUM('GREEN', 'YELLOW', 'RED');--> statement-breakpoint
CREATE TABLE "kyc_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"document_type" "kyc_document_type" NOT NULL,
	"filename" varchar(255) NOT NULL,
	"file_key" varchar(512) NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"status" "kyc_document_status" DEFAULT 'PENDING_ANALYSIS' NOT NULL,
	"analysis_result" json,
	"ocr_confidence" real,
	"authenticity_score" real,
	"authenticity_verdict" varchar(32),
	"analysed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"verification_type" "kyc_verification_type" NOT NULL,
	"primary_document_id" integer,
	"secondary_document_id" integer,
	"selfie_document_id" integer,
	"status" "kyc_verification_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"review_notes" text,
	"rejection_reason" text,
	"metadata" json,
	"submitted_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vision_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" varchar(64) NOT NULL,
	"declaration_id" integer,
	"requested_by" integer NOT NULL,
	"analysis_type" "vision_analysis_type" NOT NULL,
	"image_url" text NOT NULL,
	"image_key" varchar(512) NOT NULL,
	"detections" json,
	"container_analysis" json,
	"manifest_match" json,
	"risk_score" integer,
	"risk_level" "vision_risk_level",
	"recommended_action" varchar(32),
	"vlm_description" text,
	"processing_time_ms" integer,
	"model_versions" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vision_analyses_report_id_unique" UNIQUE("report_id")
);
--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_primary_document_id_kyc_documents_id_fk" FOREIGN KEY ("primary_document_id") REFERENCES "public"."kyc_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_secondary_document_id_kyc_documents_id_fk" FOREIGN KEY ("secondary_document_id") REFERENCES "public"."kyc_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_selfie_document_id_kyc_documents_id_fk" FOREIGN KEY ("selfie_document_id") REFERENCES "public"."kyc_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_analyses" ADD CONSTRAINT "vision_analyses_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_analyses" ADD CONSTRAINT "vision_analyses_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_kyc_doc_user_id" ON "kyc_documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_kyc_doc_status" ON "kyc_documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_kyc_ver_user_id" ON "kyc_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_kyc_ver_status" ON "kyc_verifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_va_declaration_id" ON "vision_analyses" USING btree ("declaration_id");--> statement-breakpoint
CREATE INDEX "idx_va_risk_level" ON "vision_analyses" USING btree ("risk_level");--> statement-breakpoint
CREATE INDEX "idx_va_requested_by" ON "vision_analyses" USING btree ("requested_by");