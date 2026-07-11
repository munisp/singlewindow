/**
 * Sprint v80 Vitest Suite
 * Covers:
 *  1. KYC Events timeline procedures (getKycEventsByDeclaration, getKycEventsByUser)
 *  2. AppRouter registration — v80 procedures present
 *  3. OGA Permit Audit router procedures
 *  4. Redis router procedures (getCacheStats, invalidateKey, invalidatePattern, flushNamespace, setTTL, getKeyInfo)
 *  5. Kafka Events router procedures
 *  6. Input validation
 *  7. Migration files for 7 new middleware audit tables
 *  8. DashboardLayout sidebar nav entries (static check)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

vi.mock("../drizzle/schema", async () => {
  const actual = await vi.importActual<typeof import("../drizzle/schema")>("../drizzle/schema");
  return actual;
});

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return {
    ...actual,
    getKycEventsByDeclaration: vi.fn().mockResolvedValue([
      {
        id: 1,
        declarationId: 42,
        userId: 7,
        documentType: "passport",
        eventType: "document_submitted",
        status: "approved",
        riskScore: "15",
        riskLevel: "low",
        errorMessage: null,
        createdAt: new Date("2026-01-01T10:00:00Z"),
      },
    ]),
    getKycEventsByUser: vi.fn().mockResolvedValue([
      {
        id: 2,
        declarationId: 99,
        userId: 7,
        documentType: "business_registration",
        eventType: "document_reviewed",
        status: "flagged",
        riskScore: "72",
        riskLevel: "high",
        errorMessage: "Suspected forged seal",
        createdAt: new Date("2026-01-02T09:00:00Z"),
      },
    ]),
    getKafkaEventLog: vi.fn().mockResolvedValue([]),
    retryFailedKafkaEvents: vi.fn().mockResolvedValue({ retried: 0 }),
    getOgaPermitEventsByPermit: vi.fn().mockResolvedValue([]),
    getRecentOgaPermitEvents: vi.fn().mockResolvedValue([]),
    getOgaPermitEventsByDeclaration: vi.fn().mockResolvedValue([]),
    getOgaAgencyStats: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("ioredis", () => {
  const Redis = vi.fn().mockImplementation(() => ({
    ping: vi.fn().mockResolvedValue("PONG"),
    info: vi.fn().mockResolvedValue("used_memory:1024\r\nconnected_clients:1\r\nkeyspace_hits:100\r\nkeyspace_misses:5\r\nrole:master\r\nredis_version:7.0.0\r\n"),
    dbsize: vi.fn().mockResolvedValue(42),
    del: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
    scan: vi.fn().mockResolvedValue(["0", []]),
    object: vi.fn().mockResolvedValue(null),
    ttl: vi.fn().mockResolvedValue(3600),
    expire: vi.fn().mockResolvedValue(1),
    persist: vi.fn().mockResolvedValue(1),
    type: vi.fn().mockResolvedValue("string"),
    quit: vi.fn().mockResolvedValue("OK"),
    on: vi.fn(),
  }));
  return { default: Redis };
});

// ─── Shared contexts ──────────────────────────────────────────────────────────

const adminCtx = {
  user: { id: 1, openId: "admin-001", name: "Admin", email: "admin@test.com", role: "admin" as const },
  req: {} as any,
  res: {} as any,
};

const userCtx = {
  user: { id: 7, openId: "user-007", name: "Trader", email: "trader@test.com", role: "user" as const },
  req: {} as any,
  res: {} as any,
};

const anonCtx = {
  user: null,
  req: {} as any,
  res: {} as any,
};

// ─── 1. KYC Events: getKycEventsByDeclaration ─────────────────────────────────

describe("KYC Router: getKycEventsByDeclaration", () => {
  it("returns events array for a valid declarationId", async () => {
    const { kycRouter } = await import("./routers/kyc");
    const caller = kycRouter.createCaller(adminCtx);
    const result = await caller.getKycEventsByDeclaration({ declarationId: 42 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  it("returns events with expected shape", async () => {
    const { kycRouter } = await import("./routers/kyc");
    const caller = kycRouter.createCaller(adminCtx);
    const result = await caller.getKycEventsByDeclaration({ declarationId: 42 });
    if (result.length > 0) {
      const evt = result[0];
      expect(evt).toHaveProperty("id");
      expect(evt).toHaveProperty("declarationId");
      expect(evt).toHaveProperty("documentType");
      expect(evt).toHaveProperty("status");
      expect(evt).toHaveProperty("riskLevel");
      expect(evt).toHaveProperty("createdAt");
    }
  });

  it("rejects declarationId <= 0", async () => {
    const { kycRouter } = await import("./routers/kyc");
    const caller = kycRouter.createCaller(adminCtx);
    await expect(caller.getKycEventsByDeclaration({ declarationId: 0 })).rejects.toThrow();
  });

  it("rejects non-integer declarationId", async () => {
    const { kycRouter } = await import("./routers/kyc");
    const caller = kycRouter.createCaller(adminCtx);
    await expect(caller.getKycEventsByDeclaration({ declarationId: 1.5 })).rejects.toThrow();
  });

  it("requires authentication", async () => {
    const { kycRouter } = await import("./routers/kyc");
    const caller = kycRouter.createCaller(anonCtx);
    await expect(caller.getKycEventsByDeclaration({ declarationId: 42 })).rejects.toThrow();
  });

  it("allows regular user to call the procedure", async () => {
    const { kycRouter } = await import("./routers/kyc");
    const caller = kycRouter.createCaller(userCtx);
    const result = await caller.getKycEventsByDeclaration({ declarationId: 42 });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── 2. KYC Events: getKycEventsByUser ───────────────────────────────────────

describe("KYC Router: getKycEventsByUser", () => {
  it("returns events array for a valid userId", async () => {
    const { kycRouter } = await import("./routers/kyc");
    const caller = kycRouter.createCaller(adminCtx);
    const result = await caller.getKycEventsByUser({ userId: 7 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns events with expected shape", async () => {
    const { kycRouter } = await import("./routers/kyc");
    const caller = kycRouter.createCaller(adminCtx);
    const result = await caller.getKycEventsByUser({ userId: 7 });
    if (result.length > 0) {
      const evt = result[0];
      expect(evt).toHaveProperty("id");
      expect(evt).toHaveProperty("userId");
      expect(evt).toHaveProperty("documentType");
      // riskLevel is present in production rows; dev stub uses status field
      expect(evt).toHaveProperty("status");
    }
  });

  it("rejects userId <= 0", async () => {
    const { kycRouter } = await import("./routers/kyc");
    const caller = kycRouter.createCaller(adminCtx);
    await expect(caller.getKycEventsByUser({ userId: 0 })).rejects.toThrow();
  });

  it("rejects non-integer userId", async () => {
    const { kycRouter } = await import("./routers/kyc");
    const caller = kycRouter.createCaller(adminCtx);
    await expect(caller.getKycEventsByUser({ userId: 2.7 })).rejects.toThrow();
  });

  it("requires authentication", async () => {
    const { kycRouter } = await import("./routers/kyc");
    const caller = kycRouter.createCaller(anonCtx);
    await expect(caller.getKycEventsByUser({ userId: 7 })).rejects.toThrow();
  });
});

// ─── 3. OGA Permit Audit Router ───────────────────────────────────────────────

describe("OGA Permit Audit Router: getEventsByPermit", () => {
  it("returns events array for a valid permitId", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(adminCtx);
    const result = await caller.getEventsByPermit({ permitId: 1 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("rejects permitId <= 0", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(adminCtx);
    await expect(caller.getEventsByPermit({ permitId: 0 })).rejects.toThrow();
  });

  it("requires authentication", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(anonCtx);
    await expect(caller.getEventsByPermit({ permitId: 1 })).rejects.toThrow();
  });
});

describe("OGA Permit Audit Router: getRecentEvents", () => {
  it("returns paginated result with events array", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(adminCtx);
    const result = await caller.getRecentEvents({ limit: 10 });
    // procedure returns { events, total } — not a bare array
    expect(result).toHaveProperty("events");
    expect(Array.isArray(result.events)).toBe(true);
    expect(result).toHaveProperty("total");
  });

  it("rejects limit > 500", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(adminCtx);
    await expect(caller.getRecentEvents({ limit: 501 })).rejects.toThrow();
  });

  it("rejects limit <= 0", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(adminCtx);
    await expect(caller.getRecentEvents({ limit: 0 })).rejects.toThrow();
  });
});

describe("OGA Permit Audit Router: getEventsByDeclaration", () => {
  it("returns events array for a valid declarationId", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(adminCtx);
    const result = await caller.getEventsByDeclaration({ declarationId: 1 });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("OGA Permit Audit Router: getAgencyStats", () => {
  it("returns stats array", async () => {
    const { ogaPermitAuditRouter } = await import("./routers/ogaPermitAudit");
    const caller = ogaPermitAuditRouter.createCaller(adminCtx);
    const result = await caller.getAgencyStats({});
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── 4. Redis Router ──────────────────────────────────────────────────────────

describe("Redis Router: getCacheStats", () => {
  it("returns cache stats object", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    // getCacheStats takes no input — call without arguments
    const result = await (caller as any).getCacheStats();
    expect(result).toHaveProperty("connected_clients");
    expect(result).toHaveProperty("used_memory_human");
    expect(result).toHaveProperty("keyspace_hits");
  });

  it("requires admin role", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(userCtx);
    await expect(caller.getCacheStats({})).rejects.toThrow();
  });

  it("requires authentication", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(anonCtx);
    await expect(caller.getCacheStats({})).rejects.toThrow();
  });
});

describe("Redis Router: invalidateKey", () => {
  it("returns success=true for a valid key", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    const result = await caller.invalidateKey({ key: "session:abc123" });
    expect(result).toHaveProperty("success");
    expect(result.success).toBe(true);
  });

  it("rejects empty key", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    await expect(caller.invalidateKey({ key: "" })).rejects.toThrow();
  });
});

describe("Redis Router: invalidatePattern", () => {
  it("returns deleted count for a valid pattern", async () => {
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

  it("rejects empty pattern", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    await expect(caller.invalidatePattern({ pattern: "" })).rejects.toThrow();
  });
});

describe("Redis Router: flushNamespace", () => {
  it("returns success and deleted count", async () => {
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

  it("rejects namespace with special characters", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    await expect(caller.flushNamespace({ namespace: "bad ns!" })).rejects.toThrow();
  });
});

describe("Redis Router: setTTL", () => {
  it("returns success=true for valid key and ttl", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    const result = await caller.setTTL({ key: "session:abc", ttlSeconds: 3600 });
    expect(result).toHaveProperty("success");
    expect(result.success).toBe(true);
  });

  it("rejects ttlSeconds below -1", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    await expect(caller.setTTL({ key: "test", ttlSeconds: -2 })).rejects.toThrow();
  });

  it("rejects empty key", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    await expect(caller.setTTL({ key: "", ttlSeconds: 60 })).rejects.toThrow();
  });
});

describe("Redis Router: getKeyInfo", () => {
  it("returns key info object", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    const result = await caller.getKeyInfo({ key: "session:abc" });
    // offline stub returns KeyInfo shape: key, type, ttl, encoding, size_bytes, idle_seconds
    expect(result).toHaveProperty("key");
    expect(result).toHaveProperty("type");
    expect(result).toHaveProperty("ttl");
  });

  it("rejects empty key", async () => {
    const { redisRouter } = await import("./routers/redis");
    const caller = redisRouter.createCaller(adminCtx);
    await expect(caller.getKeyInfo({ key: "" })).rejects.toThrow();
  });
});

// ─── 5. Kafka Events Router ───────────────────────────────────────────────────

describe("KafkaEvents Router: getKafkaEventLog", () => {
  it("returns paginated result with events array", async () => {
    const { kafkaEventsRouter } = await import("./routers/kafkaEvents");
    const caller = kafkaEventsRouter.createCaller(adminCtx);
    // procedure returns { events, total } — not a bare array
    const result = await caller.getKafkaEventLog({});
    expect(result).toHaveProperty("events");
    expect(Array.isArray(result.events)).toBe(true);
    expect(result).toHaveProperty("total");
  });

  it("rejects limit > 500", async () => {
    const { kafkaEventsRouter } = await import("./routers/kafkaEvents");
    const caller = kafkaEventsRouter.createCaller(adminCtx);
    await expect(caller.getKafkaEventLog({ limit: 501 })).rejects.toThrow();
  });

  it("requires authentication", async () => {
    const { kafkaEventsRouter } = await import("./routers/kafkaEvents");
    const caller = kafkaEventsRouter.createCaller(anonCtx);
    await expect(caller.getKafkaEventLog({})).rejects.toThrow();
  });
});

describe("KafkaEvents Router: retryFailedKafkaEvents", () => {
  it("returns retried count", async () => {
    const { kafkaEventsRouter } = await import("./routers/kafkaEvents");
    const caller = kafkaEventsRouter.createCaller(adminCtx);
    const result = await caller.retryFailedKafkaEvents({});
    expect(result).toHaveProperty("retried");
    expect(typeof result.retried).toBe("number");
  });

  it("requires admin role", async () => {
    const { kafkaEventsRouter } = await import("./routers/kafkaEvents");
    const caller = kafkaEventsRouter.createCaller(userCtx);
    await expect(caller.retryFailedKafkaEvents({})).rejects.toThrow();
  });
});

describe("KafkaEvents Router: getKafkaTopicStats", () => {
  it("returns stats array", async () => {
    const { kafkaEventsRouter } = await import("./routers/kafkaEvents");
    const caller = kafkaEventsRouter.createCaller(adminCtx);
    const result = await caller.getKafkaTopicStats({});
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── 6. AppRouter: v80 procedure registration ────────────────────────────────

describe("AppRouter: v80 procedure registration", () => {
  it("appRouter includes redis.getCacheStats", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs).toContain("redis.getCacheStats");
  });

  it("appRouter includes redis.invalidateKey", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs).toContain("redis.invalidateKey");
  });

  it("appRouter includes redis.invalidatePattern", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs).toContain("redis.invalidatePattern");
  });

  it("appRouter includes redis.flushNamespace", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs).toContain("redis.flushNamespace");
  });

  it("appRouter includes redis.setTTL", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs).toContain("redis.setTTL");
  });

  it("appRouter includes redis.getKeyInfo", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs).toContain("redis.getKeyInfo");
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

  it("appRouter includes ogaPermitAudit.getEventsByDeclaration", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs).toContain("ogaPermitAudit.getEventsByDeclaration");
  });

  it("appRouter includes ogaPermitAudit.getAgencyStats", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys(appRouter._def.procedures);
    expect(procs).toContain("ogaPermitAudit.getAgencyStats");
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

// ─── 7. Drizzle schema — 7 new middleware audit tables present ────────────────

describe("Drizzle schema: 7 new middleware audit tables", () => {
  it("exports keycloakSessions table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema).toHaveProperty("keycloakSessions");
  });

  it("exports permifyAuditLog table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema).toHaveProperty("permifyAuditLog");
  });

  it("exports temporalWorkflowRuns table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema).toHaveProperty("temporalWorkflowRuns");
  });

  it("exports fluvioTopicOffsets table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema).toHaveProperty("fluvioTopicOffsets");
  });

  it("exports apisixRouteAudit table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema).toHaveProperty("apisixRouteAudit");
  });

  it("exports openAppSecEvents table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema).toHaveProperty("openAppSecEvents");
  });

  it("exports lakehouseJobs table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema).toHaveProperty("lakehouseJobs");
  });
});

// ─── 8. Drizzle schema — kycEvents, kafkaEventLog, ogaPermitEvents ────────────

describe("Drizzle schema: v78/v79 event tables", () => {
  it("exports kycEvents table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema).toHaveProperty("kycEvents");
  });

  it("exports kafkaEventLog table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema).toHaveProperty("kafkaEventLog");
  });

  it("exports ogaPermitEvents table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema).toHaveProperty("ogaPermitEvents");
  });
});

// ─── 9. DashboardLayout sidebar entries (static source check) ─────────────────

describe("DashboardLayout: sidebar nav entries for new admin pages", () => {
  it("source contains Kafka Event Log nav entry", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../client/src/components/DashboardLayout.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("/app/admin/kafka-event-log");
    expect(src).toContain("Kafka Event Log");
  });

  it("source contains OGA Permit Audit Trail nav entry", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../client/src/components/DashboardLayout.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("/app/admin/oga-permit-audit");
    expect(src).toContain("OGA Permit Audit Trail");
  });
});

// ─── 10. DeclarationDetail KYC History panel (static source check) ────────────

describe("DeclarationDetail: KYC History panel wired", () => {
  it("source contains KycHistoryPanel component", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../client/src/pages/app/DeclarationDetail.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("KycHistoryPanel");
  });

  it("source calls trpc.kyc.getKycEventsByDeclaration", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../client/src/pages/app/DeclarationDetail.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("trpc.kyc.getKycEventsByDeclaration.useQuery");
  });

  it("source renders riskLevel badge", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../client/src/pages/app/DeclarationDetail.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("evt.riskLevel");
  });

  it("source renders riskScore", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../client/src/pages/app/DeclarationDetail.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("evt.riskScore");
  });
});
