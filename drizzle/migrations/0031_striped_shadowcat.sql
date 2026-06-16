CREATE TABLE "cep_suppression_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_id" varchar(100) NOT NULL,
	"pattern_id" varchar(100) NOT NULL,
	"pattern_name" varchar(200) NOT NULL,
	"suppressed_by" integer,
	"suppressed_by_name" varchar(200),
	"suppressed_until" timestamp NOT NULL,
	"hours" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cep_suppression_log" ADD CONSTRAINT "cep_suppression_log_suppressed_by_users_id_fk" FOREIGN KEY ("suppressed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cep_supp_log_alert" ON "cep_suppression_log" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX "idx_cep_supp_log_pattern" ON "cep_suppression_log" USING btree ("pattern_id");--> statement-breakpoint
CREATE INDEX "idx_cep_supp_log_created" ON "cep_suppression_log" USING btree ("created_at");