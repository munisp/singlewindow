import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { appRouter } from "./routers";
import { getDb } from "./db";
import type { TrpcContext } from "./_core/context";
import {
  assertDeclarationFormalitiesSatisfied,
  evaluateDeclarationRegulations,
} from "./routers/regulatory";
import {
  declarations,
  declarationFormalities,
  ogaPermits,
  regulatoryFormalities,
  regulatoryRestrictions,
  stakeholderRegistrations,
  stakeholderMandates,
  tariffQuotaAllocations,
  tariffQuotas,
} from "../drizzle/schema";

const ledgerMocks = vi.hoisted(() => ({
  available: vi.fn(async () => true),
  fetch: vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/ledger/accounts") {
      const body = JSON.parse(String(options?.body)) as { id: string };
      return { id: body.id };
    }
    return { id: `regulatory-transfer-${randomUUID()}` };
  }),
}));

vi.mock("./routers/ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routers/ledger")>();
  return { ...actual, tbBridgeAvailable: ledgerMocks.available, tbFetch: ledgerMocks.fetch };
});

function caller(
  role: "user" | "admin" | "customs_officer" | "finance" = "user",
  userId = 1,
) {
  const context: TrpcContext = {
    user: {
      id: userId,
      openId: `regulatory-behaviour-${userId}`,
      name: "Regulatory Behaviour Test",
      email: "regulatory-behaviour@example.test",
      loginMethod: "test",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { method: "POST", headers: {}, cookies: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn(), cookie: vi.fn() } as unknown as TrpcContext["res"],
  };
  return appRouter.createCaller(context);
}

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Postgres is required for regulatory behaviour tests.");
  return db;
}

const created = {
  declarations: [] as number[],
  formalities: [] as number[],
  restrictions: [] as number[],
  quotas: [] as number[],
  permits: [] as number[],
  registrations: [] as number[],
  mandates: [] as number[],
};

async function declaration(
  hsCode: string,
  createdAt = new Date(),
  options: { traderId?: number; principalId?: number; actingAgentId?: number } = {},
) {
  const db = await database();
  const [row] = await db.insert(declarations).values({
    declarationNumber: `REG-${randomUUID().slice(0, 20)}`,
    ucr: `REG-UCR-${randomUUID()}`,
    traderId: options.traderId ?? 1,
    principalId: options.principalId,
    actingAgentId: options.actingAgentId,
    declarationType: "import",
    hsCode,
    countryOfOrigin: "GH",
    countryOfDestination: "NG",
    numberOfPackages: 5,
    createdAt,
  }).returning();
  created.declarations.push(row.id);
  return row;
}

afterEach(async () => {
  ledgerMocks.available.mockResolvedValue(true);
  ledgerMocks.fetch.mockClear();
  const db = await database();
  if (created.declarations.length) await db.delete(declarationFormalities).where(inArray(declarationFormalities.declarationId, created.declarations));
  if (created.permits.length) await db.delete(ogaPermits).where(inArray(ogaPermits.id, created.permits));
  if (created.quotas.length) await db.delete(tariffQuotaAllocations).where(inArray(tariffQuotaAllocations.quotaId, created.quotas));
  if (created.declarations.length) await db.delete(declarations).where(inArray(declarations.id, created.declarations));
  if (created.formalities.length) await db.delete(regulatoryFormalities).where(inArray(regulatoryFormalities.id, created.formalities));
  if (created.restrictions.length) await db.delete(regulatoryRestrictions).where(inArray(regulatoryRestrictions.id, created.restrictions));
  if (created.quotas.length) await db.delete(tariffQuotas).where(inArray(tariffQuotas.id, created.quotas));
  if (created.registrations.length) await db.delete(stakeholderRegistrations).where(inArray(stakeholderRegistrations.id, created.registrations));
  if (created.mandates.length) await db.delete(stakeholderMandates).where(inArray(stakeholderMandates.id, created.mandates));
  created.mandates.length = 0;
  created.declarations.length = 0;
  created.formalities.length = 0;
  created.restrictions.length = 0;
  created.quotas.length = 0;
  created.permits.length = 0;
  created.registrations.length = 0;
});

describe.sequential("regulatory obligation behaviour", () => {
  it("matches HS prefixes and requires declaration-covering permits", async () => {
    const db = await database();
    const now = new Date();
    const [formality] = await db.insert(regulatoryFormalities).values({
      hsCodePrefix: "1234",
      origin: "GH",
      destination: "NG",
      regime: "import",
      agencyCode: "OGA-1",
      agencyName: "OGA One",
      permitType: "IMPORT",
      requiredQuantity: "5",
      legalInstrument: "Instrument REG-1",
      validFrom: new Date(now.getTime() - 60_000),
      createdBy: 4,
    }).returning();
    created.formalities.push(formality.id);
    const matching = await declaration("123456");
    const miss = await declaration("999999");
    const required = await caller().regulatory.clearanceGraph({
      declarationId: matching.id, hsCode: matching.hsCode!, origin: "GH", destination: "NG", regime: "import", quantity: "5",
    });
    expect(required.obligations).toHaveLength(1);
    expect(required.obligations[0]?.blocking).toBe(true);
    const noMatch = await caller().regulatory.clearanceGraph({
      declarationId: miss.id, hsCode: miss.hsCode!, origin: "GH", destination: "NG", regime: "import", quantity: "5",
    });
    expect(noMatch.obligations).toHaveLength(0);

    const [wrongPermit] = await db.insert(ogaPermits).values({
      declarationId: matching.id,
      agencyCode: "OGA-1",
      agencyName: "OGA One",
      permitType: "IMPORT",
      status: "approved",
      hsCode: "9999",
      origin: "GH",
      destination: "NG",
      consigneeId: 1,
      permittedQuantity: "5",
      validFrom: new Date(now.getTime() - 60_000),
    }).returning();
    created.permits.push(wrongPermit.id);
    const stillBlocked = await caller().regulatory.clearanceGraph({
      declarationId: matching.id, hsCode: matching.hsCode!, origin: "GH", destination: "NG", regime: "import", quantity: "5",
    });
    expect(stillBlocked.obligations[0]?.satisfied).toBe(false);

    const [permit] = await db.insert(ogaPermits).values({
      declarationId: matching.id,
      agencyCode: "OGA-1",
      agencyName: "OGA One",
      permitType: "IMPORT",
      status: "approved",
      hsCode: "1234",
      origin: "GH",
      destination: "NG",
      consigneeId: 1,
      permittedQuantity: "5",
      validFrom: new Date(now.getTime() - 60_000),
    }).returning();
    created.permits.push(permit.id);
    const satisfied = await caller().regulatory.clearanceGraph({
      declarationId: matching.id, hsCode: matching.hsCode!, origin: "GH", destination: "NG", regime: "import", quantity: "5",
    });
    expect(satisfied.obligations[0]?.satisfied).toBe(true);
    expect(satisfied.obligations[0]?.satisfiedByPermitId).toBe(permit.id);
    await evaluateDeclarationRegulations({
      declarationId: matching.id, importerId: 1, hsCode: matching.hsCode!, origin: "GH",
      destination: "NG", regime: "import", quantity: "5", at: now,
    });
    const [consumed] = await db.select({ usedQuantity: ogaPermits.usedQuantity })
      .from(ogaPermits).where(eq(ogaPermits.id, permit.id));
    expect(consumed?.usedQuantity).toBe("5.000");
  });

  it("cites prohibitions, converts restrictions, and evaluates historical rules", async () => {
    const db = await database();
    const now = new Date();
    const oldDate = new Date(now.getTime() - 86_400_000);
    const [oldRule] = await db.insert(regulatoryFormalities).values({
      hsCodePrefix: "5678", agencyCode: "OLD", agencyName: "Old Agency", permitType: "OLD-PERMIT",
      legalInstrument: "Instrument OLD", validFrom: new Date(oldDate.getTime() - 60_000), validUntil: new Date(oldDate.getTime() + 60_000), createdBy: 4,
    }).returning();
    const [newRule] = await db.insert(regulatoryFormalities).values({
      hsCodePrefix: "5678", agencyCode: "NEW", agencyName: "New Agency", permitType: "NEW-PERMIT",
      legalInstrument: "Instrument NEW", validFrom: new Date(now.getTime() - 60_000), createdBy: 4,
    }).returning();
    created.formalities.push(oldRule.id, newRule.id);
    const historical = await caller().regulatory.clearanceGraph({
      hsCode: "567890", origin: "GH", regime: "import", asAt: oldDate,
    });
    expect(historical.obligations).toHaveLength(1);
    expect(historical.obligations[0]?.legalInstrument).toBe("Instrument OLD");

    const [restriction] = await db.insert(regulatoryRestrictions).values({
      hsCodePrefix: "5678", origin: "GH", regime: "import", restrictionType: "restriction",
      description: "Restricted goods", legalInstrument: "Instrument RESTRICT",
      agencyCode: "RESTRICT", agencyName: "Restriction Agency", permitType: "RESTRICT-PERMIT",
      validFrom: new Date(now.getTime() - 60_000), createdBy: 4,
    }).returning();
    created.restrictions.push(restriction.id);
    const restricted = await declaration("567890");
    await evaluateDeclarationRegulations({
      declarationId: restricted.id, importerId: 1, hsCode: restricted.hsCode!, origin: "GH",
      destination: "NG", regime: "import", quantity: "1", at: now,
    });
    const obligations = await db.select().from(declarationFormalities).where(eq(declarationFormalities.declarationId, restricted.id));
    expect(obligations.some((entry) => entry.restrictionId === restriction.id && entry.status === "required")).toBe(true);

    const [prohibition] = await db.insert(regulatoryRestrictions).values({
      hsCodePrefix: "9999", origin: "GH", regime: "import", restrictionType: "prohibition",
      description: "Prohibited goods", legalInstrument: "Instrument PROHIBIT",
      validFrom: new Date(now.getTime() - 60_000), createdBy: 4,
    }).returning();
    created.restrictions.push(prohibition.id);
    await expect(evaluateDeclarationRegulations({
      importerId: 1, hsCode: "999900", origin: "GH", destination: "NG", regime: "import", quantity: "1", at: now,
    })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("Instrument PROHIBIT") });
  });

  it("serializes ledger-backed quota drawdown and fails closed on ledger outage", async () => {
    const db = await database();
    const now = new Date();
    const [quota] = await db.insert(tariffQuotas).values({
      quotaCode: `Q-${randomUUID()}`, hsCodePrefix: "7777", origin: "GH", regime: "import",
      periodStart: new Date(now.getTime() - 60_000), periodEnd: new Date(now.getTime() + 60_000),
      totalQuantity: "10", quantityUnit: "kg", ledgerAccountId: "quota-ledger-test",
      allocatedLedgerAccountId: "quota-allocated-test",
      legalInstrument: "Instrument QUOTA", validFrom: new Date(now.getTime() - 60_000), createdBy: 4,
    }).returning();
    created.quotas.push(quota.id);
    const first = await declaration("777700");
    const second = await declaration("777701");
    const agentDeclaration = await declaration("777702", new Date(), { actingAgentId: 2 });
    const [mandate] = await db.insert(stakeholderMandates).values({
      referenceNumber: `REG-MANDATE-${randomUUID().slice(0, 12)}`,
      principalUserId: 1,
      agentUserId: 2,
      validFrom: new Date(now.getTime() - 60_000),
      validUntil: new Date(now.getTime() + 60_000),
    }).returning();
    created.mandates.push(mandate.id);
    const [registration] = await db.insert(stakeholderRegistrations).values({
      referenceNumber: `REG-AGENT-${randomUUID().slice(0, 12)}`,
      userId: 2,
      stakeholderType: "freight_forwarder",
      organizationName: "Regulatory Behaviour Agent",
      country: "GH",
      licenseExpiresAt: new Date(now.getTime() + 60_000),
      status: "approved",
      approvedBy: 4,
      approvedAt: now,
    }).returning();
    created.registrations.push(registration.id);
    await expect(caller("finance", 2).regulatory.allocateQuota({
      quotaId: quota.id, declarationId: first.id, quantity: "1",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("user", 2).regulatory.allocateQuota({
      quotaId: quota.id, declarationId: agentDeclaration.id, quantity: "1",
    })).resolves.toMatchObject({ declarationId: agentDeclaration.id });
    const results = await Promise.allSettled([
      caller().regulatory.allocateQuota({ quotaId: quota.id, declarationId: first.id, quantity: "6" }),
      caller().regulatory.allocateQuota({ quotaId: quota.id, declarationId: second.id, quantity: "6" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const allocations = await db.select().from(tariffQuotaAllocations).where(and(
      eq(tariffQuotaAllocations.quotaId, quota.id),
      isNull(tariffQuotaAllocations.reversedAt),
    ));
    expect(allocations).toHaveLength(2);
    expect(allocations.reduce((sum, allocation) => sum + Number(allocation.quantity), 0)).toBe(7);
    ledgerMocks.available.mockResolvedValue(false);
    const outage = await declaration("777703");
    await expect(caller().regulatory.allocateQuota({
      quotaId: quota.id, declarationId: outage.id, quantity: "1",
    })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("provisions platform-owned QTY ledger accounts and fails closed if unavailable", async () => {
    const db = await database();
    const now = new Date();
    const quotaCode = `Q-CREATE-${randomUUID()}`;
    const createdQuota = await caller("admin", 4).regulatory.createQuota({
      quotaCode,
      hsCodePrefix: "7799",
      origin: "GH",
      regime: "import",
      periodStart: new Date(now.getTime() - 60_000),
      periodEnd: new Date(now.getTime() + 60_000),
      totalQuantity: "12",
      quantityUnit: "kg",
      legalInstrument: "Instrument QUOTA-CREATE",
      validFrom: new Date(now.getTime() - 60_000),
    });
    created.quotas.push(createdQuota.id);
    expect(createdQuota.ledgerAccountId).toMatch(/^quota-available-/);
    expect(createdQuota.allocatedLedgerAccountId).toMatch(/^quota-allocated-/);
    const accountBodies = ledgerMocks.fetch.mock.calls
      .filter(([url]) => url === "/api/ledger/accounts")
      .map(([url, options]) => {
        expect(url).toBe("/api/ledger/accounts");
        return JSON.parse(String((options as RequestInit).body)) as Record<string, unknown>;
      });
    expect(accountBodies.find((body) => body.accountType === "QUOTA_ISSUANCE")).toMatchObject({
      currency: "QTY",
      initialBalance: "12",
    });
    expect(accountBodies.find((body) => body.accountType === "QUOTA_AVAILABLE")).toMatchObject({
      currency: "QTY",
      debitsMustNotExceedCredits: true,
    });
    expect(accountBodies.find((body) => body.accountType === "QUOTA_ALLOCATED")).toMatchObject({ currency: "QTY" });
    expect(ledgerMocks.fetch.mock.calls.some(([url, options]) =>
      url === "/api/ledger/transfers" &&
      JSON.parse(String((options as RequestInit).body)).idempotencyKey === `regulatory:quota:${quotaCode}:opening`,
    )).toBe(true);
    const quotaDeclaration = await declaration("779900");
    const allocation = await caller().regulatory.allocateQuota({
      quotaId: createdQuota.id,
      declarationId: quotaDeclaration.id,
      quantity: "3",
    });
    const allocationBody = [...ledgerMocks.fetch.mock.calls]
      .reverse()
      .find(([url]) => url === "/api/ledger/transfers");
    expect(allocationBody).toBeDefined();
    expect(JSON.parse(String((allocationBody?.[1] as RequestInit).body))).toMatchObject({
      debitAccountId: createdQuota.ledgerAccountId,
      creditAccountId: createdQuota.allocatedLedgerAccountId,
      amount: "3",
      currency: "QTY",
    });
    expect(allocation.transferId).toBeTruthy();

    ledgerMocks.available.mockResolvedValue(false);
    const unavailableCode = `Q-UNAVAILABLE-${randomUUID()}`;
    await expect(caller("admin", 4).regulatory.createQuota({
      quotaCode: unavailableCode,
      hsCodePrefix: "7798",
      periodStart: new Date(now.getTime() - 60_000),
      periodEnd: new Date(now.getTime() + 60_000),
      totalQuantity: "1",
      quantityUnit: "kg",
      legalInstrument: "Instrument QUOTA-UNAVAILABLE",
      validFrom: new Date(now.getTime() - 60_000),
    })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    const [missing] = await db.select().from(tariffQuotas)
      .where(eq(tariffQuotas.quotaCode, unavailableCode));
    expect(missing).toBeUndefined();
  });

  it("uses a new ledger idempotency attempt after quota reversal", async () => {
    const db = await database();
    const now = new Date();
    const [quota] = await db.insert(tariffQuotas).values({
      quotaCode: `Q-RETRY-${randomUUID()}`, hsCodePrefix: "7766", origin: "GH", regime: "import",
      periodStart: new Date(now.getTime() - 60_000), periodEnd: new Date(now.getTime() + 60_000),
      totalQuantity: "10", quantityUnit: "kg", ledgerAccountId: "quota-retry-available",
      allocatedLedgerAccountId: "quota-retry-allocated",
      legalInstrument: "Instrument QUOTA-RETRY", validFrom: new Date(now.getTime() - 60_000), createdBy: 4,
    }).returning();
    created.quotas.push(quota.id);
    const declarationRow = await declaration("776600");

    const first = await caller().regulatory.allocateQuota({
      quotaId: quota.id, declarationId: declarationRow.id, quantity: "3",
    });
    await caller("admin", 4).regulatory.reverseQuotaAllocation({ allocationId: first.id });
    const second = await caller().regulatory.allocateQuota({
      quotaId: quota.id, declarationId: declarationRow.id, quantity: "3",
    });

    const transfers = ledgerMocks.fetch.mock.calls
      .filter(([url]) => url === "/api/ledger/transfers")
      .map(([, options]) => JSON.parse(String((options as RequestInit).body)) as {
        debitAccountId: string;
        creditAccountId: string;
        amount: string;
        idempotencyKey: string;
      });
    const allocationTransfers = transfers.filter((transfer) =>
      transfer.debitAccountId === quota.ledgerAccountId &&
      transfer.creditAccountId === quota.allocatedLedgerAccountId,
    );
    const reversalTransfers = transfers.filter((transfer) =>
      transfer.debitAccountId === quota.allocatedLedgerAccountId &&
      transfer.creditAccountId === quota.ledgerAccountId,
    );
    expect(first.transferId).not.toBe(second.transferId);
    expect(allocationTransfers).toHaveLength(2);
    expect(new Set(allocationTransfers.map((transfer) => transfer.idempotencyKey))).toEqual(new Set([
      `regulatory:quota:${quota.id}:${declarationRow.id}:0`,
      `regulatory:quota:${quota.id}:${declarationRow.id}:1`,
    ]));
    expect(reversalTransfers).toHaveLength(1);

    const ledgerAllocatedTotal = allocationTransfers.reduce((total, transfer) => total + Number(transfer.amount), 0) -
      reversalTransfers.reduce((total, transfer) => total + Number(transfer.amount), 0);
    const [activeSqlTotal] = await db.select({
      quantity: sql<string>`coalesce(sum(${tariffQuotaAllocations.quantity}) filter (where ${tariffQuotaAllocations.reversedAt} is null), 0)`,
    }).from(tariffQuotaAllocations).where(eq(tariffQuotaAllocations.quotaId, quota.id));
    expect(ledgerAllocatedTotal).toBe(Number(activeSqlTotal?.quantity ?? 0));
  });

  it("re-evaluates effective regulations at clearance instead of trusting stale rows", async () => {
    const db = await database();
    const declarationRow = await declaration("888800");
    const [formality] = await db.insert(regulatoryFormalities).values({
      hsCodePrefix: "8888",
      agencyCode: "OGA-CLEAR",
      agencyName: "Clearance Agency",
      permitType: "CLEARANCE",
      legalInstrument: "Instrument CLEARANCE",
      validFrom: new Date(Date.now() - 60_000),
      createdBy: 4,
    }).returning();
    created.formalities.push(formality.id);
    await expect(assertDeclarationFormalitiesSatisfied(declarationRow.id))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("gates clearance on quota allocation and re-blocks after reversal", async () => {
    const db = await database();
    const now = new Date();
    const [quota] = await db.insert(tariffQuotas).values({
      quotaCode: `Q-CLEAR-${randomUUID()}`, hsCodePrefix: "8899", origin: "GH", regime: "import",
      periodStart: new Date(now.getTime() - 60_000), periodEnd: new Date(now.getTime() + 60_000),
      totalQuantity: "5", quantityUnit: "kg", ledgerAccountId: "quota-clear-available",
      allocatedLedgerAccountId: "quota-clear-allocated",
      legalInstrument: "Instrument QUOTA-CLEAR", validFrom: new Date(now.getTime() - 60_000), createdBy: 4,
    }).returning();
    created.quotas.push(quota.id);
    const declarationRow = await declaration("889900");

    await expect(assertDeclarationFormalitiesSatisfied(declarationRow.id))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("Instrument QUOTA-CLEAR") });
    const allocation = await caller().regulatory.allocateQuota({
      quotaId: quota.id, declarationId: declarationRow.id, quantity: "5",
    });
    await expect(assertDeclarationFormalitiesSatisfied(declarationRow.id)).resolves.toBeUndefined();
    await caller("admin", 4).regulatory.reverseQuotaAllocation({ allocationId: allocation.id });
    await expect(assertDeclarationFormalitiesSatisfied(declarationRow.id))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("Instrument QUOTA-CLEAR") });
  });

  it("does not re-consume permits on resubmission and records new obligations", async () => {
    const db = await database();
    const now = new Date();
    const declarationRow = await declaration("990000");
    const [firstFormality] = await db.insert(regulatoryFormalities).values({
      hsCodePrefix: "9900", agencyCode: "OGA-RESUBMIT-1", agencyName: "Resubmit Agency 1",
      permitType: "RESUBMIT-1", requiredQuantity: "5", legalInstrument: "Instrument RESUBMIT-1",
      validFrom: new Date(now.getTime() - 60_000), createdBy: 4,
    }).returning();
    const [permit] = await db.insert(ogaPermits).values({
      declarationId: declarationRow.id, agencyCode: "OGA-RESUBMIT-1", agencyName: "Resubmit Agency 1",
      permitType: "RESUBMIT-1", status: "approved", hsCode: "9900", consigneeId: 1,
      permittedQuantity: "5", validFrom: new Date(now.getTime() - 60_000),
    }).returning();
    created.formalities.push(firstFormality.id);
    created.permits.push(permit.id);
    await evaluateDeclarationRegulations({
      declarationId: declarationRow.id, importerId: 1, hsCode: declarationRow.hsCode!, origin: "GH",
      destination: "NG", regime: "import", quantity: "5", at: now,
    });
    const [secondFormality] = await db.insert(regulatoryFormalities).values({
      hsCodePrefix: "9900", agencyCode: "OGA-RESUBMIT-2", agencyName: "Resubmit Agency 2",
      permitType: "RESUBMIT-2", requiredQuantity: "5", legalInstrument: "Instrument RESUBMIT-2",
      validFrom: new Date(now.getTime() - 60_000), createdBy: 4,
    }).returning();
    created.formalities.push(secondFormality.id);
    await evaluateDeclarationRegulations({
      declarationId: declarationRow.id, importerId: 1, hsCode: declarationRow.hsCode!, origin: "GH",
      destination: "NG", regime: "import", quantity: "5", at: now,
    });
    const [permitAfter] = await db.select({ usedQuantity: ogaPermits.usedQuantity })
      .from(ogaPermits).where(eq(ogaPermits.id, permit.id));
    const rows = await db.select().from(declarationFormalities)
      .where(eq(declarationFormalities.declarationId, declarationRow.id));
    expect(permitAfter?.usedQuantity).toBe("5.000");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.formalityId)).toEqual([firstFormality.id, secondFormality.id]);
  });

  it("persists and consumes a permit satisfied by the live clearance recheck", async () => {
    const db = await database();
    const now = new Date();
    const declarationRow = await declaration("991100");
    const [formality] = await db.insert(regulatoryFormalities).values({
      hsCodePrefix: "9911", agencyCode: "OGA-LIVE", agencyName: "Live Agency",
      permitType: "LIVE-PERMIT", requiredQuantity: "5", legalInstrument: "Instrument LIVE",
      validFrom: new Date(now.getTime() - 60_000), createdBy: 4,
    }).returning();
    created.formalities.push(formality.id);
    await evaluateDeclarationRegulations({
      declarationId: declarationRow.id, importerId: 1, hsCode: declarationRow.hsCode!, origin: "GH",
      destination: "NG", regime: "import", quantity: "5", at: now,
    });
    const [before] = await db.select().from(declarationFormalities)
      .where(eq(declarationFormalities.declarationId, declarationRow.id));
    expect(before?.status).toBe("required");
    const [permit] = await db.insert(ogaPermits).values({
      declarationId: declarationRow.id, agencyCode: "OGA-LIVE", agencyName: "Live Agency",
      permitType: "LIVE-PERMIT", status: "approved", hsCode: "9911", consigneeId: 1,
      permittedQuantity: "5", validFrom: new Date(now.getTime() - 60_000),
    }).returning();
    created.permits.push(permit.id);

    await expect(assertDeclarationFormalitiesSatisfied(declarationRow.id)).resolves.toBeUndefined();
    const [satisfied] = await db.select().from(declarationFormalities)
      .where(eq(declarationFormalities.declarationId, declarationRow.id));
    const [consumed] = await db.select({ usedQuantity: ogaPermits.usedQuantity })
      .from(ogaPermits).where(eq(ogaPermits.id, permit.id));
    expect(satisfied).toMatchObject({
      status: "satisfied",
      satisfiedByPermitId: permit.id,
      satisfiedQuantity: "5.000",
    });
    expect(consumed?.usedQuantity).toBe("5.000");
    await expect(assertDeclarationFormalitiesSatisfied(declarationRow.id)).resolves.toBeUndefined();
    const [stillConsumed] = await db.select({ usedQuantity: ogaPermits.usedQuantity })
      .from(ogaPermits).where(eq(ogaPermits.id, permit.id));
    expect(stillConsumed?.usedQuantity).toBe("5.000");
  });
});
