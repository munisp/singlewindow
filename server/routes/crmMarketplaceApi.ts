/**
 * Phase 12 — REST surface for Stakeholder-360 CRM + marketplace monetization.
 *
 *   GET /v1/stakeholders/search?q=&limit=&offset=     — party search (capped)
 *   GET /v1/stakeholders/:id/360                      — unified party profile
 *   GET /v1/marketplace/usage/:keyId/invoice?from=&to= — itemized usage invoice
 *   GET /v1/verification/certificates/:certNumber      — priced verification
 *   GET /v1/verification/declarations/:declarationNumber — priced verification
 *
 * All routes are metered marketplace calls guarded by requireApiKey: the
 * middleware authenticates the key, enforces scope/rate limit/sandbox
 * routing and writes the api_usage_logs metering record that the invoice
 * endpoint aggregates. Verification-as-a-service therefore meters per call
 * with NO separate billing path.
 *
 * Fail-closed: DB outage → 503; unknown party → 404; missing/invalid
 * invoice period → 400; invoice for a key other than the caller's → 403.
 */
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { apiKeys, declarations, originCertificates } from "../../drizzle/schema";
import { requireApiKey } from "../middleware/apiKeyAuth";
import {
  CaseTransitionError,
  getCaseById,
  getCaseTimeline,
  listCases,
  CRM_CASE_STATUSES,
  transitionCase,
  type CrmCaseStatus,
} from "../crm/cases";
import {
  getStakeholder360,
  searchStakeholders,
  StakeholderNotFoundError,
} from "../crm/stakeholders";
import { buildUsageInvoice, MarketplaceBillingError } from "../marketplace/tiers";

const PROD_UPSTREAM = { id: "crm-marketplace", sandbox: false } as const;

/** Resolve the platform user behind the caller's API key (case actor). */
async function actorForRequest(req: any): Promise<{ id: number; role: string }> {
  const keyId = req.apiKeyContext?.keyId;
  if (keyId == null) throw new Error("No API key context on request");
  const db = (await getDb())!;
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1);
  if (!key) throw new Error(`API key ${keyId} no longer exists`);
  return { id: key.userId, role: "api_consumer" };
}

export function registerCrmMarketplaceApiRoutes(app: Express): void {
  // ── Case workflow (mobile contract) ─────────────────────────────────────────
  // GET /v1/cases — paginated/capped case list.
  app.get(
    "/v1/cases",
    requireApiKey("reports:read", PROD_UPSTREAM),
    async (req, res) => {
      const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
      const offset = req.query.offset != null ? Number(req.query.offset) : undefined;
      if ((limit != null && !Number.isFinite(limit)) || (offset != null && !Number.isFinite(offset))) {
        res.status(400).json({ error: "limit/offset must be numeric" });
        return;
      }
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      if (status && !(CRM_CASE_STATUSES as readonly string[]).includes(status)) {
        res.status(400).json({ error: `Unknown status "${status}"` });
        return;
      }
      try {
        res.json(await listCases({ status: status as CrmCaseStatus | undefined, limit, offset }));
      } catch (err) {
        res.status(503).json({
          status: "down",
          error: err instanceof Error ? err.message : "Case list unavailable",
        });
      }
    }
  );

  // GET /v1/cases/:id — case + timeline.
  app.get(
    "/v1/cases/:id",
    requireApiKey("reports:read", PROD_UPSTREAM),
    async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "Invalid case id" });
        return;
      }
      try {
        const c = await getCaseById(id);
        if (!c) {
          res.status(404).json({ error: `Case ${id} not found` });
          return;
        }
        res.json({ case: c, timeline: await getCaseTimeline(id) });
      } catch (err) {
        res.status(503).json({
          status: "down",
          error: err instanceof Error ? err.message : "Case unavailable",
        });
      }
    }
  );

  // POST /v1/cases/:id/transitions — state machine transitions.
  // Idempotency: the client sends an Idempotency-Key header; a replay of the
  // SAME target status against a case already in that status returns the
  // current state 200 (safe retry), while a CONFLICTING transition (illegal
  // move, maker-checker block) answers 409 with the current case state.
  app.post(
    "/v1/cases/:id/transitions",
    requireApiKey("reports:read", PROD_UPSTREAM),
    async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "Invalid case id" });
        return;
      }
      const { toStatus, note, resolutionSummary } = req.body ?? {};
      if (typeof toStatus !== "string" || !(CRM_CASE_STATUSES as readonly string[]).includes(toStatus)) {
        res.status(400).json({ error: `toStatus must be one of [${CRM_CASE_STATUSES.join(", ")}]` });
        return;
      }
      const idempotencyKey = req.header("Idempotency-Key");
      try {
        const existing = await getCaseById(id);
        if (!existing) {
          res.status(404).json({ error: `Case ${id} not found` });
          return;
        }
        // Idempotent replay: already in the requested state.
        if (existing.status === toStatus) {
          res.status(200).json({ case: existing, idempotentReplay: true, idempotencyKey: idempotencyKey ?? null });
          return;
        }
        const actor = await actorForRequest(req);
        const result = await transitionCase({
          caseId: id,
          toStatus: toStatus as CrmCaseStatus,
          note: [note, idempotencyKey ? `idempotency-key:${idempotencyKey}` : null].filter(Boolean).join(" | ") || undefined,
          resolutionSummary,
          actor,
        });
        res.status(200).json({ ...result, idempotencyKey: idempotencyKey ?? null });
      } catch (err) {
        if (err instanceof CaseTransitionError) {
          const current = await getCaseById(id).catch(() => null);
          res.status(409).json({ error: err.message, currentStatus: current?.status ?? null });
          return;
        }
        if (err instanceof Error && err.name === "CrmSigningConfigError") {
          res.status(503).json({ status: "down", error: err.message });
          return;
        }
        res.status(503).json({
          status: "down",
          error: err instanceof Error ? err.message : "Transition unavailable",
        });
      }
    }
  );

  // ── Stakeholder search (pagination capped server-side) ─────────────────────
  app.get(
    "/v1/stakeholders/search",
    requireApiKey("reports:read", PROD_UPSTREAM),
    async (req, res) => {
      try {
        const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
        const offset = req.query.offset != null ? Number(req.query.offset) : undefined;
        if ((limit != null && !Number.isFinite(limit)) || (offset != null && !Number.isFinite(offset))) {
          res.status(400).json({ error: "limit/offset must be numeric" });
          return;
        }
        const result = await searchStakeholders({
          q: typeof req.query.q === "string" ? req.query.q : undefined,
          stakeholderType: typeof req.query.stakeholderType === "string" ? req.query.stakeholderType : undefined,
          status: typeof req.query.status === "string" ? req.query.status : undefined,
          limit,
          offset,
        });
        res.json(result);
      } catch (err) {
        res.status(503).json({
          status: "down",
          error: err instanceof Error ? err.message : "Stakeholder search unavailable",
        });
      }
    }
  );

  // ── Stakeholder-360 unified profile ─────────────────────────────────────────
  app.get(
    "/v1/stakeholders/:id/360",
    requireApiKey("reports:read", PROD_UPSTREAM),
    async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "Invalid stakeholder id" });
        return;
      }
      try {
        res.json(await getStakeholder360(id));
      } catch (err) {
        if (err instanceof StakeholderNotFoundError) {
          res.status(404).json({ error: err.message });
          return;
        }
        res.status(503).json({
          status: "down",
          error: err instanceof Error ? err.message : "Stakeholder-360 unavailable",
        });
      }
    }
  );

  // ── Usage → billing aggregation (itemized invoice) ──────────────────────────
  app.get(
    "/v1/marketplace/usage/:keyId/invoice",
    requireApiKey("reports:read", PROD_UPSTREAM),
    async (req, res) => {
      const keyId = Number(req.params.keyId);
      if (!Number.isInteger(keyId) || keyId <= 0) {
        res.status(400).json({ error: "Invalid key id" });
        return;
      }
      // A key may only invoice its OWN usage.
      if (req.apiKeyContext?.keyId !== keyId) {
        res.status(403).json({ error: "API keys may only invoice their own usage" });
        return;
      }
      const from = typeof req.query.from === "string" ? req.query.from : "";
      const to = typeof req.query.to === "string" ? req.query.to : "";
      if (!from || !to) {
        res.status(400).json({ error: "from and to query parameters (ISO dates) are required" });
        return;
      }
      try {
        res.json(await buildUsageInvoice(keyId, from, to));
      } catch (err) {
        if (err instanceof MarketplaceBillingError) {
          res.status(400).json({ error: err.message });
          return;
        }
        res.status(503).json({
          status: "down",
          error: err instanceof Error ? err.message : "Invoice aggregation unavailable",
        });
      }
    }
  );

  // ── Verification-as-a-service (metered per call) ────────────────────────────
  app.get(
    "/v1/verification/certificates/:certNumber",
    requireApiKey("verification:read", PROD_UPSTREAM),
    async (req, res) => {
      const certNumber = req.params.certNumber;
      if (!certNumber || certNumber.length > 100) {
        res.status(400).json({ error: "Invalid certificate number" });
        return;
      }
      try {
        const db = (await getDb())!;
        const [cert] = await db
          .select({
            certNumber: originCertificates.certNumber,
            certType: originCertificates.certType,
            status: originCertificates.status,
            exporterName: originCertificates.exporterName,
            originCountry: originCertificates.originCountry,
            destinationCountry: originCertificates.destinationCountry,
            approvedAt: originCertificates.approvedAt,
            expiresAt: originCertificates.expiresAt,
          })
          .from(originCertificates)
          .where(eq(originCertificates.certNumber, certNumber))
          .limit(1);
        if (!cert) {
          res.status(404).json({ verified: false, error: "Certificate not found", certNumber });
          return;
        }
        res.json({ verified: cert.status === "approved", certificate: cert, verifiedAt: new Date().toISOString() });
      } catch (err) {
        res.status(503).json({
          status: "down",
          error: err instanceof Error ? err.message : "Verification unavailable",
        });
      }
    }
  );

  app.get(
    "/v1/verification/declarations/:declarationNumber",
    requireApiKey("verification:read", PROD_UPSTREAM),
    async (req, res) => {
      const declNo = req.params.declarationNumber;
      if (!declNo || declNo.length > 64) {
        res.status(400).json({ error: "Invalid declaration number" });
        return;
      }
      try {
        const db = (await getDb())!;
        const [decl] = await db
          .select({
            declarationNumber: declarations.declarationNumber,
            declarationType: declarations.declarationType,
            status: declarations.status,
            riskLane: declarations.riskLane,
            submittedAt: declarations.submittedAt,
            clearedAt: declarations.clearedAt,
          })
          .from(declarations)
          .where(eq(declarations.declarationNumber, declNo))
          .limit(1);
        if (!decl) {
          res.status(404).json({ verified: false, error: "Declaration not found", declarationNumber: declNo });
          return;
        }
        res.json({ verified: decl.status === "cleared", declaration: decl, verifiedAt: new Date().toISOString() });
      } catch (err) {
        res.status(503).json({
          status: "down",
          error: err instanceof Error ? err.message : "Verification unavailable",
        });
      }
    }
  );
}
