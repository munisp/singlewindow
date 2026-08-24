import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { appRouter } from "./routers";
import { getDb } from "./db";
import type { TrpcContext } from "./_core/context";
import { assertDeclarationFormalitiesSatisfied } from "./routers/regulatory";
import {
  declarations,
  declarationFormalities,
  ogaPermits,
  regulatoryFormalities,
  stakeholderMandates,
  stakeholderRegistrations,
} from "../drizzle/schema";

function caller(id: number, role: "user" | "customs_officer" = "user") {
  const context: TrpcContext = {
    user: {
      id,
      openId: `regulatory-graph-${id}`,
      name: `Regulatory Graph ${id}`,
      email: `regulatory-graph-${id}@example.test`,
      loginMethod: "test",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { method: "GET", headers: {}, cookies: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined, cookie: () => undefined } as unknown as TrpcContext["res"],
  };
  return appRouter.createCaller(context);
}

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Postgres is required for regulatory graph tests.");
  return db;
}

const created = {
  declarations: [] as number[],
  formalities: [] as number[],
  permits: [] as number[],
  registrations: [] as number[],
  mandates: [] as number[],
};

afterEach(async () => {
  const db = await database();
  if (created.declarations.length) {
    await db.delete(declarationFormalities)
      .where(inArray(declarationFormalities.declarationId, created.declarations));
    await db.delete(ogaPermits).where(inArray(ogaPermits.declarationId, created.declarations));
    await db.delete(declarations).where(inArray(declarations.id, created.declarations));
  }
  if (created.formalities.length) {
    await db.delete(regulatoryFormalities).where(inArray(regulatoryFormalities.id, created.formalities));
  }
  if (created.registrations.length) {
    await db.delete(stakeholderRegistrations).where(inArray(stakeholderRegistrations.id, created.registrations));
  }
  if (created.mandates.length) {
    await db.delete(stakeholderMandates).where(inArray(stakeholderMandates.id, created.mandates));
  }
  created.declarations.length = 0;
  created.formalities.length = 0;
  created.permits.length = 0;
  created.registrations.length = 0;
  created.mandates.length = 0;
});

describe.sequential("regulatory clearance graph importer identity", () => {
  it("uses the declaration principal for principal, agent, and customs previews", async () => {
    const db = await database();
    const now = new Date();
    const [declaration] = await db.insert(declarations).values({
      declarationNumber: `GRAPH-${randomUUID().slice(0, 20)}`,
      ucr: `GRAPH-UCR-${randomUUID()}`,
      traderId: 9,
      principalId: 1,
      actingAgentId: 2,
      declarationType: "import",
      hsCode: "847130",
      countryOfOrigin: "GH",
      countryOfDestination: "NG",
      numberOfPackages: 5,
      createdAt: now,
      submittedAt: now,
    }).returning();
    created.declarations.push(declaration.id);

    const [formality] = await db.insert(regulatoryFormalities).values({
      hsCodePrefix: "8471",
      origin: "GH",
      destination: "NG",
      regime: "import",
      agencyCode: "OGA-GRAPH",
      agencyName: "Graph Agency",
      permitType: "GRAPH-PERMIT",
      requiredQuantity: "5",
      legalInstrument: "Instrument GRAPH",
      validFrom: new Date(now.getTime() - 60_000),
      createdBy: 4,
    }).returning();
    created.formalities.push(formality.id);

    const [permit] = await db.insert(ogaPermits).values({
      declarationId: declaration.id,
      agencyCode: "OGA-GRAPH",
      agencyName: "Graph Agency",
      permitType: "GRAPH-PERMIT",
      status: "approved",
      hsCode: "8471",
      consigneeId: 1,
      permittedQuantity: "5",
      validFrom: new Date(now.getTime() - 60_000),
    }).returning();
    created.permits.push(permit.id);

    const [mandate] = await db.insert(stakeholderMandates).values({
      referenceNumber: `GRAPH-MANDATE-${randomUUID().slice(0, 12)}`,
      principalUserId: 1,
      agentUserId: 2,
      validFrom: new Date(now.getTime() - 60_000),
      validUntil: new Date(now.getTime() + 60_000),
    }).returning();
    created.mandates.push(mandate.id);

    const [registration] = await db.insert(stakeholderRegistrations).values({
      referenceNumber: `GRAPH-AGENT-${randomUUID().slice(0, 12)}`,
      userId: 2,
      stakeholderType: "freight_forwarder",
      organizationName: "Graph Agent",
      country: "GH",
      licenseExpiresAt: new Date(now.getTime() + 60_000),
      status: "approved",
      approvedBy: 4,
      approvedAt: now,
    }).returning();
    created.registrations.push(registration.id);

    const input = {
      declarationId: declaration.id,
      hsCode: declaration.hsCode!,
      origin: declaration.countryOfOrigin!,
      destination: declaration.countryOfDestination!,
      regime: declaration.declarationType,
      quantity: "5",
    };
    for (const preview of [
      caller(1).regulatory.clearanceGraph(input),
      caller(2).regulatory.clearanceGraph(input),
      caller(4, "customs_officer").regulatory.clearanceGraph(input),
    ]) {
      const graph = await preview;
      expect(graph.blocking).toBe(false);
      expect(graph.obligations).toMatchObject([{
        satisfied: true,
        blocking: false,
        satisfiedByPermitId: permit.id,
      }]);
    }

    await expect(assertDeclarationFormalitiesSatisfied(declaration.id)).resolves.toBeUndefined();
    await expect(caller(3).regulatory.clearanceGraph(input))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
