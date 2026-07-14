/**
 * workflowSchemas router — Sprint v83
 * Manages the workflow input schema registry used by the Temporal retrigger form.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure, protectedProcedure } from "../_core/trpc";

// ─── Default schemas seeded for all known workflow types ─────────────────────
const DEFAULT_SCHEMAS: Record<string, { description: string; schema: object }> = {
  DECLARATION_PROCESSING: {
    description: "Process a customs declaration through the risk engine and OGA routing.",
    schema: {
      type: "object",
      properties: {
        declarationId: { type: "integer", description: "Declaration ID to process" },
        forceRiskRescore: { type: "boolean", description: "Force re-scoring even if already scored", default: false },
        priority: { type: "string", enum: ["low", "normal", "high"], default: "normal" },
      },
      required: ["declarationId"],
    },
  },
  PAYMENT_RECONCILIATION: {
    description: "Reconcile payment records against TigerBeetle ledger entries.",
    schema: {
      type: "object",
      properties: {
        dateFrom: { type: "string", format: "date", description: "Start date (YYYY-MM-DD)" },
        dateTo: { type: "string", format: "date", description: "End date (YYYY-MM-DD)" },
        currency: { type: "string", description: "ISO 4217 currency code", default: "GHS" },
        dryRun: { type: "boolean", description: "Preview without writing changes", default: false },
      },
      required: ["dateFrom", "dateTo"],
    },
  },
  KYC_REVERIFICATION: {
    description: "Re-run KYC verification for a stakeholder profile.",
    schema: {
      type: "object",
      properties: {
        profileId: { type: "integer", description: "Stakeholder profile ID" },
        documentTypes: {
          type: "array",
          items: { type: "string" },
          description: "Document types to re-verify (empty = all)",
          default: [],
        },
        notifyOnCompletion: { type: "boolean", default: true },
      },
      required: ["profileId"],
    },
  },
  SANCTIONS_SCREENING: {
    description: "Run sanctions screening against OFAC/UN/EU lists for a trader.",
    schema: {
      type: "object",
      properties: {
        traderId: { type: "integer", description: "User/trader ID to screen" },
        lists: {
          type: "array",
          items: { type: "string", enum: ["OFAC", "UN", "EU", "INTERPOL"] },
          description: "Sanctions lists to check",
          default: ["OFAC", "UN"],
        },
        fuzzyMatch: { type: "boolean", description: "Enable fuzzy name matching", default: true },
      },
      required: ["traderId"],
    },
  },
  CARGO_TRACKING_SYNC: {
    description: "Sync cargo tracking events from port operator APIs.",
    schema: {
      type: "object",
      properties: {
        portCode: { type: "string", description: "Port LOCODE (e.g. GHTEM, GHKTK)", minLength: 5, maxLength: 5 },
        lookbackHours: { type: "integer", description: "Hours to look back for events", default: 24, minimum: 1, maximum: 168 },
        vesselIds: { type: "array", items: { type: "string" }, description: "Filter by vessel IDs (empty = all)" },
      },
      required: ["portCode"],
    },
  },
  TRADE_STATS_ROLLUP: {
    description: "Aggregate trade statistics into the Delta Lake lakehouse.",
    schema: {
      type: "object",
      properties: {
        targetDate: { type: "string", format: "date", description: "Date to aggregate (YYYY-MM-DD, default: yesterday)" },
        tables: {
          type: "array",
          items: { type: "string" },
          description: "Target tables to update (empty = all)",
          default: [],
        },
        forceRecompute: { type: "boolean", description: "Recompute even if data exists", default: false },
      },
      required: [],
    },
  },
  AEO_RENEWAL: {
    description: "Process AEO (Authorised Economic Operator) application renewal.",
    schema: {
      type: "object",
      properties: {
        applicationId: { type: "integer", description: "AEO application ID to renew" },
        renewalPeriodYears: { type: "integer", description: "Renewal period in years", default: 3, minimum: 1, maximum: 5 },
        skipAudit: { type: "boolean", description: "Skip post-clearance audit check", default: false },
      },
      required: ["applicationId"],
    },
  },
  BOND_EXPIRY_CHECK: {
    description: "Check and notify on expiring customs bonds.",
    schema: {
      type: "object",
      properties: {
        warningDays: { type: "integer", description: "Days before expiry to warn", default: 30, minimum: 1 },
        sendNotifications: { type: "boolean", default: true },
        bondTypes: {
          type: "array",
          items: { type: "string", enum: ["TRANSIT", "WAREHOUSE", "DRAWBACK", "GENERAL"] },
          default: [],
        },
      },
      required: [],
    },
  },
};

export const workflowSchemasRouter = router({
  /**
   * listWorkflowTypes — list all known workflow types with their schemas.
   */
  listWorkflowTypes: protectedProcedure
    .query(async () => {
      if (process.env.NODE_ENV !== "production") {
        return Object.entries(DEFAULT_SCHEMAS).map(([workflowType, { description, schema }]) => ({
          workflowType,
          description,
          jsonSchema: schema,
          version: 1,
          isActive: true,
        }));
      }
      const { listWorkflowInputSchemas } = await import("../db");
      const rows = await listWorkflowInputSchemas();
      if (rows.length === 0) {
        // Return defaults if registry is empty
        return Object.entries(DEFAULT_SCHEMAS).map(([workflowType, { description, schema }]) => ({
          workflowType,
          description,
          jsonSchema: schema,
          version: 1,
          isActive: true,
        }));
      }
      return rows;
    }),

  /**
   * getSchemaForType — fetch the active schema for a specific workflow type.
   */
  getSchemaForType: protectedProcedure
    .input(z.object({ workflowType: z.string().min(1) }))
    .query(async ({ input }) => {
      if (process.env.NODE_ENV !== "production") {
        const def = DEFAULT_SCHEMAS[input.workflowType];
        if (!def) throw new TRPCError({ code: "NOT_FOUND", message: `No schema for workflow type: ${input.workflowType}` });
        return { workflowType: input.workflowType, description: def.description, jsonSchema: def.schema, version: 1, isActive: true };
      }
      const { getWorkflowInputSchema } = await import("../db");
      const schema = await getWorkflowInputSchema(input.workflowType);
      if (!schema) {
        // Fall back to default if not in DB
        const def = DEFAULT_SCHEMAS[input.workflowType];
        if (!def) throw new TRPCError({ code: "NOT_FOUND", message: `No schema for workflow type: ${input.workflowType}` });
        return { workflowType: input.workflowType, description: def.description, jsonSchema: def.schema, version: 1, isActive: true };
      }
      return schema;
    }),

  /**
   * upsertSchema — create or update a workflow input schema (admin only).
   */
  upsertSchema: adminProcedure
    .input(
      z.object({
        workflowType: z.string().min(1).max(128),
        jsonSchema: z.record(z.string(), z.unknown()),
        description: z.string().optional(),
        version: z.number().int().min(1).default(1),
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      if (process.env.NODE_ENV !== "production") {
        return { workflowType: input.workflowType, version: input.version, message: "Schema updated (dev stub)" };
      }
      const { upsertWorkflowInputSchema } = await import("../db");
      const result = await upsertWorkflowInputSchema({
        workflowType: input.workflowType,
        jsonSchema: input.jsonSchema,
        description: input.description,
        version: input.version,
        isActive: input.isActive,
      });
      return { workflowType: result?.workflowType ?? input.workflowType, version: result?.version ?? input.version, message: "Schema upserted" };
    }),

  /**
   * seedDefaultSchemas — seed all default schemas into the DB (admin only).
   */
  seedDefaultSchemas: adminProcedure
    .mutation(async () => {
      if (process.env.NODE_ENV !== "production") {
        return { seeded: Object.keys(DEFAULT_SCHEMAS).length, message: "Default schemas seeded (dev stub)" };
      }
      const { upsertWorkflowInputSchema } = await import("../db");
      let seeded = 0;
      for (const [workflowType, { description, schema }] of Object.entries(DEFAULT_SCHEMAS)) {
        await upsertWorkflowInputSchema({ workflowType, jsonSchema: schema, description, version: 1, isActive: true });
        seeded++;
      }
      return { seeded, message: `Seeded ${seeded} default schemas` };
    }),

  /**
   * v87: Get all versions of a workflow input schema for a given workflowType.
   */
  getVersionHistory: adminProcedure
    .input(z.object({ workflowType: z.string().min(1) }))
    .query(async ({ input }) => {
      const { getSchemaVersionHistory } = await import("../db");
      return getSchemaVersionHistory(input.workflowType);
    }),

  /**
   * v87: Restore a specific version as the active schema (creates a new version entry).
   */
  restoreVersion: adminProcedure
    .input(z.object({ workflowType: z.string().min(1), version: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const { getSchemaVersionHistory, upsertWorkflowInputSchema } = await import("../db");
      const history = await getSchemaVersionHistory(input.workflowType);
      const target = history.find(h => h.version === input.version);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Version not found" });
      // Get current max version
      const maxVersion = history.reduce((m, h) => Math.max(m, h.version), 0);
      return upsertWorkflowInputSchema({
        workflowType: input.workflowType,
        version: maxVersion + 1,
        jsonSchema: target.jsonSchema as object,
        description: `Restored from v${input.version}: ${target.description ?? ""}`,
        isActive: true,
      });
    }),
});

// Appended by v87 sprint
