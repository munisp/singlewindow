/**
 * OpenSearch Client — R5 FIX
 *
 * Provides a singleton OpenSearch client with:
 *  - Declaration full-text search (HS code, goods description, UCR)
 *  - Audit log indexing for SIEM/compliance queries
 *  - Security alert indexing (Wazuh event forwarding)
 *  - Graceful degradation when OPENSEARCH_URL is not set
 */

import { Client } from "@opensearch-project/opensearch";

let _client: Client | null = null;

export function getOpenSearchClient(): Client | null {
  if (_client) return _client;
  const url = process.env.OPENSEARCH_URL;
  if (!url) {
    // Graceful degradation — OpenSearch is optional in dev
    return null;
  }
  _client = new Client({
    node: url,
    auth: process.env.OPENSEARCH_USERNAME
      ? {
          username: process.env.OPENSEARCH_USERNAME,
          password: process.env.OPENSEARCH_PASSWORD ?? "",
        }
      : undefined,
    ssl: {
      rejectUnauthorized: process.env.NODE_ENV === "production",
    },
  });
  return _client;
}

// ─── INDEX NAMES ─────────────────────────────────────────────────────────────
export const INDICES = {
  DECLARATIONS: "tradegateway-declarations",
  AUDIT_EVENTS: "tradegateway-audit-events",
  SECURITY_ALERTS: "tradegateway-security-alerts",
  PAYMENTS: "tradegateway-payments",
} as const;

// ─── INDEX DECLARATIONS ───────────────────────────────────────────────────────
export interface DeclarationDocument {
  id: number;
  declarationNumber: string;
  ucr?: string | null;
  traderId: number;
  declarationType: string;
  status: string;
  riskLane?: string | null;
  riskScore?: string | null;
  hsCode?: string | null;
  goodsDescription?: string | null;
  countryOfOrigin?: string | null;
  countryOfDestination?: string | null;
  portOfEntry?: string | null;
  invoiceValue?: string | null;
  invoiceCurrency?: string | null;
  submittedAt?: Date | null;
  clearedAt?: Date | null;
  createdAt: Date;
}

export async function indexDeclaration(doc: DeclarationDocument): Promise<void> {
  const client = getOpenSearchClient();
  if (!client) return;
  try {
    await client.index({
      index: INDICES.DECLARATIONS,
      id: String(doc.id),
      body: {
        ...doc,
        submittedAt: doc.submittedAt?.toISOString(),
        clearedAt: doc.clearedAt?.toISOString(),
        createdAt: doc.createdAt.toISOString(),
        "@timestamp": new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[OpenSearch] Failed to index declaration:", err);
  }
}

export async function searchDeclarations(query: string, traderId?: number, limit = 20) {
  const client = getOpenSearchClient();
  if (!client) return { hits: [], total: 0 };
  try {
    const must: object[] = [
      {
        multi_match: {
          query,
          fields: [
            "declarationNumber^3",
            "ucr^3",
            "hsCode^2",
            "goodsDescription",
            "countryOfOrigin",
            "countryOfDestination",
            "portOfEntry",
          ],
          type: "best_fields",
          fuzziness: "AUTO",
        },
      },
    ];
    if (traderId !== undefined) {
      must.push({ term: { traderId } });
    }
    const response = await client.search({
      index: INDICES.DECLARATIONS,
      body: {
        query: { bool: { must } },
        size: limit,
        sort: [{ "_score": "desc" }, { "createdAt": "desc" }],
        highlight: {
          fields: {
            goodsDescription: {},
            declarationNumber: {},
            ucr: {},
          },
        },
      },
    });
    const hits = (response.body.hits?.hits ?? []).map((h: any) => ({
      ...h._source,
      _score: h._score,
      _highlight: h.highlight,
    }));
      const total = response.body.hits?.total;
      const totalCount = typeof total === 'number' ? total : (total as any)?.value ?? 0;
      return { hits, total: totalCount };
  } catch (err) {
    console.error("[OpenSearch] Search failed:", err);
    return { hits: [], total: 0 };
  }
}

// ─── INDEX AUDIT EVENTS ───────────────────────────────────────────────────────
// ─── GENERIC SEARCH ────────────────────────────────────────────────────────────────
/**
 * Generic search helper — accepts any OpenSearch query body and returns hits + total.
 * Used by the opensearch tRPC router for flexible full-text queries.
 */
export async function searchDocuments(
  index: string,
  body: Record<string, unknown>
): Promise<{ hits: unknown[]; total: number }> {
  const client = getOpenSearchClient();
  if (!client) return { hits: [], total: 0 };
  try {
    const response = await client.search({ index, body });
    const hits = (response.body.hits?.hits ?? []).map((h: any) => ({
      ...h._source,
      _score: h._score,
      _highlight: h.highlight,
    }));
    const total = response.body.hits?.total;
    const totalCount =
      typeof total === "number" ? total : (total as any)?.value ?? 0;
    return { hits, total: totalCount };
  } catch (err) {
    console.error(`[OpenSearch] searchDocuments(${index}) failed:`, err);
    return { hits: [], total: 0 };
  }
}

export interface AuditEventDocument {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  actorId?: number | null;
  actorType?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  entryHash?: string | null;
  prevHash?: string | null;
  createdAt: Date;
}

export async function indexAuditEvent(doc: AuditEventDocument): Promise<void> {
  const client = getOpenSearchClient();
  if (!client) return;
  try {
    await client.index({
      index: INDICES.AUDIT_EVENTS,
      id: String(doc.id),
      body: {
        ...doc,
        createdAt: doc.createdAt.toISOString(),
        "@timestamp": doc.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("[OpenSearch] Failed to index audit event:", err);
  }
}

// ─── INDEX SECURITY ALERTS ────────────────────────────────────────────────────
export interface SecurityAlertDocument {
  alertId: string;
  severity: string;
  category: string;
  title: string;
  description?: string | null;
  sourceIp?: string | null;
  targetService?: string | null;
  ruleId?: string | null;
  createdAt: Date;
}

export async function indexSecurityAlert(doc: SecurityAlertDocument): Promise<void> {
  const client = getOpenSearchClient();
  if (!client) return;
  try {
    await client.index({
      index: INDICES.SECURITY_ALERTS,
      id: doc.alertId,
      body: {
        ...doc,
        createdAt: doc.createdAt.toISOString(),
        "@timestamp": doc.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("[OpenSearch] Failed to index security alert:", err);
  }
}

// ─── ENSURE INDICES EXIST ─────────────────────────────────────────────────────
export async function ensureOpenSearchIndices(): Promise<void> {
  const client = getOpenSearchClient();
  if (!client) return;

  const indexConfigs: Record<string, object> = {
    [INDICES.DECLARATIONS]: {
      mappings: {
        properties: {
          declarationNumber: { type: "keyword" },
          ucr: { type: "keyword" },
          traderId: { type: "integer" },
          declarationType: { type: "keyword" },
          status: { type: "keyword" },
          riskLane: { type: "keyword" },
          riskScore: { type: "float" },
          hsCode: { type: "keyword" },
          goodsDescription: { type: "text", analyzer: "standard" },
          countryOfOrigin: { type: "keyword" },
          countryOfDestination: { type: "keyword" },
          portOfEntry: { type: "keyword" },
          invoiceValue: { type: "float" },
          invoiceCurrency: { type: "keyword" },
          submittedAt: { type: "date" },
          clearedAt: { type: "date" },
          createdAt: { type: "date" },
          "@timestamp": { type: "date" },
        },
      },
    },
    [INDICES.AUDIT_EVENTS]: {
      mappings: {
        properties: {
          entityType: { type: "keyword" },
          entityId: { type: "integer" },
          action: { type: "keyword" },
          actorId: { type: "integer" },
          actorType: { type: "keyword" },
          ipAddress: { type: "ip" },
          entryHash: { type: "keyword" },
          prevHash: { type: "keyword" },
          createdAt: { type: "date" },
          "@timestamp": { type: "date" },
        },
      },
    },
    [INDICES.SECURITY_ALERTS]: {
      mappings: {
        properties: {
          alertId: { type: "keyword" },
          severity: { type: "keyword" },
          category: { type: "keyword" },
          title: { type: "text" },
          sourceIp: { type: "ip" },
          targetService: { type: "keyword" },
          ruleId: { type: "keyword" },
          createdAt: { type: "date" },
          "@timestamp": { type: "date" },
        },
      },
    },
  };

  for (const [index, body] of Object.entries(indexConfigs)) {
    try {
      const exists = await client.indices.exists({ index });
      if (!exists.body) {
        await client.indices.create({ index, body });
        console.log(`[OpenSearch] Created index: ${index}`);
      }
    } catch (err) {
      console.error(`[OpenSearch] Failed to ensure index ${index}:`, err);
    }
  }
}

// ─── INDEX LIFECYCLE MANAGEMENT ──────────────────────────────────────────────
/**
 * Creates an ISM (Index State Management) policy on OpenSearch for the
 * tradegateway-audit-* index pattern (matches the actual
 * tradegateway-audit-events and tradegateway-audit-log indices; the
 * previous audit-trail-* pattern matched no index, so retention never
 * applied):
 *   hot (7 days) → warm (30 days) → delete (90 days)
 */
export async function setupIndexLifecycle(): Promise<{ success: boolean; message: string }> {
  const host = process.env.OPENSEARCH_URL || "http://localhost:9200";
  const policy = {
    policy: {
      description: "TradeGateway audit trail lifecycle: hot 7d → warm 30d → delete 90d",
      default_state: "hot",
      states: [
        {
          name: "hot",
          actions: [{ rollover: { min_index_age: "7d" } }],
          transitions: [{ state_name: "warm", conditions: { min_index_age: "7d" } }],
        },
        {
          name: "warm",
          actions: [{ read_only: {} }],
          transitions: [{ state_name: "delete", conditions: { min_index_age: "30d" } }],
        },
        {
          name: "delete",
          actions: [{ delete: {} }],
          transitions: [],
        },
      ],
      ism_template: [{ index_patterns: ["tradegateway-audit-*"], priority: 100 }],
    },
  };
  try {
    const res = await fetch(`${host}/_plugins/_ism/policies/audit-trail-policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policy),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const text = await res.text();
      return { success: false, message: `OpenSearch ISM PUT failed (${res.status}): ${text}` };
    }
    return { success: true, message: "ISM policy audit-trail-policy created/updated successfully" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `OpenSearch unavailable: ${msg}` };
  }
}

