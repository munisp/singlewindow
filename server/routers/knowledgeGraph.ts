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
        // Return synthetic demo data when bridge is unavailable
        return {
          nodes: [
            { id: "t1", label: "Acme Trading Ltd", type: "trader" as const, riskScore: 0.82, properties: { declarations: 45, redLane: 12 } },
            { id: "t2", label: "Global Imports Co", type: "trader" as const, riskScore: 0.71, properties: { declarations: 33, redLane: 8 } },
            { id: "t3", label: "FastCargo Ltd", type: "trader" as const, riskScore: 0.65, properties: { declarations: 28, redLane: 6 } },
            { id: "t4", label: "SafeShip Inc", type: "trader" as const, riskScore: 0.21, properties: { declarations: 120, redLane: 2 } },
            { id: "hs8517", label: "HS 8517 — Phones", type: "hs_code" as const, riskScore: 0.78, properties: { chapter: 85, description: "Telephone sets" } },
            { id: "hs6403", label: "HS 6403 — Footwear", type: "hs_code" as const, riskScore: 0.55, properties: { chapter: 64, description: "Footwear" } },
            { id: "p1", label: "Tema Port", type: "port" as const, riskScore: 0.61, properties: { country: "GH", congestion: "high" } },
            { id: "p2", label: "Mombasa Port", type: "port" as const, riskScore: 0.44, properties: { country: "KE", congestion: "medium" } },
          ],
          edges: [
            { source: "t1", target: "hs8517", type: "TRADES", weight: 0.82, properties: { count: 18 } },
            { source: "t2", target: "hs8517", type: "TRADES", weight: 0.71, properties: { count: 12 } },
            { source: "t1", target: "p1", type: "USES_PORT", weight: 0.75, properties: { count: 30 } },
            { source: "t2", target: "p1", type: "USES_PORT", weight: 0.68, properties: { count: 22 } },
            { source: "t3", target: "hs6403", type: "TRADES", weight: 0.65, properties: { count: 15 } },
            { source: "t3", target: "p2", type: "USES_PORT", weight: 0.55, properties: { count: 18 } },
            { source: "t1", target: "t2", type: "SHARED_AGENT", weight: 0.88, properties: { agent: "Broker X" } },
          ],
          stats: {
            totalNodes: 8,
            totalEdges: 7,
            highRiskNodes: 5,
            avgRiskScore: 0.60,
          },
          fallback: true,
        };
      }

      return { ...result, fallback: false };
    }),
});
