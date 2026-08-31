/**
 * statuses.ts — canonical lifecycle status literals (Phase-6 SW-O5/SW-O6)
 *
 * These MUST match the pgEnum values in drizzle/schema.ts exactly. Queries that
 * filter on statuses use these constants so a wrong literal (e.g. 'completed'
 * or 'released', which are NOT in the enums and silently match zero rows)
 * cannot creep back in. A contract test asserts the literals stay in sync.
 */
import { paymentStatusEnum, declarationStatusEnum } from "../../drizzle/schema";

export const PAYMENT_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  CONFIRMED: "confirmed",
  FAILED: "failed",
  REFUNDED: "refunded",
} as const;

export const DECLARATION_STATUS = {
  DRAFT: "draft",
  SUBMITTED: "submitted",
  UNDER_ASSESSMENT: "under_assessment",
  DOCS_REQUIRED: "docs_required",
  PAYMENT_PENDING: "payment_pending",
  PAYMENT_CONFIRMED: "payment_confirmed",
  UNDER_EXAMINATION: "under_examination",
  EXAMINATION_COMPLETE: "examination_complete",
  CLEARED: "cleared",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
  HELD_SANCTIONS: "held_sanctions",
} as const;

/** Runtime guard: every constant must be a member of its pgEnum. */
export function assertStatusConstantsMatchEnums(): void {
  const paymentValues = new Set<string>(paymentStatusEnum.enumValues);
  for (const v of Object.values(PAYMENT_STATUS)) {
    if (!paymentValues.has(v)) throw new Error(`PAYMENT_STATUS '${v}' not in payment_status enum`);
  }
  const declValues = new Set<string>(declarationStatusEnum.enumValues);
  for (const v of Object.values(DECLARATION_STATUS)) {
    if (!declValues.has(v)) throw new Error(`DECLARATION_STATUS '${v}' not in declaration_status enum`);
  }
}
