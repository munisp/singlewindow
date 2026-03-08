CREATE TABLE "user_notifications" (
"id" serial PRIMARY KEY NOT NULL,
"user_id" integer NOT NULL,
"type" "notification_type" DEFAULT 'general' NOT NULL,
"title" varchar(255) NOT NULL,
"body" text NOT NULL,
"declaration_id" integer,
"is_read" boolean DEFAULT false NOT NULL,
"read_at" timestamp,
"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_un_user_id" ON "user_notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_un_user_unread" ON "user_notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE INDEX "idx_un_created_at" ON "user_notifications" USING btree ("created_at");
