/**
 * Knowledge Graph tRPC Router
 *
 * This router is the Node.js integration point for the polyglot AI/graph stack:
 *
 *   tRPC procedure → HTTP → Go bridge (port 8080)
 *                         → FalkorDB / Neo4j (graph database)
 *                         → Rust GNN engine (risk scoring)
 *                         → Python AI (CocoIndex, EPR-KGQA, ART)
 *                         → Ollama (local LLM)
 *
 * All procedures are protected (require authentication).
 * Admin-only procedures additionally check ctx.user.role === 'admin'.
 *
 * The Go bridge URL is configured via GRAPH_BRIDGE_URL env var.
 * If the bridge is unavailable, procedures return graceful fallback responses
 * rather than throwing errors — this keeps the main app functional even when
 * the graph stack is not deployed.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";

// ─── CONFIGURATION ────────────────────────────────────────────────────────────

const GRAPH_BRIDGE_URL = process.env.GRAPH_BRIDGE_URL ?? "http://localhost:8100";
const BRIDGE_TIMEOUT_MS = 10_000;

// ─── HTTP HELPER ──────────────────────────────────────────────────────────────

async function bridgeGet<T>(path: string): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
    const res = await fetch(`${GRAPH_BRIDGE_URL}${path}`, {
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function bridgePost<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
    const res = await fetch(`${GRAPH_BRIDGE_URL}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ─── ZOD SCHEMAS ─────────────────────────────────────────────────────────────

const RiskFactorSchema = z.object({
  factor: z.string(),
  weight: z.number(),
  value: z.number(),
  description: z.string(),
});

const ScoreResponseSchema = z.object({
  declarationId: z.string(),
  riskScore: z.number(),
  lane: z.enum(["green", "yellow", "red"]),
  riskFactors: z.array(RiskFactorSchema),
  explanation: z.string().optional(),
  gnnScore: z.number(),
  ruleScore: z.number(),
  historyScore: z.number(),
  confidence: z.number(),
  engine: z.string(),
  processedAt: z.string(),
  latencyMs: z.number(),
});

const CorridorSchema = z.object({
  id: z.string(),
  origin: z.string(),
  destination: z.string(),
  riskIndex: z.number(),
  avgDays: z.number(),
  volume: z.number(),
});

const OGANodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  avgProcessingHours: z.number(),
  slaHours: z.number(),
  backlogCount: z.number(),
});

const TraderRiskProfileSchema = z.object({
  traderId: z.string(),
  traderName: z.string(),
  aeoStatus: z.boolean(),
  overallRisk: z.number(),
  totalDeclarations: z.number(),
  redLaneCount: z.number(),
  yellowLaneCount: z.number(),
  greenLaneCount: z.number(),
  networkRisk: z.number(),
  topHsCodes: z.array(z.any()).optional(),
  topPorts: z.array(z.any()).optional(),
  sanctionsMatches: z.array(z.any()).optional(),
});

// ─── ROUTER ───────────────────────────────────────────────────────────────────

export const knowledgeGraphRouter = router({
  /**
   * Health check for the graph bridge and all downstream services.
   * Returns bridge status, graph DB connectivity, and service availability.
   */
  health: protectedProcedure.query(async () => {
    const result = await bridgeGet<{
      status: string;
      graph: boolean;
      timestamp: string;
      service: string;
      version: string;
    }>("/health");

    if (!result) {
      return {
        status: "unavailable",
        graph: false,
        timestamp: new Date().toISOString(),
        service: "go-graph-bridge",
        version: "unknown",
        bridgeReachable: false,
      };
    }

    return { ...result, bridgeReachable: true };
  }),

  /**
   * Score a declaration using the full polyglot risk pipeline:
   * Rust GNN engine (60%) + rule-based scorer (40%).
   * Falls back to rule-based only if Rust engine is unavailable.
   */
  scoreDeclaration: protectedProcedure
    .input(
      z.object({
        declarationId: z.string(),
        traderId: z.string(),
        hsCode: z.string(),
        declaredValue: z.number(),
        weight: z.number().optional(),
        portId: z.string().optional(),
        corridorId: z.string().optional(),
        aeoStatus: z.boolean().optional(),
        documentCount: z.number().optional(),
        countryOfOrigin: z.string().optional(),
      })
    )
    .output(ScoreResponseSchema.nullable())
    .mutation(async ({ input }) => {
      const result = await bridgePost<z.infer<typeof ScoreResponseSchema>>(
        "/score",
        {
          declarationId: input.declarationId,
          traderId: input.traderId,
          hsCode: input.hsCode,
          declaredValue: input.declaredValue,
          weight: input.weight ?? 0,
          portId: input.portId ?? "",
          corridorId: input.corridorId ?? "",
          aeoStatus: input.aeoStatus ?? false,
          documentCount: input.documentCount ?? 0,
          countryOfOrigin: input.countryOfOrigin ?? "",
        }
      );

      return result;
    }),

  /**
   * Get the full risk profile for a trader from the knowledge graph.
   * Includes lane distribution, network risk (GNN-propagated), and
   * top HS codes, ports, and sanctions matches.
   */
  traderProfile: protectedProcedure
    .input(z.object({ traderId: z.string() }))
    .output(TraderRiskProfileSchema.nullable())
    .query(async ({ input }) => {
      const result = await bridgeGet<z.infer<typeof TraderRiskProfileSchema>>(
        `/trader/${encodeURIComponent(input.traderId)}/profile`
      );
      return result;
    }),

  /**
   * Get high-risk trade corridors from the knowledge graph.
   * Used by the Geospatial dashboard to highlight risky routes.
   */
  highRiskCorridors: protectedProcedure
    .output(
      z.object({
        corridors: z.array(CorridorSchema),
        count: z.number(),
        minRisk: z.number(),
      }).nullable()
    )
    .query(async () => {
      const result = await bridgeGet<{
        corridors: z.infer<typeof CorridorSchema>[];
        count: number;
        minRisk: number;
      }>("/corridors/high-risk");
      return result;
    }),

  /**
   * Get OGA processing backlog from the knowledge graph.
   * Used by the OGA SLA dashboard to show real-time backlog.
   */
  ogaBacklog: protectedProcedure
    .output(
      z.object({
        ogas: z.array(OGANodeSchema),
        count: z.number(),
      }).nullable()
    )
    .query(async () => {
      const result = await bridgeGet<{
        ogas: z.infer<typeof OGANodeSchema>[];
        count: number;
      }>("/ogas/backlog");
      return result;
    }),

  /**
   * EPR-KGQA: Answer natural language questions about the trade knowledge graph.
   * Examples:
   *   "Which traders have the highest red-lane rate for HS chapter 85?"
   *   "What is the average clearance time for Ghana-China corridor?"
   *   "Show me all controlled goods declarations from last month"
   *
   * Routes to Python AI service via Go bridge.
   * Falls back gracefully if Python AI is unavailable.
   */
  askKnowledgeGraph: protectedProcedure
    .input(z.object({ question: z.string().min(5).max(500) }))
    .output(
      z.object({
        question: z.string(),
        answer: z.string(),
        intent: z.string(),
        cypher: z.string().optional(),
        resultCount: z.number(),
        results: z.array(z.record(z.string(), z.any())),
        fallback: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await bridgePost<{
        question: string;
        answer: string;
        intent: string;
        cypher?: string;
        resultCount: number;
        results: Record<string, unknown>[];
        fallback?: boolean;
      }>("/kgqa", { question: input.question });

      if (!result) {
        return {
          question: input.question,
          answer:
            "The Knowledge Graph QA service is currently unavailable. Please try again later.",
          intent: "unknown",
          resultCount: 0,
          results: [],
          fallback: true,
        };
      }

      return result;
    }),

  /**
   * ART (Adaptive Retrieval-augmented Thinking): Generate a natural language
   * explanation for a risk score using the Ollama local LLM bridge.
   *
   * The explanation includes:
   * - Why the declaration was assigned its risk lane
   * - Which factors contributed most to the score
   * - What actions the customs officer should take
   * - Relevant precedents from the knowledge graph
   */
  explainRisk: protectedProcedure
    .input(
      z.object({
        declarationId: z.string(),
        riskScore: z.number(),
        lane: z.enum(["green", "yellow", "red"]),
        riskFactors: z.array(RiskFactorSchema),
        hsCode: z.string(),
        declaredValue: z.number(),
        traderName: z.string().optional(),
      })
    )
    .output(
      z.object({
        answer: z.string(),
        confidence: z.number(),
        engine: z.string(),
        reasoning: z.string().optional(),
        recommendations: z.array(z.string()).optional(),
        fallback: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await bridgePost<{
        answer: string;
        confidence: number;
        engine: string;
        reasoning?: string;
        recommendations?: string[];
        fallback?: boolean;
      }>("/explain", input);

      if (!result) {
        // Generate a deterministic explanation from the risk factors
        const topFactor = input.riskFactors.sort((a, b) => b.weight - a.weight)[0];
        const laneLabel =
          input.lane === "red"
            ? "high-risk (RED lane)"
            : input.lane === "yellow"
            ? "medium-risk (YELLOW lane)"
            : "low-risk (GREEN lane)";

        return {
          answer: `Declaration ${input.declarationId} has been assessed as ${laneLabel} with a risk score of ${(input.riskScore * 100).toFixed(1)}%. The primary contributing factor is ${topFactor?.description ?? "multiple risk indicators"}.`,
          confidence: 0.6,
          engine: "rule-based-fallback",
          recommendations:
            input.lane === "red"
              ? [
                  "Conduct physical inspection",
                  "Verify all supporting documents",
                  "Cross-check declared value against market benchmarks",
                ]
              : input.lane === "yellow"
              ? ["Request additional documentation", "Verify HS code classification"]
              : ["Proceed to green-lane auto-clearance"],
          fallback: true,
        };
      }

      return result;
    }),

  /**
   * Execute a raw Cypher query against the knowledge graph.
   * Admin only — used by the Knowledge Graph Explorer UI.
   */
  executeCypher: protectedProcedure
    .input(
      z.object({
        cypher: z.string().min(5).max(2000),
        params: z.record(z.string(), z.any()).optional(),
      })
    )
    .output(
      z.object({
        results: z.array(z.record(z.string(), z.any())),
        count: z.number(),
      }).nullable()
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Raw Cypher execution requires admin role",
        });
      }

      const result = await bridgePost<{
        results: Record<string, unknown>[];
        count: number;
      }>("/cypher", { cypher: input.cypher, params: input.params ?? {} });

      return result;
    }),

  /**
   * Upsert a trader node in the knowledge graph.
   * Called automatically when a new stakeholder profile is created.
   */
  upsertTrader: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string(),
        tin: z.string().optional(),
        aeoStatus: z.boolean().optional(),
        riskScore: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await bridgePost("/graph/upsert/trader", {
        id: input.id,
        name: input.name,
        tin: input.tin ?? "",
        aeoStatus: input.aeoStatus ?? false,
        riskScore: input.riskScore ?? 0.5,
        violationCount: 0,
        declarationCount: 0,
      });
      return { success: true };
    }),

  /**
   * GNN batch-score all cleared declarations using the trained GraphSAGE model.
   * Routes to Python AI service via Go bridge.
   * Returns GNN-derived risk scores alongside the existing rule-based scores.
   */
  batchScore: protectedProcedure
    .input(
      z.object({
        declarationIds: z.array(z.string()).optional(),
        limit: z.number().min(1).max(1000).optional().default(500),
      })
    )
    .output(
      z.object({
        status: z.string(),
        scored: z.number(),
        results: z.array(
          z.object({
            declarationId: z.string(),
            gnnRiskScore: z.number(),
            riskLane: z.enum(["green", "yellow", "red"]),
            graphFeatures: z.record(z.string(), z.any()),
          })
        ),
        modelVersion: z.string(),
        fallback: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin" && ctx.user.role !== "customs_officer") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Batch GNN scoring requires admin or customs officer role",
        });
      }

      const result = await bridgePost<{
        status: string;
        scored: number;
        results: Array<{
          declarationId: string;
          gnnRiskScore: number;
          riskLane: "green" | "yellow" | "red";
          graphFeatures: Record<string, unknown>;
        }>;
        modelVersion: string;
      }>("/gnn/batch-score", {
        declarationIds: input.declarationIds ?? null,
        limit: input.limit,
      });

      if (!result) {
        return {
          status: "unavailable",
          scored: 0,
          results: [],
          modelVersion: "unknown",
          fallback: true,
        };
      }

      return { ...result, fallback: false };
    }),

  /**
   * Get the fraud network graph for D3 force-directed visualisation.
   * Returns nodes (traders, HS codes, ports) and edges (risk relationships).
   */
  fraudNetwork: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(10).max(500).optional().default(200),
        minRisk: z.number().min(0).max(1).optional().default(0.4),
      })
    )
    .output(
      z.object({
        nodes: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            type: z.enum(["trader", "hs_code", "port", "oga", "corridor"]),
            riskScore: z.number(),
            properties: z.record(z.string(), z.any()),
          })
        ),
        edges: z.array(
          z.object({
            source: z.string(),
            target: z.string(),
            type: z.string(),
            weight: z.number(),
            properties: z.record(z.string(), z.any()),
          })
        ),
        stats: z.object({
          totalNodes: z.number(),
          totalEdges: z.number(),
          highRiskNodes: z.number(),
          avgRiskScore: z.number(),
        }),
        fallback: z.boolean().optional(),
        unavailable: z.boolean().optional(),
        unavailableReason: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const result = await bridgeGet<{
        nodes: Array<{
          id: string;
          label: string;
          type: "trader" | "hs_code" | "port" | "oga" | "corridor";
          riskScore: number;
          properties: Record<string, unknown>;
        }>;
        edges: Array<{
          source: string;
          target: string;
          type: string;
          weight: number;
          properties: Record<string, unknown>;
        }>;
        stats: {
          totalNodes: number;
          totalEdges: number;
          highRiskNodes: number;
          avgRiskScore: number;
        };
      }>(`/fraud-network?limit=${input.limit}&minRisk=${input.minRisk}`);

      if (!result) {
        // SW-MP12: NEVER synthesize fraud-network entities when the graph bridge
        // is down — fabricated nodes/edges on an investigations console could
        // trigger real enforcement actions. Fail closed with an explicit
        // UNAVAILABLE state and no synthetic data.
        return {
          nodes: [],
          edges: [],
          stats: { totalNodes: 0, totalEdges: 0, highRiskNodes: 0, avgRiskScore: 0 },
          fallback: false,
          unavailable: true,
          unavailableReason: "GRAPH_BRIDGE_UNAVAILABLE: fraud-network data is served by the graph bridge; no data is shown rather than synthetic data.",
        };
      }

      return { ...result, fallback: false };
    }),

  // ─── TRADER INVESTIGATION ──────────────────────────────────────────────────
  // Returns a full investigation dossier for a single trader:
  //   - declaration timeline (last 12 months, one entry per declaration)
  //   - connected entities (shared agents, shared HS codes, shared ports)
  //   - risk trend (monthly avg risk score)
  //   - active audit flags
  // Used by the Fraud Investigation drill-down panel in FraudNetwork.tsx.

  getTraderInvestigation: protectedProcedure
    .input(
      z.object({
        traderId: z.string(),
        months: z.number().int().min(1).max(24).default(12),
      })
    )
    .query(async ({ ctx, input }) => {
      // Only admin and customs_officer roles may investigate traders
      const role = (ctx.user as { role?: string }).role;
      if (role !== "admin" && role !== "customs_officer") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admin or customs_officer roles may access investigation data.",
        });
      }

      // Try the Go bridge first
      const bridgeResult = await bridgePost<{
        trader: {
          id: string;
          companyName: string;
          tinNumber: string;
          aeoStatus: string;
          riskScore: number;
          country: string;
          traderType: string;
        };
        timeline: Array<{
          id: string;
          declarationNumber: string;
          date: string;
          type: string;
          status: string;
          riskLane: string;
          riskScore: number;
          declaredValue: number;
          currency: string;
          hsCode: string;
          originCountry: string;
          portOfEntry: string;
        }>;
        connectedEntities: {
          sharedAgents: Array<{ agentId: string; agentName: string; sharedTraders: number; declarations: number }>;
          sharedHsCodes: Array<{ code: string; description: string; count: number; avgRisk: number }>;
          sharedPorts: Array<{ port: string; country: string; count: number; avgRisk: number }>;
          relatedTraders: Array<{ id: string; companyName: string; connectionType: string; riskScore: number }>;
        };
        riskTrend: Array<{ month: string; avgRisk: number; declarations: number; redLane: number }>;
        auditFlags: Array<{
          id: string;
          auditType: string;
          status: string;
          riskIndicators: string[];
          createdAt: string;
        }>;
        summary: {
          totalDeclarations: number;
          redLaneCount: number;
          yellowLaneCount: number;
          greenLaneCount: number;
          totalDeclaredValue: number;
          avgRiskScore: number;
          openAudits: number;
        };
      }>("/trader/investigate", { traderId: input.traderId, months: input.months });

      if (bridgeResult) {
        return { ...bridgeResult, fallback: false };
      }

      // ── Fallback: query PostgreSQL directly ──────────────────────────────
      // This ensures the investigation panel works even without the Go bridge.
      const { getDb } = await import("../db");
      const { declarations, stakeholderProfiles, postClearanceAudits } = await import("../../drizzle/schema");
      const { eq, and, gte, desc } = await import("drizzle-orm");

      const traderIdNum = parseInt(input.traderId, 10);
      if (isNaN(traderIdNum)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "traderId must be a numeric string." });
      }

      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
      }

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - input.months);

      // Trader profile
      const traderRows = await db
        .select()
        .from(stakeholderProfiles)
        .where(eq(stakeholderProfiles.id, traderIdNum))
        .limit(1);

      const trader = traderRows[0];
      if (!trader) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trader not found." });
      }

      // Declaration timeline
      const decls = await db
        .select()
        .from(declarations)
        .where(
          and(
            eq(declarations.traderId, traderIdNum),
            gte(declarations.createdAt, cutoff)
          )
        )
        .orderBy(desc(declarations.createdAt))
        .limit(200);

      const timeline = decls.map((d) => ({
        id: String(d.id),
        declarationNumber: d.declarationNumber ?? "",
        date: d.createdAt?.toISOString() ?? "",
        type: d.declarationType ?? "import",
        status: d.status ?? "pending",
        riskLane: d.riskLane ?? "green",
        riskScore: Number(d.riskScore ?? 0),
        declaredValue: Number(d.invoiceValue ?? 0),
        currency: d.invoiceCurrency ?? "USD",
        hsCode: d.hsCode ?? "",
        originCountry: d.countryOfOrigin ?? "",
        portOfEntry: d.portOfEntry ?? "",
      }));

      // Risk trend (monthly)
      const riskTrend: Array<{ month: string; avgRisk: number; declarations: number; redLane: number }> = [];
      const monthMap = new Map<string, { total: number; count: number; red: number }>();
      for (const d of decls) {
        if (!d.createdAt) continue;
        const key = d.createdAt.toISOString().slice(0, 7); // YYYY-MM
        const entry = monthMap.get(key) ?? { total: 0, count: 0, red: 0 };
        entry.total += Number(d.riskScore ?? 0);
        entry.count += 1;
        if (d.riskLane === "red") entry.red += 1;
        monthMap.set(key, entry);
      }
      for (const [month, v] of Array.from(monthMap.entries()).sort()) {
        riskTrend.push({
          month,
          avgRisk: v.count > 0 ? Math.round((v.total / v.count) * 100) / 100 : 0,
          declarations: v.count,
          redLane: v.red,
        });
      }

      // HS code frequency
      type DeclRow2 = typeof decls[number];
      const hsMap = new Map<string, { count: number; totalRisk: number }>();
      for (const d of decls) {
        const hs = d.hsCode ?? "";
        if (!hs) continue;
        const e = hsMap.get(hs) ?? { count: 0, totalRisk: 0 };
        e.count += 1;
        e.totalRisk += Number(d.riskScore ?? 0);
        hsMap.set(hs, e);
      }
      const sharedHsCodes = Array.from(hsMap.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([code, v]) => ({
          code,
          description: "",
          count: v.count,
          avgRisk: v.count > 0 ? Math.round((v.totalRisk / v.count) * 100) / 100 : 0,
        }));

      // Port frequency
      const portMap = new Map<string, { count: number; totalRisk: number }>();
      for (const d of decls) {
        const port = d.portOfEntry ?? "";
        if (!port) continue;
        const e = portMap.get(port) ?? { count: 0, totalRisk: 0 };
        e.count += 1;
        e.totalRisk += Number(d.riskScore ?? 0);
        portMap.set(port, e);
      }
      const sharedPorts = Array.from(portMap.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5)
        .map(([port, v]) => ({
          port,
          country: "",
          count: v.count,
          avgRisk: v.count > 0 ? Math.round((v.totalRisk / v.count) * 100) / 100 : 0,
        }));

      // Open audit flags
      const auditRows = await db
        .select()
        .from(postClearanceAudits)
        .where(eq(postClearanceAudits.traderId, traderIdNum))
        .orderBy(desc(postClearanceAudits.createdAt))
        .limit(20);

      type AuditRow = typeof auditRows[number];
      const auditFlags = auditRows.map((a: AuditRow) => ({
        id: String(a.id),
        auditType: a.outcome ?? "pending",
        status: a.status ?? "scheduled",
        riskIndicators: a.triggerReason ? [a.triggerReason] : [],
        createdAt: a.createdAt?.toISOString() ?? "",
      }));

      // Summary
      type DeclRow = typeof decls[number];
      const redCount = decls.filter((d: DeclRow) => d.riskLane === "red").length;
      const yellowCount = decls.filter((d: DeclRow) => d.riskLane === "yellow").length;
      const greenCount = decls.filter((d: DeclRow) => d.riskLane === "green").length;
      const totalValue = decls.reduce((s: number, d: DeclRow) => s + Number(d.invoiceValue ?? 0), 0);
      const avgRisk =
        decls.length > 0
          ? decls.reduce((s: number, d: DeclRow) => s + Number(d.riskScore ?? 0), 0) / decls.length
          : 0;

      return {
        trader: {
          id: String(trader.id),
          companyName: trader.organizationName ?? "",
          tinNumber: trader.taxId ?? "",
          aeoStatus: trader.aeoStatus ?? "none",
          riskScore: 0, // stakeholderProfiles does not store a riskScore column
          country: trader.country ?? "",
          traderType: trader.stakeholderType ?? "trader",
        },
        timeline,
        connectedEntities: {
          sharedAgents: [],
          sharedHsCodes,
          sharedPorts,
          relatedTraders: [],
        },
        riskTrend,
        auditFlags,
        summary: {
          totalDeclarations: decls.length,
          redLaneCount: redCount,
          yellowLaneCount: yellowCount,
          greenLaneCount: greenCount,
          totalDeclaredValue: Math.round(totalValue * 100) / 100,
          avgRiskScore: Math.round(avgRisk * 100) / 100,
          // postClearanceAudits uses 'scheduled'|'in_progress'|'completed'|'escalated'|'closed'
          openAudits: auditFlags.filter((a) => a.status === "scheduled" || a.status === "in_progress").length,
        },
        fallback: true,
      };
    }),

  // ── SHARED AGENT NETWORK ──────────────────────────────────────────────────
  // Finds all traders who share the same customs broker / freight forwarder
  // as the given trader, returning a D3-compatible node+link graph.
  // Requires admin or customs_officer role.
  sharedAgentNetwork: protectedProcedure
    .input(
      z.object({
        traderId: z.string().min(1),
        months: z.number().int().min(1).max(24).default(12),
      })
    )
    .query(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin" && ctx.user.role !== "customs_officer") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin or customs officer role required" });
      }

      const traderIdNum = parseInt(input.traderId, 10);
      if (isNaN(traderIdNum)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "traderId must be a numeric string" });
      }

      // Try Go bridge first
      const bridgeResult = await bridgePost<{
        nodes: Array<{ id: string; label: string; type: string; riskScore: number; declarationCount: number }>;
        links: Array<{ source: string; target: string; weight: number; sharedAgent: string }>;
        centralTraderId: string;
        agentCount: number;
        relatedTraderCount: number;
      }>("/graph/shared-agents", { traderId: input.traderId, months: input.months });

      if (bridgeResult) {
        return { ...bridgeResult, fallback: false };
      }

      // ── Fallback: derive from PostgreSQL declarations ─────────────────────
      // Two traders are "linked" if they share the same portOfEntry and hsCode
      // within the same time window (proxy for shared broker/corridor).
      const { getDb } = await import("../db");
      const { declarations, stakeholderProfiles } = await import("../../drizzle/schema");
      const { eq, and, gte, inArray } = await import("drizzle-orm");

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const since = new Date();
      since.setMonth(since.getMonth() - input.months);

      // Verify the focal trader exists
      const focalProfile = await db
        .select()
        .from(stakeholderProfiles)
        .where(eq(stakeholderProfiles.userId, traderIdNum))
        .limit(1);
      if (!focalProfile.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Trader ${input.traderId} not found` });
      }

      // Get focal trader's declarations
      const focalDecls = await db
        .select()
        .from(declarations)
        .where(
          and(
            eq(declarations.traderId, traderIdNum),
            gte(declarations.createdAt, since)
          )
        )
        .limit(200);

      type DeclRow2 = typeof focalDecls[number];

      // Build a set of (portOfEntry, hsCode) pairs used by the focal trader
      const corridorSet = new Set(
        focalDecls
          .filter((d: DeclRow2) => d.portOfEntry && d.hsCode)
          .map((d: DeclRow2) => `${d.portOfEntry}::${d.hsCode?.slice(0, 4)}`)
      );

      if (corridorSet.size === 0) {
        // No corridor overlap possible — return minimal graph
        const focalNode = {
          id: input.traderId,
          label: focalProfile[0].organizationName ?? `Trader ${input.traderId}`,
          type: "focal_trader",
          riskScore: 0,
          declarationCount: focalDecls.length,
        };
        return {
          nodes: [focalNode],
          links: [],
          centralTraderId: input.traderId,
          agentCount: 0,
          relatedTraderCount: 0,
          fallback: true,
        };
      }

      // Find other traders who used the same corridors
      const allDecls = await db
        .select()
        .from(declarations)
        .where(gte(declarations.createdAt, since))
        .limit(2000);

      // Group by traderId, find corridor overlap
      const traderCorridors = new Map<number, Set<string>>();
      for (const d of allDecls) {
        if (d.traderId === traderIdNum) continue;
        if (!d.portOfEntry || !d.hsCode) continue;
        const key = `${d.portOfEntry}::${d.hsCode.slice(0, 4)}`;
        if (!corridorSet.has(key)) continue;
        const s = traderCorridors.get(d.traderId) ?? new Set<string>();
        s.add(key);
        traderCorridors.set(d.traderId, s);
      }

      // Keep top 20 most-connected traders
      const relatedTraderIds = Array.from(traderCorridors.entries())
        .sort((a, b) => b[1].size - a[1].size)
        .slice(0, 20)
        .map(([id]) => id);

      // Fetch profiles for related traders
      type ProfileRow = typeof focalProfile[number];
      let relatedProfiles: ProfileRow[] = [];
      if (relatedTraderIds.length > 0) {
        relatedProfiles = await db
          .select()
          .from(stakeholderProfiles)
          .where(inArray(stakeholderProfiles.userId, relatedTraderIds));
      }

      const profileMap = new Map<number, ProfileRow>();
      for (const p of relatedProfiles) profileMap.set(p.userId, p);

      // Build D3 nodes and links
      // Shared corridors become virtual "agent" nodes
      const corridorAgents = Array.from(
        new Set(
          Array.from(traderCorridors.values()).flatMap((s) => Array.from(s))
        )
      );

      type AllDeclRow = typeof allDecls[number];

      const nodes: Array<{ id: string; label: string; type: string; riskScore: number; declarationCount: number }> = [
        {
          id: input.traderId,
          label: focalProfile[0].organizationName ?? `Trader ${input.traderId}`,
          type: "focal_trader",
          riskScore: focalDecls.length > 0
            ? focalDecls.reduce((s: number, d: DeclRow2) => s + Number(d.riskScore ?? 0), 0) / focalDecls.length
            : 0,
          declarationCount: focalDecls.length,
        },
        ...corridorAgents.map((c: string) => ({
          id: `agent::${c}`,
          label: c.replace("::", " / "),
          type: "corridor_agent",
          riskScore: 0,
          declarationCount: 0,
        })),
        ...relatedTraderIds.map((tid: number) => {
          const p = profileMap.get(tid);
          const tDecls = allDecls.filter((d: AllDeclRow) => d.traderId === tid);
          const avgRisk = tDecls.length > 0
            ? tDecls.reduce((s: number, d: AllDeclRow) => s + Number(d.riskScore ?? 0), 0) / tDecls.length
            : 0;
          return {
            id: String(tid),
            label: p?.organizationName ?? `Trader ${tid}`,
            type: "related_trader",
            riskScore: Math.round(avgRisk * 100) / 100,
            declarationCount: tDecls.length,
          };
        }),
      ];

      const links: Array<{ source: string; target: string; weight: number; sharedAgent: string }> = [];
      // Focal trader → corridor agents
      for (const c of corridorAgents) {
        links.push({ source: input.traderId, target: `agent::${c}`, weight: 1, sharedAgent: c as string });
      }
      // Related traders → corridor agents
      for (const entry of Array.from(traderCorridors.entries())) {
        const [tid, corridors] = entry;
        for (const c of Array.from(corridors)) {
          links.push({ source: String(tid), target: `agent::${c}`, weight: corridors.size, sharedAgent: c as string });
        }
      }

      return {
        nodes,
        links,
        centralTraderId: input.traderId,
        agentCount: corridorAgents.length,
        relatedTraderCount: relatedTraderIds.length,
        fallback: true,
      };
    }),
});
