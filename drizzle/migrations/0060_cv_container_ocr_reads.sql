-- WP-4: projection of signed cv.container-code.v1 gate-OCR reads for
-- cargo/declaration cross-check (fail-closed consumer, idempotent on event_id).
CREATE TABLE IF NOT EXISTS "container_ocr_reads" (
  "id" serial PRIMARY KEY,
  "event_id" varchar(128) NOT NULL UNIQUE,
  "camera_id" varchar(64) NOT NULL,
  "container_code" varchar(16) NOT NULL,
  "status" varchar(16) NOT NULL,
  "confidence" numeric(5,4),
  "check_digit_valid" boolean NOT NULL DEFAULT false,
  "model_version" varchar(128),
  "match_status" varchar(16) NOT NULL,
  "declaration_id" integer REFERENCES "declarations"("id"),
  "occurred_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_cor_container_code" ON "container_ocr_reads" ("container_code");
CREATE INDEX IF NOT EXISTS "idx_cor_match_status" ON "container_ocr_reads" ("match_status");
CREATE INDEX IF NOT EXISTS "idx_cor_declaration" ON "container_ocr_reads" ("declaration_id");
