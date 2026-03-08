ALTER TYPE "public"."notification_type" ADD VALUE 'declaration_status_change';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'permit_expiry_warning';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'fraud_case_opened';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'fraud_case_assigned';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'sla_breach';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'kyc_approved';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'kyc_rejected';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'duty_payment_due';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'clearance_complete';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'general';
