/**
 * kafkaEventPublisher.ts — R3 FIX
 *
 * Centralised typed event publisher for all 7 required domain event types.
 * Each function publishes to the correct Kafka topic with a fully-typed payload.
 *
 * Routers import these helpers instead of calling publishEvent() directly,
 * ensuring consistent schema across all event producers.
 *
 * Event types covered:
 *   1. declaration.submitted
 *   2. declaration.cleared / declaration.rejected
 *   3. kyc.submitted / kyc.approved / kyc.rejected
 *   4. payment.initiated / payment.completed / payment.failed
 *   5. aeo.approved / aeo.suspended / aeo.revoked
 *   6. cargo.departed / cargo.arrived / cargo.customs_hold
 *   7. fraud.case_opened / sanctions.hit
 */

import { publishEvent, TOPICS } from "./kafka";

// ─── 1. Declaration Events ────────────────────────────────────────────────────

export async function emitDeclarationSubmitted(p: {
  declarationId: number;
  declarationNumber: string;
  traderId: number;
  hsCode: string;
  declarationType: string;
  riskLane: string;
  riskScore: number;
  totalDue: number;
  currency: string;
  correlationId?: string;
}) {
  return publishEvent(TOPICS.DECLARATION_SUBMITTED, {
    eventType: "declaration.submitted",
    aggregateId: String(p.declarationId),
    payload: p,
    metadata: { userId: String(p.traderId), correlationId: p.correlationId },
  });
}

export async function emitDeclarationCleared(p: {
  declarationId: number;
  declarationNumber: string;
  traderId: number;
  officerId: number;
  clearanceDate: string;
  correlationId?: string;
}) {
  return publishEvent(TOPICS.DECLARATION_CLEARED, {
    eventType: "declaration.cleared",
    aggregateId: String(p.declarationId),
    payload: p,
    metadata: { userId: String(p.officerId), correlationId: p.correlationId },
  });
}

export async function emitDeclarationRejected(p: {
  declarationId: number;
  declarationNumber: string;
  traderId: number;
  officerId: number;
  reason: string;
  correlationId?: string;
}) {
  return publishEvent(TOPICS.DECLARATION_REJECTED, {
    eventType: "declaration.rejected",
    aggregateId: String(p.declarationId),
    payload: p,
    metadata: { userId: String(p.officerId), correlationId: p.correlationId },
  });
}

// ─── 2. KYC Events ───────────────────────────────────────────────────────────

export async function emitKycSubmitted(p: {
  verificationId: number;
  userId: number;
  verificationType: string;
  documentCount: number;
  correlationId?: string;
}) {
  return publishEvent(TOPICS.KYC_SUBMITTED, {
    eventType: "kyc.submitted",
    aggregateId: String(p.verificationId),
    payload: p,
    metadata: { userId: String(p.userId), correlationId: p.correlationId },
  });
}

export async function emitKycApproved(p: {
  verificationId: number;
  userId: number;
  reviewerId: number;
  approvedAt: string;
  correlationId?: string;
}) {
  return publishEvent(TOPICS.KYC_APPROVED, {
    eventType: "kyc.approved",
    aggregateId: String(p.verificationId),
    payload: p,
    metadata: { userId: String(p.reviewerId), correlationId: p.correlationId },
  });
}

export async function emitKycRejected(p: {
  verificationId: number;
  userId: number;
  reviewerId: number;
  reason: string;
  correlationId?: string;
}) {
  return publishEvent(TOPICS.KYC_REJECTED, {
    eventType: "kyc.rejected",
    aggregateId: String(p.verificationId),
    payload: p,
    metadata: { userId: String(p.reviewerId), correlationId: p.correlationId },
  });
}

// ─── 3. Payment Events ────────────────────────────────────────────────────────

export async function emitPaymentInitiated(p: {
  paymentId: number;
  declarationId: number;
  traderId: number;
  amount: number;
  currency: string;
  idempotencyKey: string;
  correlationId?: string;
}) {
  return publishEvent(TOPICS.PAYMENT_INITIATED, {
    eventType: "payment.initiated",
    aggregateId: String(p.paymentId),
    payload: p,
    metadata: { userId: String(p.traderId), correlationId: p.correlationId },
  });
}

export async function emitPaymentCompleted(p: {
  paymentId: number;
  declarationId: number;
  traderId: number;
  amount: number;
  currency: string;
  mojalooopTransferId?: string;
  tigerBeetleTransferId?: string;
  correlationId?: string;
}) {
  return publishEvent(TOPICS.PAYMENT_COMPLETED, {
    eventType: "payment.completed",
    aggregateId: String(p.paymentId),
    payload: p,
    metadata: { userId: String(p.traderId), correlationId: p.correlationId },
  });
}

export async function emitPaymentFailed(p: {
  paymentId: number;
  declarationId: number;
  traderId: number;
  amount: number;
  currency: string;
  reason: string;
  retryCount: number;
  correlationId?: string;
}) {
  return publishEvent(TOPICS.PAYMENT_FAILED, {
    eventType: "payment.failed",
    aggregateId: String(p.paymentId),
    payload: p,
    metadata: { userId: String(p.traderId), correlationId: p.correlationId },
  });
}

// ─── 4. AEO Events ────────────────────────────────────────────────────────────

export async function emitAeoApproved(p: {
  applicationId: number;
  traderId: number;
  certificateNumber: string;
  tier: string;
  expiresAt: string;
  correlationId?: string;
}) {
  return publishEvent(TOPICS.AUDIT_EVENT, {
    eventType: "aeo.approved",
    aggregateId: String(p.applicationId),
    payload: p,
    metadata: { userId: String(p.traderId), correlationId: p.correlationId },
  });
}

export async function emitAeoSuspended(p: {
  applicationId: number;
  traderId: number;
  reason: string;
  suspendedBy: number;
  correlationId?: string;
}) {
  return publishEvent(TOPICS.AUDIT_EVENT, {
    eventType: "aeo.suspended",
    aggregateId: String(p.applicationId),
    payload: p,
    metadata: { userId: String(p.suspendedBy), correlationId: p.correlationId },
  });
}

// ─── 5. Cargo Events ─────────────────────────────────────────────────────────

export async function emitCargoDeparted(p: {
  declarationId: number;
  ucr: string;
  portOfDeparture: string;
  vesselId?: string;
  departureTime: string;
  correlationId?: string;
}) {
  return publishEvent(TOPICS.CARGO_DEPARTED, {
    eventType: "cargo.departed",
    aggregateId: p.ucr,
    payload: p,
    metadata: { correlationId: p.correlationId },
  });
}

export async function emitCargoArrived(p: {
  declarationId: number;
  ucr: string;
  portOfArrival: string;
  vesselId?: string;
  arrivalTime: string;
  correlationId?: string;
}) {
  return publishEvent(TOPICS.CARGO_ARRIVED, {
    eventType: "cargo.arrived",
    aggregateId: p.ucr,
    payload: p,
    metadata: { correlationId: p.correlationId },
  });
}

export async function emitCargoCustomsHold(p: {
  declarationId: number;
  ucr: string;
  holdReason: string;
  holdIssuedBy: number;
  correlationId?: string;
}) {
  return publishEvent(TOPICS.CARGO_CUSTOMS_HOLD, {
    eventType: "cargo.customs_hold",
    aggregateId: p.ucr,
    payload: p,
    metadata: { userId: String(p.holdIssuedBy), correlationId: p.correlationId },
  });
}

// ─── 6. Fraud & Sanctions Events ─────────────────────────────────────────────

export async function emitFraudCaseOpened(p: {
  fraudCaseId: number;
  declarationId?: number;
  traderId: number;
  riskScore: number;
  escalationLevel: string;
  reasons: string[];
  correlationId?: string;
}) {
  return publishEvent(TOPICS.FRAUD_CASE_OPENED, {
    eventType: "fraud.case_opened",
    aggregateId: String(p.fraudCaseId),
    payload: p,
    metadata: { correlationId: p.correlationId },
  });
}

export async function emitSanctionsHit(p: {
  sanctionCheckId: number;
  declarationId?: number;
  traderId: number;
  entityName: string;
  listName: string;
  matchScore: number;
  correlationId?: string;
}) {
  return publishEvent(TOPICS.SANCTIONS_HIT, {
    eventType: "sanctions.hit",
    aggregateId: String(p.sanctionCheckId),
    payload: p,
    metadata: { correlationId: p.correlationId },
  });
}

// ─── 7. Risk Score Event ─────────────────────────────────────────────────────

export async function emitRiskScoreComputed(p: {
  declarationId: number;
  traderId: number;
  riskScore: number;
  riskLane: string;
  factors: unknown[];
  correlationId?: string;
}) {
  return publishEvent(TOPICS.RISK_SCORE_COMPUTED, {
    eventType: "risk.score_computed",
    aggregateId: String(p.declarationId),
    payload: p,
    metadata: { userId: String(p.traderId), correlationId: p.correlationId },
  });
}
