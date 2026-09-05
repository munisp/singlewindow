-- Wave-3: one onboarding_progress row and one stakeholder profile per user.
-- Required so idempotent demo seeding (scripts/seed-demo-users.sql) can use
-- ON CONFLICT (user_id), and to prevent duplicate profile/onboarding rows.
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_progress_user_id_unique" ON "onboarding_progress" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stakeholder_profiles_user_id_unique" ON "stakeholder_profiles" ("user_id");
