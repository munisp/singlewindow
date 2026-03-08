import { eq, desc, and, sql, count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  InsertUser, users, stakeholderProfiles, declarations,
  declarationDocuments, ogaPermits, payments, auditEvents,
  securityAlerts, sanctionsChecks, aeoApplications, notifications,
  kycDocuments, kycVerifications, visionAnalyses,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _pool = new Pool({ connectionString: process.env.DATABASE_URL });
      _db = drizzle(_pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── USER QUERIES ─────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0] ?? undefined;
}

export async function getAllUsers(limit = 50, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).limit(limit).offset(offset).orderBy(desc(users.createdAt));
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0] ?? undefined;
}

// ─── STAKEHOLDER PROFILE QUERIES ─────────────────────────────────────────────

export async function getProfileByUserId(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(stakeholderProfiles)
    .where(eq(stakeholderProfiles.userId, userId)).limit(1);
  return result[0] ?? undefined;
}

export async function createProfile(data: typeof stakeholderProfiles.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(stakeholderProfiles).values(data).returning();
  return result[0];
}

export async function updateProfile(id: number, data: Partial<typeof stakeholderProfiles.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.update(stakeholderProfiles)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(stakeholderProfiles.id, id))
    .returning();
  return result[0];
}

export async function getPendingProfiles() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(stakeholderProfiles)
    .where(eq(stakeholderProfiles.status, "pending"))
    .orderBy(desc(stakeholderProfiles.createdAt));
}

export async function getAllProfiles(limit = 50, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(stakeholderProfiles).limit(limit).offset(offset)
    .orderBy(desc(stakeholderProfiles.createdAt));
}

// ─── DECLARATION QUERIES ──────────────────────────────────────────────────────

export async function createDeclaration(data: typeof declarations.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(declarations).values(data).returning();
  return result[0];
}

export async function getDeclarationById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(declarations).where(eq(declarations.id, id)).limit(1);
  return result[0] ?? undefined;
}

export async function getDeclarationByNumber(declarationNumber: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(declarations)
    .where(eq(declarations.declarationNumber, declarationNumber)).limit(1);
  return result[0] ?? undefined;
}

export async function getDeclarationsByTrader(traderId: number, limit = 20, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(declarations)
    .where(eq(declarations.traderId, traderId))
    .orderBy(desc(declarations.createdAt))
    .limit(limit).offset(offset);
}

export async function getAllDeclarations(limit = 50, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(declarations)
    .orderBy(desc(declarations.createdAt))
    .limit(limit).offset(offset);
}

export async function updateDeclaration(id: number, data: Partial<typeof declarations.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.update(declarations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(declarations.id, id))
    .returning();
  return result[0];
}

export async function getDeclarationStats() {
  const db = await getDb();
  if (!db) return null;
  const [total, cleared, pending, rejected] = await Promise.all([
    db.select({ count: count() }).from(declarations),
    db.select({ count: count() }).from(declarations).where(eq(declarations.status, "cleared")),
    db.select({ count: count() }).from(declarations).where(eq(declarations.status, "submitted")),
    db.select({ count: count() }).from(declarations).where(eq(declarations.status, "rejected")),
  ]);
  return {
    total: total[0]?.count ?? 0,
    cleared: cleared[0]?.count ?? 0,
    pending: pending[0]?.count ?? 0,
    rejected: rejected[0]?.count ?? 0,
  };
}

// ─── DOCUMENT QUERIES ────────────────────────────────────────────────────────

export async function addDocument(data: typeof declarationDocuments.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(declarationDocuments).values(data).returning();
  return result[0];
}

export async function getDocumentsByDeclaration(declarationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(declarationDocuments)
    .where(eq(declarationDocuments.declarationId, declarationId));
}

// ─── OGA PERMIT QUERIES ──────────────────────────────────────────────────────

export async function createOgaPermit(data: typeof ogaPermits.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(ogaPermits).values(data).returning();
  return result[0];
}

export async function getPermitsByDeclaration(declarationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(ogaPermits).where(eq(ogaPermits.declarationId, declarationId));
}

export async function updateOgaPermit(id: number, data: Partial<typeof ogaPermits.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.update(ogaPermits)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(ogaPermits.id, id))
    .returning();
  return result[0];
}

export async function getPermitsByOfficer(officerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(ogaPermits)
    .where(eq(ogaPermits.assignedOfficerId, officerId))
    .orderBy(desc(ogaPermits.createdAt));
}

// ─── PAYMENT QUERIES ─────────────────────────────────────────────────────────

export async function createPayment(data: typeof payments.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(payments).values(data).returning();
  return result[0];
}

export async function updatePayment(id: number, data: Partial<typeof payments.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.update(payments)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(payments.id, id))
    .returning();
  return result[0];
}

export async function getPaymentsByDeclaration(declarationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(payments).where(eq(payments.declarationId, declarationId));
}

// ─── AUDIT QUERIES ───────────────────────────────────────────────────────────

export async function logAuditEvent(data: typeof auditEvents.$inferInsert) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditEvents).values(data);
}

export async function getAuditTrail(entityType: string, entityId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(auditEvents)
    .where(and(
      eq(auditEvents.entityType, entityType as any),
      eq(auditEvents.entityId, entityId)
    ))
    .orderBy(desc(auditEvents.createdAt));
}

// ─── SECURITY ALERT QUERIES ──────────────────────────────────────────────────

export async function createSecurityAlert(data: typeof securityAlerts.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(securityAlerts).values(data).returning();
  return result[0];
}

export async function getSecurityAlerts(limit = 50, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(securityAlerts)
    .orderBy(desc(securityAlerts.createdAt))
    .limit(limit).offset(offset);
}

export async function acknowledgeAlert(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.update(securityAlerts)
    .set({ acknowledged: true, acknowledgedBy: userId, acknowledgedAt: new Date() })
    .where(eq(securityAlerts.id, id))
    .returning();
  return result[0];
}

// ─── SANCTIONS QUERIES ───────────────────────────────────────────────────────

export async function createSanctionsCheck(data: typeof sanctionsChecks.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(sanctionsChecks).values(data).returning();
  return result[0];
}

export async function getSanctionsChecksByDeclaration(declarationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sanctionsChecks).where(eq(sanctionsChecks.declarationId, declarationId));
}

// ─── AEO QUERIES ─────────────────────────────────────────────────────────────

export async function createAeoApplication(data: typeof aeoApplications.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(aeoApplications).values(data).returning();
  return result[0];
}

export async function getAeoApplicationsByTrader(traderId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aeoApplications)
    .where(eq(aeoApplications.traderId, traderId))
    .orderBy(desc(aeoApplications.createdAt));
}

export async function updateAeoApplication(id: number, data: Partial<typeof aeoApplications.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.update(aeoApplications)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(aeoApplications.id, id))
    .returning();
  return result[0];
}

export async function getAllAeoApplications(limit = 50, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aeoApplications)
    .orderBy(desc(aeoApplications.createdAt))
    .limit(limit).offset(offset);
}

// ─── NOTIFICATION QUERIES ─────────────────────────────────────────────────────

export async function createNotification(data: typeof notifications.$inferInsert) {
  const db = await getDb();
  if (!db) return;
  await db.insert(notifications).values(data);
}

export async function getNotificationsByUser(userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function markNotificationRead(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(notifications).set({ read: true }).where(eq(notifications.id, id));
}

export async function markAllNotificationsRead(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(notifications).set({ read: true }).where(eq(notifications.userId, userId));
}

// ─── KYC DOCUMENT QUERIES ─────────────────────────────────────────────────────────

export async function createKYCDocument(data: typeof kycDocuments.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(kycDocuments).values(data).returning();
  return result[0];
}

export async function getKYCDocument(id: string | number) {
  const db = await getDb();
  if (!db) return undefined;
  const numId = typeof id === "string" ? parseInt(id, 10) : id;
  if (isNaN(numId)) return undefined;
  const result = await db.select().from(kycDocuments).where(eq(kycDocuments.id, numId)).limit(1);
  return result[0] ?? undefined;
}

export async function updateKYCDocument(id: string | number, data: Partial<typeof kycDocuments.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const numId = typeof id === "string" ? parseInt(id, 10) : id;
  const result = await db.update(kycDocuments).set(data).where(eq(kycDocuments.id, numId)).returning();
  return result[0];
}

export async function listKYCDocuments(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(kycDocuments)
    .where(eq(kycDocuments.userId, userId))
    .orderBy(desc(kycDocuments.createdAt));
}

// ─── KYC VERIFICATION QUERIES ───────────────────────────────────────────────────

export async function createKYCVerification(data: typeof kycVerifications.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(kycVerifications).values(data).returning();
  return result[0];
}

export async function getLatestKYCVerification(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(kycVerifications)
    .where(eq(kycVerifications.userId, userId))
    .orderBy(desc(kycVerifications.createdAt))
    .limit(1);
  return result[0] ?? undefined;
}

export async function updateKYCVerification(id: string | number, data: Partial<typeof kycVerifications.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const numId = typeof id === "string" ? parseInt(id, 10) : id;
  const result = await db.update(kycVerifications)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(kycVerifications.id, numId))
    .returning();
  return result[0];
}

export async function listKYCVerifications(opts: {
  status?: string;
  verificationType?: string;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: ReturnType<typeof eq>[] = [];
  if (opts.status) conditions.push(eq(kycVerifications.status, opts.status as any));
  if (opts.verificationType) conditions.push(eq(kycVerifications.verificationType, opts.verificationType as any));
  let q = db.select().from(kycVerifications).$dynamic();
  if (conditions.length > 0) q = q.where(and(...conditions));
  return q.orderBy(desc(kycVerifications.createdAt)).limit(opts.limit ?? 20).offset(opts.offset ?? 0);
}

// ─── VISION ANALYSIS QUERIES ───────────────────────────────────────────────────

export async function createVisionAnalysis(data: typeof visionAnalyses.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(visionAnalyses).values(data).returning();
  return result[0];
}

export async function getVisionAnalysis(reportId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(visionAnalyses)
    .where(eq(visionAnalyses.reportId, reportId)).limit(1);
  return result[0] ?? undefined;
}

export async function updateVisionAnalysis(reportId: string, data: Partial<typeof visionAnalyses.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.update(visionAnalyses).set(data)
    .where(eq(visionAnalyses.reportId, reportId)).returning();
  return result[0];
}

export async function listVisionAnalyses(declarationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(visionAnalyses)
    .where(eq(visionAnalyses.declarationId, declarationId))
    .orderBy(desc(visionAnalyses.createdAt));
}

export async function listVisionAnalysesByUser(userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(visionAnalyses)
    .where(eq(visionAnalyses.requestedBy, userId))
    .orderBy(desc(visionAnalyses.createdAt))
    .limit(limit);
}
