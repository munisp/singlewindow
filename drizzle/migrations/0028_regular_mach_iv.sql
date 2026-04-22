CREATE INDEX "idx_ae_actor_id" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_ae_created_at" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_ae_entity_created_at" ON "audit_events" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_pay_trader_id" ON "payments" USING btree ("trader_id");--> statement-breakpoint
CREATE INDEX "idx_pay_status" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pay_created_at" ON "payments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_pay_status_created_at" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_pay_trader_status" ON "payments" USING btree ("trader_id","status");