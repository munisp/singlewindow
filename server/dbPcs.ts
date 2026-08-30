/**
 * dbPcs.ts — database helpers for the PCS trader portal (Phase 8).
 *
 * Thin Drizzle query helpers over the pcs_* read-model tables plus the
 * PCS-scoped slices of document_vault and notification_channel_preferences.
 * Every helper returns a DbResult discriminated union: { down: true } when
 * PostgreSQL is unavailable (the router renders the honest UNAVAILABLE
 * state) vs { down: false, value } — an empty value is a truthful EMPTY
 * state, never a stand-in for an outage (down-vs-empty taxonomy, spec §5.4).
 */

import { and, desc, eq, gte, lte, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  declarations,
  documentVault,
  notificationChannelPreferences,
  pcsBillingSnapshots,
  pcsBookingLinks,
  pcsConsignments,
  pcsMilestones,
  type DocumentVault,
  type NotificationChannelPreference,
  type PcsBillingSnapshot,
  type PcsBookingLink,
  type PcsConsignment,
  type PcsMilestone,
} from "../drizzle/schema";

export type DbResult<T> = { down: true } | { down: false; value: T };

function down<T>(): DbResult<T> {
  return { down: true };
}

function value<T>(v: T): DbResult<T> {
  return { down: false, value: v };
}

// ─── Consignments ────────────────────────────────────────────────────────────

export async function listPcsConsignmentsForTrader(
  traderUserId: number,
  opts: { status?: string; limit: number; offset: number }
): Promise<DbResult<{ rows: PcsConsignment[]; nextCursor: number | null }>> {
  const db = await getDb();
  if (!db) return down();
  const conditions = [eq(pcsConsignments.traderUserId, traderUserId)];
  if (opts.status) conditions.push(eq(pcsConsignments.lastMilestone, opts.status as never));
  const rows = await db
    .select()
    .from(pcsConsignments)
    .where(and(...conditions))
    .orderBy(desc(pcsConsignments.updatedAt))
    .limit(opts.limit + 1)
    .offset(opts.offset);
  const page = rows.slice(0, opts.limit);
  return value({ rows: page, nextCursor: rows.length > opts.limit ? opts.offset + opts.limit : null });
}

export async function getPcsConsignmentForTrader(
  traderUserId: number,
  consignmentId: number
): Promise<DbResult<PcsConsignment | null>> {
  const db = await getDb();
  if (!db) return down();
  const [row] = await db
    .select()
    .from(pcsConsignments)
    .where(and(eq(pcsConsignments.id, consignmentId), eq(pcsConsignments.traderUserId, traderUserId)))
    .limit(1);
  return value(row ?? null);
}

export async function listPcsMilestones(consignmentId: number): Promise<DbResult<PcsMilestone[]>> {
  const db = await getDb();
  if (!db) return down();
  const rows = await db.select().from(pcsMilestones).where(eq(pcsMilestones.consignmentId, consignmentId));
  return value(rows);
}

/** Sets the declaration cross-link; returns the updated consignment. */
export async function linkPcsConsignmentDeclaration(
  consignmentId: number,
  urn: string
): Promise<DbResult<PcsConsignment | null>> {
  const db = await getDb();
  if (!db) return down();
  const [row] = await db
    .update(pcsConsignments)
    .set({ declarationUrn: urn, updatedAt: new Date() })
    .where(eq(pcsConsignments.id, consignmentId))
    .returning();
  return value(row ?? null);
}

/** Finds an EXISTING declaration owned by the trader (URN cross-link anchor). */
export async function findOwnedDeclaration(
  traderUserId: number,
  declarationNumber: string
): Promise<DbResult<{ id: number; declarationNumber: string } | null>> {
  const db = await getDb();
  if (!db) return down();
  const [row] = await db
    .select({ id: declarations.id, declarationNumber: declarations.declarationNumber })
    .from(declarations)
    .where(and(eq(declarations.declarationNumber, declarationNumber), eq(declarations.traderId, traderUserId)))
    .limit(1);
  return value(row ?? null);
}

// ─── Booking links ──────────────────────────────────────────────────────────

export async function listPcsBookingLinksForTrader(
  traderUserId: number,
  limit = 50
): Promise<DbResult<PcsBookingLink[]>> {
  const db = await getDb();
  if (!db) return down();
  const rows = await db
    .select()
    .from(pcsBookingLinks)
    .where(eq(pcsBookingLinks.traderUserId, traderUserId))
    .orderBy(desc(pcsBookingLinks.createdAt))
    .limit(limit);
  return value(rows);
}

export async function findPcsBookingLinkForTrader(
  traderUserId: number,
  bookingId: string
): Promise<DbResult<PcsBookingLink | null>> {
  const db = await getDb();
  if (!db) return down();
  const [row] = await db
    .select()
    .from(pcsBookingLinks)
    .where(and(eq(pcsBookingLinks.bookingId, bookingId), eq(pcsBookingLinks.traderUserId, traderUserId)))
    .limit(1);
  return value(row ?? null);
}

/** Idempotent on booking_id (unique constraint). */
export async function insertPcsBookingLink(values: {
  traderUserId: number;
  bookingId: string;
  consignmentId: number | null;
  createdVia: "pcs" | "ussd" | "direct";
}): Promise<DbResult<void>> {
  const db = await getDb();
  if (!db) return down();
  await db.insert(pcsBookingLinks).values(values).onConflictDoNothing();
  return value(undefined);
}

// ─── Billing snapshots (read-only projection) ────────────────────────────────

export async function listPcsBillingSnapshotsForBookings(
  bookingIds: string[],
  opts: { from?: Date; to?: Date; limit: number }
): Promise<DbResult<PcsBillingSnapshot[]>> {
  const db = await getDb();
  if (!db) return down();
  if (bookingIds.length === 0) return value([]);
  const conditions = [inArray(pcsBillingSnapshots.bookingId, bookingIds)];
  if (opts.from) conditions.push(gte(pcsBillingSnapshots.occurredAt, opts.from));
  if (opts.to) conditions.push(lte(pcsBillingSnapshots.occurredAt, opts.to));
  const rows = await db
    .select()
    .from(pcsBillingSnapshots)
    .where(and(...conditions))
    .orderBy(desc(pcsBillingSnapshots.occurredAt))
    .limit(opts.limit);
  return value(rows);
}

/** Matches invoice id OR payment receipt reference (never a fuzzy search). */
export async function findPcsBillingSnapshotForBookings(
  bookingIds: string[],
  invoiceOrReceiptId: string
): Promise<DbResult<PcsBillingSnapshot | null>> {
  const db = await getDb();
  if (!db) return down();
  if (bookingIds.length === 0) return value(null);
  const rows = await db
    .select()
    .from(pcsBillingSnapshots)
    .where(inArray(pcsBillingSnapshots.bookingId, bookingIds));
  return value(rows.find((r) => r.invoiceId === invoiceOrReceiptId || r.receiptId === invoiceOrReceiptId) ?? null);
}

// ─── PCS documents (document_vault slice) ───────────────────────────────────

export async function listPcsDocuments(
  ownerId: number,
  categories: readonly string[],
  opts: { category?: string; limit: number; offset: number }
): Promise<DbResult<DocumentVault[]>> {
  const db = await getDb();
  if (!db) return down();
  const conditions = [
    eq(documentVault.ownerId, ownerId),
    eq(documentVault.status, "active" as never),
    opts.category
      ? eq(documentVault.category, opts.category as never)
      : inArray(documentVault.category, [...categories] as never[]),
  ];
  const rows = await db
    .select()
    .from(documentVault)
    .where(and(...conditions))
    .orderBy(desc(documentVault.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
  return value(rows);
}

// ─── PCS notification preferences ───────────────────────────────────────────

export async function listPcsNotificationPreferences(
  userId: number,
  eventTypes: readonly string[]
): Promise<DbResult<NotificationChannelPreference[]>> {
  const db = await getDb();
  if (!db) return down();
  const rows = await db
    .select()
    .from(notificationChannelPreferences)
    .where(and(
      eq(notificationChannelPreferences.userId, userId),
      inArray(notificationChannelPreferences.notificationType, [...eventTypes] as never[])
    ));
  return value(rows);
}

export async function upsertPcsNotificationPreference(
  userId: number,
  eventType: string,
  channel: string,
  enabled: boolean
): Promise<DbResult<void>> {
  const db = await getDb();
  if (!db) return down();
  await db
    .insert(notificationChannelPreferences)
    .values({ userId, notificationType: eventType as never, channel: channel as never, enabled })
    .onConflictDoUpdate({
      target: [
        notificationChannelPreferences.userId,
        notificationChannelPreferences.notificationType,
        notificationChannelPreferences.channel,
      ],
      set: { enabled, updatedAt: new Date() },
    });
  return value(undefined);
}
