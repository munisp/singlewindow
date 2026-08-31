-- WP-8 API marketplace: developer organisations + maker-checker production elevation
CREATE TABLE IF NOT EXISTS "developer_organisations" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(200) NOT NULL,
  "contact_email" varchar(320) NOT NULL,
  "tier" varchar(20) DEFAULT 'sandbox' NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "registered_by" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "developer_organisations_registered_by_users_id_fk"
    FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id")
    ON DELETE no action ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "idx_dev_orgs_registered_by" ON "developer_organisations" USING btree ("registered_by");
CREATE INDEX IF NOT EXISTS "idx_dev_orgs_tier" ON "developer_organisations" USING btree ("tier");

CREATE TABLE IF NOT EXISTS "api_key_elevation_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "organisation_id" integer NOT NULL,
  "api_key_id" integer NOT NULL,
  "justification" text NOT NULL,
  "requested_by" integer NOT NULL,
  "reviewed_by" integer,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "review_notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "reviewed_at" timestamp,
  CONSTRAINT "api_key_elevation_requests_organisation_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."developer_organisations"("id")
    ON DELETE no action ON UPDATE no action,
  CONSTRAINT "api_key_elevation_requests_api_key_id_fk"
    FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id")
    ON DELETE no action ON UPDATE no action,
  CONSTRAINT "api_key_elevation_requests_requested_by_users_id_fk"
    FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id")
    ON DELETE no action ON UPDATE no action,
  CONSTRAINT "api_key_elevation_requests_reviewed_by_users_id_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id")
    ON DELETE no action ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "idx_elev_req_org" ON "api_key_elevation_requests" USING btree ("organisation_id");
CREATE INDEX IF NOT EXISTS "idx_elev_req_status" ON "api_key_elevation_requests" USING btree ("status");
