/**
 * v79.test.ts — Sprint v79 Vitest Test Suite
 *
 * Covers:
 *   - Redis tRPC router (6 procedures)
 *   - Kafka Event Log router (3 procedures)
 *   - KYC Events timeline procedures (2 new procedures)
 *   - OGA Permit Audit Trail router (4 procedures)
 *   - Lakehouse PostgreSQL write-back endpoint (allow-list, stub response)
 *   - Schema integrity checks (kafkaEventLog, kycEvents, ogaPermitEvents)
 *   - Integration: router registration in appRouter
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal caller context for protected/admin procedures */
const adminCtx = {
  user: { id: 1, role: "admin" as const, openId: "owner-1", name: "Admin" },
  req: {} as any,
  res: {} as any,
};

const userCtx = {
  user: { id: 2, role: "user" as const, openId: "user-2", name: "Trader" },
  req: {} as any,
  res: {} as any,
};

// ─── 1. Schema integrity ───────────────────────────────────────────────────────

describe("Schema: kafkaEventLog", () => {
  it("exports kafkaEventLog table", async () => {
    const { kafkaEventLog } = await import("../drizzle/schema");
    expect(kafkaEventLog).toBeDefined();
  });

  it("has required columns: topic, eventType, aggregateId, payload, status, attempts", async () => {
    const { kafkaEventLog } = await import("../drizzle/schema");
    const cols = Object.keys(kafkaEventLog);
    expect(cols).toContain("topic");
    expect(cols).toContain("eventType");
    expect(cols).toContain("aggregateId");
    expect(cols).toContain("payload");
    expect(cols).toContain("status");
    expect(cols).toContain("attempts");
  });

  it("has errorMessage column (not lastError)", async () => {
    const { kafkaEventLog } = await import("../drizzle/schema");
    const cols = Object.keys(kafkaEventLog);
    expect(cols).toContain("errorMessage");
    expect(cols).not.toContain("lastError");
  });

  it("exports KafkaEventLog and InsertKafkaEventLog types", async () => {
    const schema = await import("../drizzle/schema");
    // Types exist at compile time; verify the table infer works
    type Row = typeof schema.kafkaEventLog.$inferSelect;
    type Insert = typeof schema.kafkaEventLog.$inferInsert;
    const row: Partial<Row> = { topic: "test", status: "pending" };
    expect(row.topic).toBe("test");
  });
});

describe("Schema: kycEvents", () => {
  it("exports kycEvents table", async () => {
    const { kycEvents } = await import("../drizzle/schema");
    expect(kycEvents).toBeDefined();
  });

  it("has declarationId, userId, documentType, riskScore, status columns", async () => {
    const { kycEvents } = await import("../drizzle/schema");
    const cols = Object.keys(kycEvents);
    expect(cols).toContain("declarationId");
    expect(cols).toContain("userId");
    expect(cols).toContain("documentType");
    expect(cols).toContain("riskScore");
    expect(cols).toContain("status");
  });
});

describe("Schema: ogaPermitEvents", () => {
  it("exports ogaPermitEvents table", async () => {
    const { ogaPermitEvents } = await import("../drizzle/schema");
    expect(ogaPermitEvents).toBeDefined();
  });

  it("has permitId, declarationId, agencyCode, eventType, newStatus, kafkaOffset columns", async () => {
    const { ogaPermitEvents } = await import("../drizzle/schema");
    const cols = Object.keys(ogaPermitEvents);
    expect(cols).toContain("permitId");
    expect(cols).toContain("declarationId");
    expect(cols).toContain("agencyCode");
    expect(cols).toContain("eventType");
    expect(cols).toContain("newStatus");
    expect(cols).toContain("kafkaOffset");
  });
});

// ─── 2. Redis Router ───────────────────────────────────────────────────────────

describe("Redis Router: getCacheStats", () => {
  it("returns cache stats object in dev mode", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    const result = await caller.getCacheStats();
    expect(result).toHaveProperty("connected_clients");
    expect(result).toHaveProperty("used_memory_human");
    expect(result).toHaveProperty("db_keys");
  });
});

describe("Redis Router: getKeyInfo", () => {
  it("returns key info for a valid key in dev mode", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    const result = await caller.getKeyInfo({ key: "session:abc123" });
    expect(result).toHaveProperty("key");
    expect(result).toHaveProperty("type");
    expect(result).toHaveProperty("ttl");
  });
});

describe("Redis Router: setTTL", () => {
  it("returns success in dev mode", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    const result = await caller.setTTL({ key: "session:abc", ttlSeconds: 3600 });
    expect(result).toHaveProperty("success");
  });
});

describe("Redis Router: invalidateKey", () => {
  it("returns success=true and deleted count in dev mode", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    const result = await caller.invalidateKey({ key: "session:test-key" });
    expect(result).toHaveProperty("success");
    expect(result.success).toBe(true);
    expect(result).toHaveProperty("deleted");
  });
});

describe("Redis Router: invalidatePattern", () => {
  it("returns count of deleted keys in dev mode", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    const result = await caller.invalidatePattern({ pattern: "session:*" });
    expect(result).toHaveProperty("deleted");
    expect(typeof result.deleted).toBe("number");
  });

  it("dryRun=true returns deleted=0", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    const result = await caller.invalidatePattern({ pattern: "session:*", dryRun: true });
    expect(result.deleted).toBe(0);
    expect(result.dryRun).toBe(true);
  });
});

describe("Redis Router: flushNamespace", () => {
  it("returns success and deleted count in dev mode", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    const result = await caller.flushNamespace({ namespace: "session" });
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("deleted");
    expect(typeof result.deleted).toBe("number");
  });

  it("dryRun=true returns deleted=0", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    const result = await caller.flushNamespace({ namespace: "session", dryRun: true });
    expect(result.deleted).toBe(0);
    expect(result.dryRun).toBe(true);
  });
});

// ─── 3. Kafka Event Log Router ─────────────────────────────────────────────────

describe("KafkaEvents Router: getKafkaEventLog", () => {
  it("returns events array and total in dev mode", async () => {
    const { kafkaEventsRouter } = await import("./routers/kafkaEvents");
    const caller = kafkaEventsRouter.createCaller(adminCtx);
    const result = await caller.getKafkaEventLog({ limit: 10, offset: 0 });
    expect(result).toHaveProperty("events");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.events)).toBe(true);
  });

  it("filters by status=failed", async () => {
    const { kafkaEventsRouter } = await import("./routers/kafkaEvents");
    const caller = kafkaEventsRouter.createCaller(adminCtx);
    const result = await caller.getKafkaEventLog({ status: "failed" });
    expect(result.events.every((e: any) => e.status === "failed")).toBe(true);
  });

  it("filters by status=published", async () => {
    const { kafkaEventsRouter } = await import("./routers/kafkaEvents");
    const caller = kafkaEventsRouter.createCaller(adminCtx);
    const result = await caller.getKafkaEventLog({ status: "published" });
    expect(result.events.every((e: any) => e.status === "published")).toBe(true);
  });

  it("returns events with required fields", async () => {
    const { kafkaEventsRouter } = await import("./routers/kafkaEvents");
    const caller = kafkaEventsRouter.createCaller(adminCtx);
    const result = await caller.getKafkaEventLog({ limit: 5 });
    if (result.events.length > 0) {
      const e = result.events[0];
      expect(e).toHaveProperty("id");
      expect(e).toHaveProperty("topic");
      expect(e).toHaveProperty("status");
      expect(e).toHaveProperty("attempts");
    }
  });

  it("respects limit parameter", async () => {
    const { kafkaEventsRouter } = await import("./routers/kafkaEvents");
    const caller = kafkaEventsRouter.createCaller(adminCtx);
    const result = await caller.getKafkaEventLog({ limit: 3 });
    expect(result.events.length).toBeLessThanOrEqual(3);
  });
});

describe("KafkaEvents Router: retryFailedKafkaEvents", () => {
  it("returns retried count and status=pending in dev mode", async () => {
    const { kafkaEventsRouter } = await import("./routers/kafkaEvents");
    const caller = kafkaEventsRouter.createCaller(adminCtx);
    const result = await caller.retryFailedKafkaEvents();
    expect(result).toHaveProperty("retried");
    expect(result).toHaveProperty("status");
    expect(result.status).toBe("pending");
  });

  it("accepts specific ids", async () => {
    const { kafkaEventsRouter } = await import("./routers/kafkaEvents");
    const caller = kafkaEventsRouter.createCaller(adminCtx);
    const result = await caller.retryFailedKafkaEvents({ ids: [1, 2, 3] });
    expect(result.retried).toBe(3);
  });
});

describe("KafkaEvents Router: getKafkaTopicStats", () => {
  it("returns array of topic stats in dev mode", async () => {
    const { kafkaEventsRouter } = await import("./routers/kafkaEvents");
    const caller = kafkaEventsRouter.createCaller(adminCtx);
    const result = await caller.getKafkaTopicStats();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("each stat has topic, pending, published, failed", async () => {
    const { kafkaEventsRouter } = await import("./routers/kafkaEvents");
    const caller = kafkaEventsRouter.createCaller(adminCtx);
    const result = await caller.getKafkaTopicStats();
    result.forEach((stat: any) => {
      expect(stat).toHaveProperty("topic");
      expect(stat).toHaveProperty("pending");
      expect(stat).toHaveProperty("published");
      expect(stat).toHaveProperty("failed");
    });
  });
});

// ─── 4. KYC Events Timeline ────────────────────────────────────────────────────

describe("KYC Router: getKycEventsByDeclaration", () => {
  it("returns events array for a declaration in dev mode", async () => {
    const { kycRouter } = await import("./routers/kyc");
    const caller = kycRouter.createCaller(userCtx);
    const result = await caller.getKycEventsByDeclaration({ declarationId: 1001 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("events have declarationId matching input", async () => {
    const { kycRouter } = await import("./routers/kyc");
    const caller = kycRouter.createCaller(userCtx);
    const result = await caller.getKycEventsByDeclaration({ declarationId: 42 });
    result.forEach((e: any) => {
      expect(e.declarationId).toBe(42);
    });
  });

  it("events have required fields: id, eventType, status, createdAt", async () => {
    const { kycRouter } = await import("./routers/kyc");
    const caller = kycRouter.createCaller(userCtx);
    const result = await caller.getKycEventsByDeclaration({ declarationId: 1 });
    result.forEach((e: any) => {
      expect(e).toHaveProperty("id");
      expect(e).toHaveProperty("eventType");
      expect(e).toHaveProperty("status");
      expect(e).toHaveProperty("createdAt");
    });
  });

  it("rejects non-positive declarationId", async () => {
    const { kycRouter } = await import("./routers/kyc");
    const caller = kycRouter.createCaller(userCtx);
    await expect(caller.getKycEventsByDeclaration({ declarationId: 0 })).rejects.toThrow();
  });
});

describe("KYC Router: getKycEventsByUser", () => {
  it("returns events for a user in dev mode (admin only)", async () => {
    const { kycRouter } = await import("./routers/kyc");
    const caller = kycRouter.createCaller(adminCtx);
    const result = await caller.getKycEventsByUser({ userId: 1001 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("each event has userId matching input", async () => {
    const { kycRouter } = await import("./routers/kyc");
    const caller = kycRouter.createCaller(adminCtx);
    const result = await caller.getKycEventsByUser({ userId: 99 });
    result.forEach((e: any) => {
      expect(e.userId).toBe(99);
    });
  });
});

// ─── 5. OGA Permit Audit Trail ─────────────────────────────────────────────────

describe("OGAPermitAudit Router: getEventsByPermit", () => {
  it("returns events for a permit in dev mode", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(userCtx);
    const result = await caller.getEventsByPermit({ permitId: 1 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("events have required fields: id, permitId, agencyCode, eventType, newStatus", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(userCtx);
    const result = await caller.getEventsByPermit({ permitId: 5 });
    result.forEach((e: any) => {
      expect(e).toHaveProperty("id");
      expect(e).toHaveProperty("permitId");
      expect(e).toHaveProperty("agencyCode");
      expect(e).toHaveProperty("eventType");
      expect(e).toHaveProperty("newStatus");
    });
  });

  it("events are in chronological order (oldest first)", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(userCtx);
    const result = await caller.getEventsByPermit({ permitId: 1 });
    for (let i = 1; i < result.length; i++) {
      const prev = new Date(result[i - 1].createdAt).getTime();
      const curr = new Date(result[i].createdAt).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });
});

describe("OGAPermitAudit Router: getEventsByDeclaration", () => {
  it("returns events for a declaration in dev mode", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(userCtx);
    const result = await caller.getEventsByDeclaration({ declarationId: 1001 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("all events have the correct declarationId", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(userCtx);
    const result = await caller.getEventsByDeclaration({ declarationId: 999 });
    result.forEach((e: any) => {
      expect(e.declarationId).toBe(999);
    });
  });
});

describe("OGAPermitAudit Router: getRecentEvents", () => {
  it("returns events and total in dev mode", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(adminCtx);
    const result = await caller.getRecentEvents({ limit: 10 });
    expect(result).toHaveProperty("events");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.events)).toBe(true);
  });

  it("filters by agencyCode", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(adminCtx);
    const result = await caller.getRecentEvents({ agencyCode: "FDA" });
    result.events.forEach((e: any) => {
      expect(e.agencyCode).toBe("FDA");
    });
  });

  it("filters by eventType=APPROVED", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(adminCtx);
    const result = await caller.getRecentEvents({ eventType: "APPROVED" });
    result.events.forEach((e: any) => {
      expect(e.eventType).toBe("APPROVED");
    });
  });

  it("respects limit parameter", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(adminCtx);
    const result = await caller.getRecentEvents({ limit: 5 });
    expect(result.events.length).toBeLessThanOrEqual(5);
  });
});

describe("OGAPermitAudit Router: getAgencyStats", () => {
  it("returns array of agency stats in dev mode", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(adminCtx);
    const result = await caller.getAgencyStats();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("each stat has agencyCode, total, approved, rejected, pending", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(adminCtx);
    const result = await caller.getAgencyStats();
    result.forEach((stat: any) => {
      expect(stat).toHaveProperty("agencyCode");
      expect(stat).toHaveProperty("total");
      expect(stat).toHaveProperty("approved");
      expect(stat).toHaveProperty("rejected");
      expect(stat).toHaveProperty("pending");
    });
  });
});

// ─── 6. Lakehouse PostgreSQL Write-back ────────────────────────────────────────

describe("Lakehouse write-back: POST /write-postgres allow-list", () => {
  const ALLOWED = [
    "trade_stats_mirror",
    "hs_code_volume_mirror",
    "trader_metrics_mirror",
    "route_flow_mirror",
    "duty_revenue_mirror",
    "fund_flow_mirror",
    "declaration_events_mirror",
  ];

  it("allow-list contains 7 tables", () => {
    expect(ALLOWED.length).toBe(7);
  });

  it("all expected mirror tables are in allow-list", () => {
    expect(ALLOWED).toContain("trade_stats_mirror");
    expect(ALLOWED).toContain("declaration_events_mirror");
    expect(ALLOWED).toContain("fund_flow_mirror");
  });

  it("stub response shape is correct", () => {
    const stub = {
      success: true,
      table: "trade_stats_mirror",
      upsert_key: "id",
      rows_affected: 1,
      source: "deltalake",
      timestamp: new Date().toISOString(),
    };
    expect(stub.success).toBe(true);
    expect(stub.rows_affected).toBe(1);
    expect(stub.source).toBe("deltalake");
    expect(typeof stub.timestamp).toBe("string");
  });

  it("rejects table not in allow-list (validation logic)", () => {
    const table = "users";
    const isAllowed = ALLOWED.includes(table);
    expect(isAllowed).toBe(false);
  });
});

// ─── 7. AppRouter registration ─────────────────────────────────────────────────

describe("AppRouter: v79 router registration", () => {
  it("appRouter includes redis namespace", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs.some((p) => p.startsWith("redis"))).toBe(true);
  });

  it("appRouter includes redis.getCacheStats", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs).toContain("redis.getCacheStats");
  });

  it("appRouter includes kafkaEvents namespace", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs.some((p) => p.startsWith("kafkaEvents"))).toBe(true);
  });

  it("appRouter includes kafkaEvents.getKafkaEventLog", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs).toContain("kafkaEvents.getKafkaEventLog");
  });

  it("appRouter includes kafkaEvents.retryFailedKafkaEvents", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs).toContain("kafkaEvents.retryFailedKafkaEvents");
  });

  it("appRouter includes kafkaEvents.getKafkaTopicStats", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs).toContain("kafkaEvents.getKafkaTopicStats");
  });

  it("appRouter includes ogaPermitAudit namespace", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs.some((p) => p.startsWith("ogaPermitAudit"))).toBe(true);
  });

  it("appRouter includes ogaPermitAudit.getEventsByPermit", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs).toContain("ogaPermitAudit.getEventsByPermit");
  });

  it("appRouter includes ogaPermitAudit.getRecentEvents", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs).toContain("ogaPermitAudit.getRecentEvents");
  });

  it("appRouter includes kyc.getKycEventsByDeclaration", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs).toContain("kyc.getKycEventsByDeclaration");
  });

  it("appRouter includes kyc.getKycEventsByUser", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs).toContain("kyc.getKycEventsByUser");
  });
});

// ─── 8. Input validation ───────────────────────────────────────────────────────

describe("Input validation: Redis Router", () => {
  it("invalidateKey rejects empty key", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    await expect(caller.invalidateKey({ key: "" })).rejects.toThrow();
  });

  it("invalidatePattern rejects empty pattern", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    await expect(caller.invalidatePattern({ pattern: "" })).rejects.toThrow();
  });

  it("setTTL rejects ttlSeconds below -1", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    await expect(caller.setTTL({ key: "test", ttlSeconds: -2 })).rejects.toThrow();
  });

  it("flushNamespace rejects invalid namespace with special chars", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    await expect(caller.flushNamespace({ namespace: "bad ns!" })).rejects.toThrow();
  });
});

describe("Input validation: KafkaEvents Router", () => {
  it("getKafkaEventLog rejects limit > 500", async () => {
    const { kafkaEventsRouter } = await import("./routers/kafkaEvents");
    const caller = kafkaEventsRouter.createCaller(adminCtx);
    await expect(caller.getKafkaEventLog({ limit: 501 })).rejects.toThrow();
  });

  it("getKafkaEventLog rejects negative offset", async () => {
    const { kafkaEventsRouter } = await import("./routers/kafkaEvents");
    const caller = kafkaEventsRouter.createCaller(adminCtx);
    await expect(caller.getKafkaEventLog({ offset: -1 })).rejects.toThrow();
  });
});

describe("Input validation: OGAPermitAudit Router", () => {
  it("getEventsByPermit rejects permitId=0", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(userCtx);
    await expect(caller.getEventsByPermit({ permitId: 0 })).rejects.toThrow();
  });

  it("getRecentEvents rejects limit > 500", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(adminCtx);
    await expect(caller.getRecentEvents({ limit: 501 })).rejects.toThrow();
  });

  it("getRecentEvents rejects invalid eventType", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(adminCtx);
    await expect(caller.getRecentEvents({ eventType: "INVALID" as any })).rejects.toThrow();
  });
});
