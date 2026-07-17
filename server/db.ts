import { eq, desc, and, gte, lte, sql, count, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  InsertUser, users, stakeholderProfiles, declarations,
  declarationDocuments, ogaPermits, payments, auditEvents,
  securityAlerts, sanctionsChecks, aeoApplications, notifications,
  kycDocuments, kycVerifications, visionAnalyses,
  portLocations, portCongestionEvents, vesselTrackingEvents,
  // v77 new tables
  tigerbeetleBonds, InsertTigerbeetleBond,
  tigerbeetlePenalties, InsertTigerbeetlePenalty,
  tigerbeetleTransitGuarantees, InsertTigerbeetleTransitGuarantee,
  paymentRiskScores, InsertPaymentRiskScore,
  hsClassificationCache, InsertHsClassificationCache,
  abDivergenceLog, InsertAbDivergenceLog,
  // v78 new tables
  kycEvents, InsertKycEvent,
  kafkaEventLog, InsertKafkaEventLog,
  ogaPermitEvents, InsertOgaPermitEvent,
  // v80 middleware audit tables
  temporalWorkflowRuns, InsertTemporalWorkflowRun,
  openAppSecEvents, InsertOpenAppSecEvent,
  lakehouseJobs, InsertLakehouseJob,
  // v82 geoip cache
  geoipCache, type InsertGeoipCache,
  // v83 new tables
  geoipSeedJobs, type InsertGeoipSeedJob,
  workflowInputSchemas, type InsertWorkflowInputSchema,
  // v88-v91 middleware tables
  fluvioTopicOffsets,
  apisixRouteAudit,
  keycloakSessions,
  permifyAuditLog,
  tenants,
  corazaWafRules,
  domainVerificationEvents,
} from "../drizzle/schema";
import { ENV } from './_core/env';

// Use undefined as sentinel so we can distinguish "not yet initialised" from
// "initialised but unavailable" (null).
let _db: ReturnType<typeof drizzle> | null | undefined = undefined;
let _pool: Pool | null = null;

// Returns a PostgreSQL connection string only when DATABASE_URL is already a
// postgres:// URL. If the platform injects a MySQL/TiDB URL (as Manus does),
// return null so callers fall back to in-memory seed data instead of hitting
// a localhost:5432 that doesn't exist in the sandbox.
function resolvePostgresUrl(): string | null {
  const raw = process.env.DATABASE_URL ?? "";
  if (raw.startsWith("postgresql://") || raw.startsWith("postgres://")) return raw;
  // DATABASE_URL is a MySQL/TiDB URL (Manus platform) — no local PG fallback.
  return null;
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (_db === undefined) {
    const url = resolvePostgresUrl();
    if (!url) {
      _db = null;
    } else {
      try {
        _pool = new Pool({ connectionString: url });
        _db = drizzle(_pool);
      } catch (error) {
        console.warn("[Database] Failed to connect:", error);
        _db = null;
      }
    }
  }
  return _db;
}

/**
 * Close the PostgreSQL connection pool. Called during graceful shutdown.
 */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
    console.log('[Database] Connection pool closed.');
  }
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

export async function getUsersByRole(role: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(eq(users.role, role as typeof users.role._.data));
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

export async function getAllDeclarations(
  limit = 50,
  offset = 0,
  opts?: { dateFrom?: Date; dateTo?: Date; status?: string }
) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (opts?.dateFrom) conditions.push(gte(declarations.submittedAt, opts.dateFrom));
  if (opts?.dateTo) conditions.push(lte(declarations.submittedAt, opts.dateTo));
  if (opts?.status) conditions.push(sql`${declarations.status} = ${opts.status}::declaration_status`);
  const base = db
    .select({
      id: declarations.id,
      declarationNumber: declarations.declarationNumber,
      ucr: declarations.ucr,
      traderId: declarations.traderId,
      traderName: users.name,
      traderEmail: users.email,
      declarationType: declarations.declarationType,
      status: declarations.status,
      riskLane: declarations.riskLane,
      riskScore: declarations.riskScore,
      hsCode: declarations.hsCode,
      goodsDescription: declarations.goodsDescription,
      countryOfOrigin: declarations.countryOfOrigin,
      countryOfDestination: declarations.countryOfDestination,
      portOfEntry: declarations.portOfEntry,
      grossWeight: declarations.grossWeight,
      netWeight: declarations.netWeight,
      numberOfPackages: declarations.numberOfPackages,
      invoiceValue: declarations.invoiceValue,
      invoiceCurrency: declarations.invoiceCurrency,
      dutyAmount: declarations.dutyAmount,
      vatAmount: declarations.vatAmount,
      levyAmount: declarations.levyAmount,
      totalDue: declarations.totalDue,
      assignedOfficerId: declarations.assignedOfficerId,
      aiExplanation: declarations.aiExplanation,
      sanctionsFlags: declarations.sanctionsFlags,
      submittedAt: declarations.submittedAt,
      clearedAt: declarations.clearedAt,
      createdAt: declarations.createdAt,
      updatedAt: declarations.updatedAt,
    })
    .from(declarations)
    .leftJoin(users, eq(declarations.traderId, users.id));
  const filtered = conditions.length > 0 ? base.where(and(...conditions)) : base;
  return filtered.orderBy(desc(declarations.submittedAt)).limit(limit).offset(offset);
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

export async function getDeclarationStatsByTrader(traderId: number) {
  const db = await getDb();
  if (!db) return null;
  const [total, cleared, pending, rejected, submitted] = await Promise.all([
    db.select({ count: count() }).from(declarations).where(eq(declarations.traderId, traderId)),
    db.select({ count: count() }).from(declarations).where(and(eq(declarations.traderId, traderId), eq(declarations.status, "cleared"))),
    db.select({ count: count() }).from(declarations).where(and(eq(declarations.traderId, traderId), eq(declarations.status, "payment_pending"))),
    db.select({ count: count() }).from(declarations).where(and(eq(declarations.traderId, traderId), eq(declarations.status, "rejected"))),
    db.select({ count: count() }).from(declarations).where(and(eq(declarations.traderId, traderId), eq(declarations.status, "submitted"))),
  ]);
  return {
    total: total[0]?.count ?? 0,
    cleared: cleared[0]?.count ?? 0,
    pending: pending[0]?.count ?? 0,
    rejected: rejected[0]?.count ?? 0,
    submitted: submitted[0]?.count ?? 0,
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

export async function getPermitsByOfficer(officerId: number, role?: string) {
  const db = await getDb();
  if (!db) return [];
  // Admin and customs_officer see all permits; oga_officer sees only their assigned permits
  if (role === 'admin' || role === 'customs_officer') {
    return db.select().from(ogaPermits).orderBy(desc(ogaPermits.createdAt));
  }
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

/**
 * logAuditEvent — R4 FIX: Tamper-evident hash chain
 *
 * Each audit entry stores:
 *   prevHash  — the entryHash of the most recent existing entry for this entity
 *   entryHash — SHA-256(entityType|entityId|action|actorId|createdAt|prevHash|JSON(newState))
 *
 * To verify integrity: re-compute entryHash for each row and confirm it matches the stored value,
 * and that prevHash matches the entryHash of the preceding row.
 */
export async function logAuditEvent(data: typeof auditEvents.$inferInsert) {
  const db = await getDb();
  if (!db) return;

  const { createHash } = await import('crypto');

  // Fetch the most recent entry for this entity to get prevHash
  const [lastEntry] = await db
    .select({ entryHash: auditEvents.entryHash })
    .from(auditEvents)
    .where(and(
      eq(auditEvents.entityType, data.entityType as any),
      eq(auditEvents.entityId, data.entityId!)
    ))
    .orderBy(desc(auditEvents.createdAt))
    .limit(1);

  const prevHash = lastEntry?.entryHash ?? null;
  const createdAt = data.createdAt ?? new Date();

  // Compute this entry's hash
  const hashInput = [
    data.entityType,
    String(data.entityId),
    data.action,
    String(data.actorId ?? ''),
    createdAt.toISOString(),
    prevHash ?? '',
    JSON.stringify(data.newState ?? null),
  ].join('|');

  const entryHash = createHash('sha256').update(hashInput).digest('hex');

  await db.insert(auditEvents).values({
    ...data,
    createdAt,
    prevHash,
    entryHash,
  });
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

export async function getAllPayments(limit = 50, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(payments).limit(limit).offset(offset).orderBy(payments.createdAt);
}

// ─── GEOSPATIAL QUERIES ───────────────────────────────────────────────────────
export async function listPortLocations(filters?: { country?: string; portType?: string }) {
  const db = await getDb();
  if (!db) return [];
  const conditions: ReturnType<typeof eq>[] = [eq(portLocations.isActive, true)];
  if (filters?.country) conditions.push(eq(portLocations.country, filters.country));
  if (filters?.portType) conditions.push(eq(portLocations.portType, filters.portType));
  return db.select().from(portLocations).where(and(...conditions));
}

export async function getPortCongestionHistory(portCode: string, since: Date) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(portCongestionEvents)
    .where(and(
      eq(portCongestionEvents.portCode, portCode),
      sql`${portCongestionEvents.recordedAt} >= ${since}`,
    ))
    .orderBy(desc(portCongestionEvents.recordedAt))
    .limit(100);
}

export async function listVesselTracking(filters?: { destinationPort?: string; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const lim = filters?.limit ?? 50;
  if (filters?.destinationPort) {
    return db.select().from(vesselTrackingEvents)
      .where(eq(vesselTrackingEvents.destinationPort, filters.destinationPort))
      .orderBy(desc(vesselTrackingEvents.recordedAt))
      .limit(lim);
  }
  return db.select().from(vesselTrackingEvents)
    .orderBy(desc(vesselTrackingEvents.recordedAt))
    .limit(lim);
}

export async function getHeatmapData() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    portCode: portLocations.portCode,
    portName: portLocations.portName,
    latitude: portLocations.latitude,
    longitude: portLocations.longitude,
    congestionStatus: portCongestionEvents.congestionStatus,
    vesselCount: portCongestionEvents.vesselCount,
    waitTimeHours: portCongestionEvents.waitTimeHours,
    declarationBacklog: portCongestionEvents.declarationBacklog,
    recordedAt: portCongestionEvents.recordedAt,
  })
    .from(portLocations)
    .leftJoin(portCongestionEvents, eq(portLocations.portCode, portCongestionEvents.portCode))
    .where(eq(portLocations.isActive, true))
    .orderBy(desc(portCongestionEvents.recordedAt));
}

export async function insertPortLocation(data: typeof portLocations.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(portLocations).values(data).onConflictDoNothing().returning();
  return result[0];
}

export async function insertCongestionEvent(data: typeof portCongestionEvents.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(portCongestionEvents).values(data).returning();
  return result[0];
}

export async function getPortCount() {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql<number>`count(*)` }).from(portLocations);
  return Number(result[0]?.count ?? 0);
}

export async function getCongestionCount() {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql<number>`count(*)` }).from(portCongestionEvents);
  return Number(result[0]?.count ?? 0);
}

export async function seedPortLocations(ports: typeof portLocations.$inferInsert[]) {
  const db = await getDb();
  if (!db) return;
  await db.insert(portLocations).values(ports).onConflictDoNothing();
}

export async function seedCongestionEvents(events: typeof portCongestionEvents.$inferInsert[]) {
  const db = await getDb();
  if (!db) return;
  await db.insert(portCongestionEvents).values(events);
}

export async function insertVesselPosition(data: typeof vesselTrackingEvents.$inferInsert) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(vesselTrackingEvents).values(data).returning();
  return result[0] ?? null;
}

// ─── FINANCE ANALYTICS QUERIES ───────────────────────────────────────────────
export async function getFinanceKPIs() {
  const db = await getDb();
  if (!db) return null;
  const [totalRevenue, pendingPayments, confirmedPayments, failedPayments] = await Promise.all([
    db.select({ total: sql<string>`COALESCE(SUM(CAST(amount AS DECIMAL)), 0)` })
      .from(payments).where(eq(payments.status, "confirmed")),
    db.select({ total: sql<string>`COALESCE(SUM(CAST(amount AS DECIMAL)), 0)`, count: count() })
      .from(payments).where(eq(payments.status, "pending")),
    db.select({ count: count() }).from(payments).where(eq(payments.status, "confirmed")),
    db.select({ count: count() }).from(payments).where(eq(payments.status, "failed")),
  ]);
  const [dutyRevenue, vatRevenue, levyRevenue, overdueDeclarations] = await Promise.all([
    db.select({ total: sql<string>`COALESCE(SUM(CAST(duty_amount AS DECIMAL)), 0)` })
      .from(declarations).where(eq(declarations.status, "cleared")),
    db.select({ total: sql<string>`COALESCE(SUM(CAST(vat_amount AS DECIMAL)), 0)` })
      .from(declarations).where(eq(declarations.status, "cleared")),
    db.select({ total: sql<string>`COALESCE(SUM(CAST(levy_amount AS DECIMAL)), 0)` })
      .from(declarations).where(eq(declarations.status, "cleared")),
    db.select({ count: count() }).from(declarations)
      .where(eq(declarations.status, "payment_pending")),
  ]);
  return {
    totalRevenue: parseFloat(totalRevenue[0]?.total ?? "0"),
    pendingAmount: parseFloat(pendingPayments[0]?.total ?? "0"),
    pendingCount: Number(pendingPayments[0]?.count ?? 0),
    confirmedCount: Number(confirmedPayments[0]?.count ?? 0),
    failedCount: Number(failedPayments[0]?.count ?? 0),
    dutyRevenue: parseFloat(dutyRevenue[0]?.total ?? "0"),
    vatRevenue: parseFloat(vatRevenue[0]?.total ?? "0"),
    levyRevenue: parseFloat(levyRevenue[0]?.total ?? "0"),
    overdueCount: Number(overdueDeclarations[0]?.count ?? 0),
  };
}

export async function getRevenueByHsChapter(limit = 15) {
  const db = await getDb();
  if (!db) return [];
  const results = await db.select({
    hsChapter: sql<string>`SUBSTRING(hs_code, 1, 2)`,
    totalDuty: sql<string>`COALESCE(SUM(CAST(duty_amount AS DECIMAL)), 0)`,
    totalVat: sql<string>`COALESCE(SUM(CAST(vat_amount AS DECIMAL)), 0)`,
    totalLevy: sql<string>`COALESCE(SUM(CAST(levy_amount AS DECIMAL)), 0)`,
    declarationCount: count(),
  })
    .from(declarations)
    .where(and(
      sql`hs_code IS NOT NULL`,
      sql`hs_code != ''`,
      eq(declarations.status, "cleared"),
    ))
    .groupBy(sql`SUBSTRING(hs_code, 1, 2)`)
    .orderBy(desc(sql`SUM(CAST(duty_amount AS DECIMAL))`))
    .limit(limit);
  return results.map(r => ({
    hsChapter: r.hsChapter,
    totalDuty: parseFloat(r.totalDuty),
    totalVat: parseFloat(r.totalVat),
    totalLevy: parseFloat(r.totalLevy),
    totalRevenue: parseFloat(r.totalDuty) + parseFloat(r.totalVat) + parseFloat(r.totalLevy),
    declarationCount: Number(r.declarationCount),
  }));
}

export async function getRevenueByCountry(limit = 10) {
  const db = await getDb();
  if (!db) return [];
  const results = await db.select({
    country: declarations.countryOfOrigin,
    totalDuty: sql<string>`COALESCE(SUM(CAST(duty_amount AS DECIMAL)), 0)`,
    totalRevenue: sql<string>`COALESCE(SUM(CAST(total_due AS DECIMAL)), 0)`,
    declarationCount: count(),
  })
    .from(declarations)
    .where(and(
      sql`country_of_origin IS NOT NULL`,
      eq(declarations.status, "cleared"),
    ))
    .groupBy(declarations.countryOfOrigin)
    .orderBy(desc(sql`SUM(CAST(total_due AS DECIMAL))`))
    .limit(limit);
  return results.map(r => ({
    country: r.country ?? "Unknown",
    totalDuty: parseFloat(r.totalDuty),
    totalRevenue: parseFloat(r.totalRevenue),
    declarationCount: Number(r.declarationCount),
  }));
}

export async function getPaymentTrend(days = 30) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  const results = await db.select({
    date: sql<string>`DATE(created_at)`,
    totalAmount: sql<string>`COALESCE(SUM(CAST(amount AS DECIMAL)), 0)`,
    paymentCount: count(),
    confirmedCount: sql<number>`COUNT(CASE WHEN status = 'confirmed' THEN 1 END)`,
  })
    .from(payments)
    .where(sql`created_at >= ${since}`)
    .groupBy(sql`DATE(created_at)`)
    .orderBy(sql`DATE(created_at)`);
  return results.map(r => ({
    date: r.date,
    totalAmount: parseFloat(r.totalAmount),
    paymentCount: Number(r.paymentCount),
    confirmedCount: Number(r.confirmedCount),
  }));
}

export async function getRevenueByDeclarationType() {
  const db = await getDb();
  if (!db) return [];
  const results = await db.select({
    declarationType: declarations.declarationType,
    totalRevenue: sql<string>`COALESCE(SUM(CAST(total_due AS DECIMAL)), 0)`,
    totalDuty: sql<string>`COALESCE(SUM(CAST(duty_amount AS DECIMAL)), 0)`,
    declarationCount: count(),
  })
    .from(declarations)
    .where(eq(declarations.status, "cleared"))
    .groupBy(declarations.declarationType)
    .orderBy(desc(sql`SUM(CAST(total_due AS DECIMAL))`));
  return results.map(r => ({
    declarationType: r.declarationType,
    totalRevenue: parseFloat(r.totalRevenue),
    totalDuty: parseFloat(r.totalDuty),
    declarationCount: Number(r.declarationCount),
  }));
}

export async function getPortRevenueBreakdown(limit = 10) {
  const db = await getDb();
  if (!db) return [];
  const results = await db.select({
    portOfEntry: declarations.portOfEntry,
    totalRevenue: sql<string>`COALESCE(SUM(CAST(total_due AS DECIMAL)), 0)`,
    declarationCount: count(),
  })
    .from(declarations)
    .where(and(
      sql`port_of_entry IS NOT NULL`,
      eq(declarations.status, "cleared"),
    ))
    .groupBy(declarations.portOfEntry)
    .orderBy(desc(sql`SUM(CAST(total_due AS DECIMAL))`))
    .limit(limit);
  return results.map(r => ({
    portOfEntry: r.portOfEntry ?? "Unknown",
    totalRevenue: parseFloat(r.totalRevenue),
    declarationCount: Number(r.declarationCount),
  }));
}

export async function getPendingPaymentsList(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: payments.id,
    reference: payments.reference,
    amount: payments.amount,
    currency: payments.currency,
    paymentMethod: payments.paymentMethod,
    status: payments.status,
    createdAt: payments.createdAt,
    declarationId: payments.declarationId,
    declarationNumber: declarations.declarationNumber,
    hsCode: declarations.hsCode,
    portOfEntry: declarations.portOfEntry,
  })
    .from(payments)
    .innerJoin(declarations, eq(payments.declarationId, declarations.id))
    .where(eq(payments.status, "pending"))
    .orderBy(payments.createdAt)
    .limit(limit);
}

export async function getRiskLaneRevenueBreakdown() {
  const db = await getDb();
  if (!db) return [];
  const results = await db.select({
    riskLane: declarations.riskLane,
    totalRevenue: sql<string>`COALESCE(SUM(CAST(total_due AS DECIMAL)), 0)`,
    declarationCount: count(),
  })
    .from(declarations)
    .where(eq(declarations.status, "cleared"))
    .groupBy(declarations.riskLane)
    .orderBy(declarations.riskLane);
  return results.map(r => ({
    riskLane: r.riskLane ?? "unknown",
    totalRevenue: parseFloat(r.totalRevenue),
    declarationCount: Number(r.declarationCount),
  }));
}

// ─── USER NOTIFICATION QUERIES (Sprint 15 Notification Centre) ────────────────

export async function createUserNotification(data: {
  userId: number;
  type: string;
  title: string;
  body: string;
  declarationId?: number | null;
}) {
  const db = await getDb();
  if (!db) return null;
  const { userNotifications } = await import("../drizzle/schema");
  const [result] = await db
    .insert(userNotifications)
    .values({
      userId: data.userId,
      type: data.type as any,
      title: data.title,
      body: data.body,
      declarationId: data.declarationId ?? null,
      isRead: false,
    })
    .returning();
  return result;
}

export async function getUserNotifications(userId: number, limit = 50, onlyUnread = false) {
  const db = await getDb();
  if (!db) return [];
  const { userNotifications } = await import("../drizzle/schema");
  const { eq, desc, and } = await import("drizzle-orm");
  const conditions = onlyUnread
    ? and(eq(userNotifications.userId, userId), eq(userNotifications.isRead, false))
    : eq(userNotifications.userId, userId);
  return db
    .select()
    .from(userNotifications)
    .where(conditions)
    .orderBy(desc(userNotifications.createdAt))
    .limit(limit);
}

export async function getUserUnreadCount(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const { userNotifications } = await import("../drizzle/schema");
  const { eq, and, count: countFn } = await import("drizzle-orm");
  const [result] = await db
    .select({ count: countFn() })
    .from(userNotifications)
    .where(and(eq(userNotifications.userId, userId), eq(userNotifications.isRead, false)));
  return Number(result?.count ?? 0);
}

export async function markUserNotificationRead(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  const { userNotifications } = await import("../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");
  await db
    .update(userNotifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(userNotifications.id, id), eq(userNotifications.userId, userId)));
}

export async function markAllUserNotificationsRead(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const { userNotifications } = await import("../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");
  const result = await db
    .update(userNotifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(userNotifications.userId, userId), eq(userNotifications.isRead, false)))
    .returning({ id: userNotifications.id });
  return result.length;
}

// ─── MOJALOOP TRANSACTION QUERIES ────────────────────────────────────────────

export async function createMojaloopTransaction(data: typeof import("../drizzle/schema").mojaloopTransactions.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const { mojaloopTransactions } = await import("../drizzle/schema");
  const result = await db.insert(mojaloopTransactions).values(data).returning();
  return result[0];
}

export async function getMojaloopTransactionByTransferId(transferId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const { mojaloopTransactions } = await import("../drizzle/schema");
  const result = await db.select().from(mojaloopTransactions)
    .where(eq(mojaloopTransactions.transferId, transferId)).limit(1);
  return result[0] ?? undefined;
}

export async function updateMojaloopTransaction(transferId: string, data: Partial<typeof import("../drizzle/schema").mojaloopTransactions.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const { mojaloopTransactions } = await import("../drizzle/schema");
  const result = await db.update(mojaloopTransactions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(mojaloopTransactions.transferId, transferId))
    .returning();
  return result[0];
}

export async function getMojaloopTransactionsByDeclaration(declarationId: number) {
  const db = await getDb();
  if (!db) return [];
  const { mojaloopTransactions } = await import("../drizzle/schema");
  return db.select().from(mojaloopTransactions)
    .where(eq(mojaloopTransactions.declarationId, declarationId))
    .orderBy(desc(mojaloopTransactions.createdAt));
}

export async function getMojaloopTransactionsByUser(userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  const { mojaloopTransactions } = await import("../drizzle/schema");
  return db.select().from(mojaloopTransactions)
    .where(eq(mojaloopTransactions.initiatedBy, userId))
    .orderBy(desc(mojaloopTransactions.createdAt))
    .limit(limit);
}

// ─── TIGERBEETLE LEDGER QUERIES ───────────────────────────────────────────────

export async function createLedgerEntry(data: typeof import("../drizzle/schema").tigerBeetleLedgerEntries.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const { tigerBeetleLedgerEntries } = await import("../drizzle/schema");
  const result = await db.insert(tigerBeetleLedgerEntries).values(data).returning();
  return result[0];
}

export async function getLedgerEntriesByDeclaration(declarationId: number) {
  const db = await getDb();
  if (!db) return [];
  const { tigerBeetleLedgerEntries } = await import("../drizzle/schema");
  return db.select().from(tigerBeetleLedgerEntries)
    .where(eq(tigerBeetleLedgerEntries.declarationId, declarationId))
    .orderBy(desc(tigerBeetleLedgerEntries.createdAt));
}

export async function getLedgerEntriesByPayment(paymentId: number) {
  const db = await getDb();
  if (!db) return [];
  const { tigerBeetleLedgerEntries } = await import("../drizzle/schema");
  return db.select().from(tigerBeetleLedgerEntries)
    .where(eq(tigerBeetleLedgerEntries.paymentId, paymentId))
    .orderBy(desc(tigerBeetleLedgerEntries.createdAt));
}

export async function getRecentLedgerEntries(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  const { tigerBeetleLedgerEntries } = await import("../drizzle/schema");
  return db.select().from(tigerBeetleLedgerEntries)
    .orderBy(desc(tigerBeetleLedgerEntries.createdAt))
    .limit(limit);
}

export async function updateLedgerEntry(tbTransferId: string, data: Partial<typeof import("../drizzle/schema").tigerBeetleLedgerEntries.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const { tigerBeetleLedgerEntries } = await import("../drizzle/schema");
  const result = await db.update(tigerBeetleLedgerEntries)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(tigerBeetleLedgerEntries.tbTransferId, tbTransferId))
    .returning();
  return result[0];
}

// ─── KEYCLOAK CONFIG QUERIES ──────────────────────────────────────────────────

export async function getKeycloakConfig() {
  const db = await getDb();
  if (!db) return undefined;
  const { keycloakConfig } = await import("../drizzle/schema");
  const result = await db.select().from(keycloakConfig).limit(1);
  return result[0] ?? undefined;
}

export async function upsertKeycloakConfig(data: Partial<typeof import("../drizzle/schema").keycloakConfig.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const { keycloakConfig } = await import("../drizzle/schema");
  // Only one row ever exists (id=1)
  const existing = await db.select().from(keycloakConfig).limit(1);
  if (existing[0]) {
    const result = await db.update(keycloakConfig)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(keycloakConfig.id, existing[0].id))
      .returning();
    return result[0];
  } else {
    const result = await db.insert(keycloakConfig).values({ ...data }).returning();
    return result[0];
  }
}

// ─── RLS CONTEXT HELPERS ──────────────────────────────────────────────────────
/**
 * Export the raw pg Pool so callers can acquire a client for SET LOCAL.
 */
export function getPool(): Pool | null {
  return _pool;
}

/**
 * withRlsContext — runs a callback inside a PostgreSQL transaction with
 * app.current_user_id and app.current_user_role set via SET LOCAL so that
 * all RLS policies on multi-tenant tables are enforced for the duration.
 *
 * Usage:
 *   const result = await withRlsContext({ id: ctx.user.id, role: ctx.user.role }, async (db) => {
 *     return db.select().from(declarations).where(eq(declarations.traderId, ctx.user.id));
 *   });
 */
export async function withRlsContext<T>(
  user: { id: number; role: string },
  callback: (db: NonNullable<Awaited<ReturnType<typeof getDb>>>) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const pool = getPool();

  // In test / offline environments where no pg Pool is available (e.g. the pool
  // failed to initialise because DATABASE_URL is not a PostgreSQL URL), fall
  // back to a plain Drizzle query without SET LOCAL. RLS is a production-only
  // concern; tests rely on application-level ownership checks.
  if (!pool) {
    return callback(db);
  }

  // Acquire a dedicated client so SET LOCAL is scoped to this transaction only
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [String(user.id)]);
    await client.query("SELECT set_config('app.current_user_role', $1, true)", [user.role]);
    // Create a Drizzle instance bound to this specific client
    const txDb = drizzle(client as any);
    const result = await callback(txDb as any);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── v77: DB Helpers for New Tables ──────────────────────────────────────────

// --- TigerBeetle Bonds ---
export async function createBond(data: InsertTigerbeetleBond) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(tigerbeetleBonds).values(data).returning();
  return row;
}

export async function getBondsByDeclaration(declarationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tigerbeetleBonds)
    .where(eq(tigerbeetleBonds.declarationId, declarationId))
    .orderBy(desc(tigerbeetleBonds.createdAt));
}

export async function getBondsByTrader(traderId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tigerbeetleBonds)
    .where(eq(tigerbeetleBonds.traderId, traderId))
    .orderBy(desc(tigerbeetleBonds.createdAt));
}

export async function updateBondStatus(bondId: string, status: InsertTigerbeetleBond["status"], extra?: Partial<InsertTigerbeetleBond>) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.update(tigerbeetleBonds)
    .set({ status, ...extra, updatedAt: new Date() })
    .where(eq(tigerbeetleBonds.bondId, bondId))
    .returning();
  return row;
}

// --- TigerBeetle Penalties ---
export async function createPenalty(data: InsertTigerbeetlePenalty) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(tigerbeetlePenalties).values(data).returning();
  return row;
}

export async function getPenaltiesByDeclaration(declarationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tigerbeetlePenalties)
    .where(eq(tigerbeetlePenalties.declarationId, declarationId))
    .orderBy(desc(tigerbeetlePenalties.createdAt));
}

export async function getPenaltiesByTrader(traderId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tigerbeetlePenalties)
    .where(eq(tigerbeetlePenalties.traderId, traderId))
    .orderBy(desc(tigerbeetlePenalties.createdAt));
}

// --- TigerBeetle Transit Guarantees ---
export async function createTransitGuarantee(data: InsertTigerbeetleTransitGuarantee) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(tigerbeetleTransitGuarantees).values(data).returning();
  return row;
}

export async function getTransitGuaranteesByDeclaration(declarationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tigerbeetleTransitGuarantees)
    .where(eq(tigerbeetleTransitGuarantees.declarationId, declarationId))
    .orderBy(desc(tigerbeetleTransitGuarantees.createdAt));
}

// --- Payment Risk Scores ---
export async function createPaymentRiskScore(data: InsertPaymentRiskScore) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(paymentRiskScores).values(data).returning();
  return row;
}

export async function getPaymentRiskScoresByDeclaration(declarationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(paymentRiskScores)
    .where(eq(paymentRiskScores.declarationId, declarationId))
    .orderBy(desc(paymentRiskScores.scoredAt));
}

export async function getLatestPaymentRiskScore(declarationId: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(paymentRiskScores)
    .where(eq(paymentRiskScores.declarationId, declarationId))
    .orderBy(desc(paymentRiskScores.scoredAt))
    .limit(1);
  return row ?? null;
}

// --- HS Classification Cache ---
export async function upsertHsClassification(data: InsertHsClassificationCache) {
  const db = await getDb();
  if (!db) return null;
  const existing = await db.select().from(hsClassificationCache)
    .where(eq(hsClassificationCache.hsCode, data.hsCode))
    .limit(1);
  if (existing.length > 0) {
    const [row] = await db.update(hsClassificationCache)
      .set({ hitCount: sql`${hsClassificationCache.hitCount} + 1`, lastHitAt: new Date() })
      .where(eq(hsClassificationCache.hsCode, data.hsCode))
      .returning();
    return row;
  }
  const [row] = await db.insert(hsClassificationCache).values(data).returning();
  return row;
}

export async function getHsClassification(hsCode: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(hsClassificationCache)
    .where(eq(hsClassificationCache.hsCode, hsCode))
    .limit(1);
  return row ?? null;
}

// --- A/B Divergence Log ---
export async function createAbDivergenceEntry(data: InsertAbDivergenceLog) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(abDivergenceLog).values(data).returning();
  return row;
}

export async function getAbDivergenceStats(since?: Date) {
  const db = await getDb();
  if (!db) return { total: 0, diverged: 0, agreeRate: 1.0 };
  const base = db.select({ total: count(), diverged: sql<number>`sum(case when ${abDivergenceLog.diverged} then 1 else 0 end)` })
    .from(abDivergenceLog);
  const [row] = since
    ? await base.where(gte(abDivergenceLog.createdAt, since))
    : await base;
  const total = Number(row?.total ?? 0);
  const diverged = Number(row?.diverged ?? 0);
  return { total, diverged, agreeRate: total > 0 ? (total - diverged) / total : 1.0 };
}

// --- KYC Events (v78) ---
export async function createKycEvent(data: InsertKycEvent) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(kycEvents).values(data).returning();
  return row;
}
export async function getKycEventsByDeclaration(declarationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(kycEvents)
    .where(eq(kycEvents.declarationId, declarationId))
    .orderBy(desc(kycEvents.createdAt));
}
export async function getKycEventsByUser(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(kycEvents)
    .where(eq(kycEvents.userId, userId))
    .orderBy(desc(kycEvents.createdAt))
    .limit(limit);
}

// --- Kafka Event Log / Outbox (v78) ---
export async function createKafkaEventLogEntry(data: InsertKafkaEventLog) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(kafkaEventLog).values(data).returning();
  return row;
}
export async function getPendingKafkaEvents(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(kafkaEventLog)
    .where(eq(kafkaEventLog.status, "pending"))
    .orderBy(kafkaEventLog.createdAt)
    .limit(limit);
}
export async function markKafkaEventPublished(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.update(kafkaEventLog)
    .set({ status: "published", publishedAt: new Date() })
    .where(eq(kafkaEventLog.id, id))
    .returning();
  return row;
}
export async function markKafkaEventFailed(id: number, errorMessage: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.update(kafkaEventLog)
    .set({
      status: "failed",
      errorMessage,
      lastAttemptAt: new Date(),
      attempts: sql`${kafkaEventLog.attempts} + 1`,
    })
    .where(eq(kafkaEventLog.id, id))
    .returning();
  return row;
}

// --- OGA Permit Events / Event Sourcing (v78) ---
export async function createOgaPermitEvent(data: InsertOgaPermitEvent) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(ogaPermitEvents).values(data).returning();
  return row;
}
export async function getOgaPermitEventsByPermit(permitId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(ogaPermitEvents)
    .where(eq(ogaPermitEvents.permitId, permitId))
    .orderBy(ogaPermitEvents.createdAt);
}
export async function getOgaPermitEventsByDeclaration(declarationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(ogaPermitEvents)
    .where(eq(ogaPermitEvents.declarationId, declarationId))
    .orderBy(ogaPermitEvents.createdAt);
}

// ─── TEMPORAL WORKFLOW RUN QUERIES ───────────────────────────────────────────

export async function getTemporalRuns(opts?: {
  limit?: number;
  offset?: number;
  status?: string;
  workflowType?: string;
  declarationId?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (opts?.status) conditions.push(eq(temporalWorkflowRuns.status, opts.status));
  if (opts?.workflowType) conditions.push(eq(temporalWorkflowRuns.workflowType, opts.workflowType));
  if (opts?.declarationId) conditions.push(eq(temporalWorkflowRuns.declarationId, opts.declarationId));
  const base = db.select().from(temporalWorkflowRuns);
  const filtered = conditions.length > 0 ? base.where(and(...conditions)) : base;
  return filtered
    .orderBy(desc(temporalWorkflowRuns.startedAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);
}

export async function getTemporalRunById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(temporalWorkflowRuns)
    .where(eq(temporalWorkflowRuns.id, id)).limit(1);
  return result[0] ?? undefined;
}

export async function upsertTemporalRun(data: InsertTemporalWorkflowRun) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(temporalWorkflowRuns).values(data)
    .onConflictDoUpdate({ target: temporalWorkflowRuns.runId, set: { ...data } })
    .returning();
  return row;
}

export async function getTemporalRunStats() {
  const db = await getDb();
  if (!db) return null;
  const [running, completed, failed, timedOut] = await Promise.all([
    db.select({ count: count() }).from(temporalWorkflowRuns).where(eq(temporalWorkflowRuns.status, "running")),
    db.select({ count: count() }).from(temporalWorkflowRuns).where(eq(temporalWorkflowRuns.status, "completed")),
    db.select({ count: count() }).from(temporalWorkflowRuns).where(eq(temporalWorkflowRuns.status, "failed")),
    db.select({ count: count() }).from(temporalWorkflowRuns).where(eq(temporalWorkflowRuns.status, "timed_out")),
  ]);
  return {
    running: running[0]?.count ?? 0,
    completed: completed[0]?.count ?? 0,
    failed: failed[0]?.count ?? 0,
    timedOut: timedOut[0]?.count ?? 0,
  };
}

// ─── OPENAPPSEC WAF EVENT QUERIES ─────────────────────────────────────────────

export async function getOpenAppSecEvents(opts?: {
  limit?: number;
  offset?: number;
  severity?: string;
  attackType?: string;
  isAcknowledged?: boolean;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (opts?.severity) conditions.push(eq(openAppSecEvents.severity, opts.severity));
  if (opts?.attackType) conditions.push(eq(openAppSecEvents.attackType, opts.attackType));
  if (opts?.isAcknowledged !== undefined) conditions.push(eq(openAppSecEvents.isAcknowledged, opts.isAcknowledged));
  const base = db.select().from(openAppSecEvents);
  const filtered = conditions.length > 0 ? base.where(and(...conditions)) : base;
  return filtered
    .orderBy(desc(openAppSecEvents.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);
}

export async function acknowledgeOpenAppSecEvent(id: number, acknowledgedBy: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.update(openAppSecEvents)
    .set({ isAcknowledged: true, acknowledgedBy })
    .where(eq(openAppSecEvents.id, id))
    .returning();
  return row;
}

export async function getOpenAppSecEventStats() {
  const db = await getDb();
  if (!db) return null;
  const [critical, high, medium, low, unacked] = await Promise.all([
    db.select({ count: count() }).from(openAppSecEvents).where(eq(openAppSecEvents.severity, "critical")),
    db.select({ count: count() }).from(openAppSecEvents).where(eq(openAppSecEvents.severity, "high")),
    db.select({ count: count() }).from(openAppSecEvents).where(eq(openAppSecEvents.severity, "medium")),
    db.select({ count: count() }).from(openAppSecEvents).where(eq(openAppSecEvents.severity, "low")),
    db.select({ count: count() }).from(openAppSecEvents).where(eq(openAppSecEvents.isAcknowledged, false)),
  ]);
  return {
    critical: critical[0]?.count ?? 0,
    high: high[0]?.count ?? 0,
    medium: medium[0]?.count ?? 0,
    low: low[0]?.count ?? 0,
    unacknowledged: unacked[0]?.count ?? 0,
  };
}

// ─── LAKEHOUSE JOB QUERIES ────────────────────────────────────────────────────

export async function getLakehouseJobs(opts?: {
  limit?: number;
  offset?: number;
  status?: string;
  jobType?: string;
  targetTable?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (opts?.status) conditions.push(eq(lakehouseJobs.status, opts.status));
  if (opts?.jobType) conditions.push(eq(lakehouseJobs.jobType, opts.jobType));
  if (opts?.targetTable) conditions.push(eq(lakehouseJobs.targetTable, opts.targetTable));
  const base = db.select().from(lakehouseJobs);
  const filtered = conditions.length > 0 ? base.where(and(...conditions)) : base;
  return filtered
    .orderBy(desc(lakehouseJobs.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);
}

export async function getLakehouseJobById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(lakehouseJobs).where(eq(lakehouseJobs.id, id)).limit(1);
  return result[0] ?? undefined;
}

export async function upsertLakehouseJob(data: InsertLakehouseJob) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(lakehouseJobs).values(data)
    .onConflictDoUpdate({ target: lakehouseJobs.jobId, set: { ...data } })
    .returning();
  return row;
}

export async function getLakehouseJobStats() {
  const db = await getDb();
  if (!db) return null;
  const [running, completed, failed, pending] = await Promise.all([
    db.select({ count: count() }).from(lakehouseJobs).where(eq(lakehouseJobs.status, "running")),
    db.select({ count: count() }).from(lakehouseJobs).where(eq(lakehouseJobs.status, "completed")),
    db.select({ count: count() }).from(lakehouseJobs).where(eq(lakehouseJobs.status, "failed")),
    db.select({ count: count() }).from(lakehouseJobs).where(eq(lakehouseJobs.status, "pending")),
  ]);
  return {
    running: running[0]?.count ?? 0,
    completed: completed[0]?.count ?? 0,
    failed: failed[0]?.count ?? 0,
    pending: pending[0]?.count ?? 0,
  };
}

// ─── GeoIP Cache helpers (v82) ────────────────────────────────────────────────
export async function getGeoIp(ip: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(geoipCache).where(eq(geoipCache.ip, ip)).limit(1);
  return rows[0] ?? null;
}

export async function upsertGeoIp(data: InsertGeoipCache) {
  const db = await getDb();
  if (!db) return null;
  await db.insert(geoipCache).values(data)
    .onConflictDoUpdate({
      target: geoipCache.ip,
      set: {
        country: data.country,
        countryCode: data.countryCode,
        city: data.city,
        asn: data.asn,
        asnOrg: data.asnOrg,
        updatedAt: new Date(),
      },
    });
  return getGeoIp(data.ip);
}

export async function bulkGetGeoIps(ips: string[]) {
  if (!ips.length) return [];
  const db = await getDb();
  if (!db) return [];
  return db.select().from(geoipCache).where(inArray(geoipCache.ip, ips));
}

// ─── GeoIP Seed Jobs ─────────────────────────────────────────────────────────

export async function createGeoipSeedJob(data: InsertGeoipSeedJob) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(geoipSeedJobs).values(data).returning();
  return result[0];
}

export async function updateGeoipSeedJob(jobId: string, data: Partial<InsertGeoipSeedJob>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.update(geoipSeedJobs)
    .set(data)
    .where(eq(geoipSeedJobs.jobId, jobId))
    .returning();
  return result[0];
}

export async function getGeoipSeedJobs(limit = 20, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(geoipSeedJobs)
    .orderBy(desc(geoipSeedJobs.createdAt))
    .limit(limit).offset(offset);
}

export async function getGeoipSeedJobById(jobId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(geoipSeedJobs)
    .where(eq(geoipSeedJobs.jobId, jobId)).limit(1);
  return result[0] ?? undefined;
}

export async function getGeoipSeedStats() {
  const db = await getDb();
  if (!db) return { total: 0, completed: 0, failed: 0, pending: 0, totalRowsInserted: 0 };
  const [total, completed, failed, pending] = await Promise.all([
    db.select({ count: count() }).from(geoipSeedJobs),
    db.select({ count: count() }).from(geoipSeedJobs).where(eq(geoipSeedJobs.status, "completed")),
    db.select({ count: count() }).from(geoipSeedJobs).where(eq(geoipSeedJobs.status, "failed")),
    db.select({ count: count() }).from(geoipSeedJobs).where(eq(geoipSeedJobs.status, "pending")),
  ]);
  const rowsResult = await db.select({ sum: sql<number>`coalesce(sum(rows_inserted), 0)` }).from(geoipSeedJobs);
  return {
    total: total[0]?.count ?? 0,
    completed: completed[0]?.count ?? 0,
    failed: failed[0]?.count ?? 0,
    pending: pending[0]?.count ?? 0,
    totalRowsInserted: Number(rowsResult[0]?.sum ?? 0),
  };
}

// ─── Workflow Input Schemas ───────────────────────────────────────────────────

export async function getWorkflowInputSchema(workflowType: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(workflowInputSchemas)
    .where(and(eq(workflowInputSchemas.workflowType, workflowType), eq(workflowInputSchemas.isActive, true)))
    .orderBy(desc(workflowInputSchemas.version))
    .limit(1);
  return result[0] ?? undefined;
}

export async function upsertWorkflowInputSchema(data: InsertWorkflowInputSchema) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(workflowInputSchemas).values(data)
    .onConflictDoUpdate({
      target: [workflowInputSchemas.workflowType, workflowInputSchemas.version],
      set: {
        jsonSchema: data.jsonSchema,
        description: data.description,
        isActive: data.isActive,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result[0];
}

export async function listWorkflowInputSchemas() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(workflowInputSchemas)
    .where(eq(workflowInputSchemas.isActive, true))
    .orderBy(workflowInputSchemas.workflowType, desc(workflowInputSchemas.version));
}

// ─── v87: Schema Version History ─────────────────────────────────────────────
export async function getSchemaVersionHistory(workflowType: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(workflowInputSchemas)
    .where(eq(workflowInputSchemas.workflowType, workflowType))
    .orderBy(desc(workflowInputSchemas.version));
}

// ─── v88: Fluvio Topic Offsets ────────────────────────────────────────────────
export async function getFluvioTopicOffsets(opts?: { topic?: string; consumerGroup?: string }) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (opts?.topic) conditions.push(eq(fluvioTopicOffsets.topic, opts.topic));
  if (opts?.consumerGroup) conditions.push(eq(fluvioTopicOffsets.consumerGroup, opts.consumerGroup));
  return db.select().from(fluvioTopicOffsets)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(fluvioTopicOffsets.lagCount));
}

export async function upsertFluvioOffset(data: {
  topic: string; partition: number; consumerGroup: string;
  committedOffset: number; latestOffset: number; lagCount: number; isHealthy: boolean;
}) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(fluvioTopicOffsets).values({
    ...data,
    lastUpdatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [fluvioTopicOffsets.topic, fluvioTopicOffsets.partition, fluvioTopicOffsets.consumerGroup],
    set: {
      committedOffset: data.committedOffset,
      latestOffset: data.latestOffset,
      lagCount: data.lagCount,
      isHealthy: data.isHealthy,
      lastUpdatedAt: new Date(),
    },
  }).returning();
  return row;
}

// ─── v89: APISIX Route Audit ──────────────────────────────────────────────────
export async function getApisixRouteAuditLog(opts?: { routeId?: string; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (opts?.routeId) conditions.push(eq(apisixRouteAudit.routeId, opts.routeId));
  return db.select().from(apisixRouteAudit)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(apisixRouteAudit.createdAt))
    .limit(opts?.limit ?? 100);
}

export async function insertApisixRouteAuditEntry(data: {
  routeId: string; routeName?: string; operation: string; actorId?: number;
  previousConfig?: object; newConfig?: object; changeReason?: string; apisixVersion?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(apisixRouteAudit).values(data).returning();
  return row;
}

// ─── v90: Keycloak Sessions ───────────────────────────────────────────────────
export async function getKeycloakSessions(opts?: { userId?: number; isActive?: boolean; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (opts?.userId !== undefined) conditions.push(eq(keycloakSessions.userId, opts.userId));
  if (opts?.isActive !== undefined) conditions.push(eq(keycloakSessions.isActive, opts.isActive));
  return db.select().from(keycloakSessions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(keycloakSessions.lastAccessAt))
    .limit(opts?.limit ?? 200);
}

export async function revokeKeycloakSession(sessionId: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.update(keycloakSessions)
    .set({ isActive: false })
    .where(eq(keycloakSessions.sessionId, sessionId))
    .returning();
  return row;
}

// ─── v91: Permify Audit Log ───────────────────────────────────────────────────
export async function getPermifyAuditLog(opts?: { operation?: string; entity?: string; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (opts?.operation) conditions.push(eq(permifyAuditLog.operation, opts.operation));
  if (opts?.entity) conditions.push(like(permifyAuditLog.entity, `%${opts.entity}%`));
  return db.select().from(permifyAuditLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(permifyAuditLog.createdAt))
    .limit(opts?.limit ?? 200);
}

// ─── Tenant Domain Polling helpers ───────────────────────────────────────────
export async function getTenantsWithPendingDomain() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tenants)
    .where(
      and(
        sql`${tenants.customDomain} IS NOT NULL`,
        eq(tenants.domainVerified, false),
        sql`${tenants.domainVerificationToken} IS NOT NULL`
      )
    );
}

export async function markTenantDomainVerified(tenantId: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.update(tenants)
    .set({ domainVerified: true, domainVerifiedAt: new Date() })
    .where(eq(tenants.id, tenantId))
    .returning();
  return row;
}

export async function incrementTenantDomainFailCount(tenantId: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.update(tenants)
    .set({
      domainVerificationFailCount: sql`${tenants.domainVerificationFailCount} + 1`,
      domainLastFailedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId))
    .returning();
  return row;
}

export async function resetTenantDomainFailCount(tenantId: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.update(tenants)
    .set({ domainVerificationFailCount: 0, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId))
    .returning();
  return row;
}

// ─── Domain Verification Event helpers (Sprint v6) ───────────────────────────

/**
 * logDomainVerificationEvent — records a single DNS verification attempt.
 * Called by the tenant domain poller on every check (success, failure, or error).
 */
export async function logDomainVerificationEvent(
  tenantId: string,
  domain: string,
  outcome: "success" | "failure" | "error",
  errorCode?: string,
  detail?: string,
) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(domainVerificationEvents).values({
    tenantId,
    domain,
    outcome,
    errorCode: errorCode ?? null,
    detail: detail ?? null,
    createdAt: new Date(),
  }).returning();
  return row;
}

/**
 * getDomainVerificationHistory — returns the last N events for a given tenant.
 * Ordered newest-first.
 */
export async function getDomainVerificationHistory(tenantId: string, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(domainVerificationEvents)
    .where(eq(domainVerificationEvents.tenantId, tenantId))
    .orderBy(desc(domainVerificationEvents.createdAt))
    .limit(limit);
}

/**
 * getDomainHealthSummary — aggregates the last 30 events per tenant into
 * a health summary: total checks, successes, failures, last outcome, last checked.
 */
export async function getDomainHealthSummary(tenantId: string) {
  const db = await getDb();
  if (!db) return null;
  const events = await db
    .select()
    .from(domainVerificationEvents)
    .where(eq(domainVerificationEvents.tenantId, tenantId))
    .orderBy(desc(domainVerificationEvents.createdAt))
    .limit(30);

  if (events.length === 0) return null;

  const total = events.length;
  const successes = events.filter(e => e.outcome === "success").length;
  const failures = events.filter(e => e.outcome === "failure").length;
  const errors = events.filter(e => e.outcome === "error").length;
  const lastEvent = events[0];

  return {
    total,
    successes,
    failures,
    errors,
    successRate: total > 0 ? Math.round((successes / total) * 100) : 0,
    lastOutcome: lastEvent.outcome,
    lastCheckedAt: lastEvent.createdAt,
    lastErrorCode: lastEvent.errorCode,
  };
}
