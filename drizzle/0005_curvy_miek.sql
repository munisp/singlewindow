CREATE TABLE "clearance_certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"declaration_id" integer NOT NULL,
	"trader_id" integer NOT NULL,
	"file_key" varchar(512) NOT NULL,
	"file_url" text NOT NULL,
	"declaration_ref" varchar(64) NOT NULL,
	"goods_description" text,
	"total_duty_paid" numeric(18, 2),
	"currency" varchar(8) DEFAULT 'USD',
	"cleared_at" timestamp,
	"generated_by" integer NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clearance_certificates" ADD CONSTRAINT "clearance_certificates_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cc_trader_id" ON "clearance_certificates" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_cc_declaration_id" ON "clearance_certificates" USING btree ("declaration_id");