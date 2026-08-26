/**
 * Sprint 68 — OpenAPI 3.1 Specification Generator
 * Auto-generates an OpenAPI spec from tRPC router definitions.
 * Served at GET /api/openapi.json
 *
 * Strategy: Introspect the appRouter to extract all procedure names,
 * then generate OpenAPI 3.1 paths using the tRPC HTTP batch link convention.
 * Each tRPC procedure maps to a POST /api/trpc/{procedure} endpoint.
 */

import type { Express } from "express";

// ─── ROUTER CATALOGUE ────────────────────────────────────────────────────────
// Manually curated from server/routers.ts — each entry describes a tRPC router
// and its procedures with human-readable metadata.

interface ProcedureMeta {
  type: "query" | "mutation";
  summary: string;
  description: string;
  tags: string[];
  requiresAuth: boolean;
  requestExample?: Record<string, unknown>;
  responseExample?: Record<string, unknown>;
}

const ROUTER_CATALOGUE: Record<string, Record<string, ProcedureMeta>> = {
  "auth.me": {
    me: { type: "query", summary: "Get current user", description: "Returns the authenticated user's profile, or null if not logged in.", tags: ["Authentication"], requiresAuth: false },
    logout: { type: "mutation", summary: "Log out", description: "Clears the session cookie and logs the user out.", tags: ["Authentication"], requiresAuth: false },
    listUsers: { type: "query", summary: "List all users (admin)", description: "Returns all registered users. Requires admin role.", tags: ["Authentication"], requiresAuth: true },
    changeRole: { type: "mutation", summary: "Change user role (admin)", description: "Promotes or demotes a user to a different role.", tags: ["Authentication"], requiresAuth: true },
  },
  declarations: {
    list: { type: "query", summary: "List declarations", description: "Returns a paginated list of customs declarations for the current user.", tags: ["Declarations"], requiresAuth: true },
    get: { type: "query", summary: "Get declaration by ID", description: "Returns full details for a single declaration.", tags: ["Declarations"], requiresAuth: true },
    create: { type: "mutation", summary: "Create declaration", description: "Submits a new customs declaration.", tags: ["Declarations"], requiresAuth: true },
    update: { type: "mutation", summary: "Update declaration", description: "Updates a draft declaration.", tags: ["Declarations"], requiresAuth: true },
    submit: { type: "mutation", summary: "Submit declaration", description: "Finalises and submits a draft declaration for processing.", tags: ["Declarations"], requiresAuth: true },
    approve: { type: "mutation", summary: "Approve declaration (officer)", description: "Approves a declaration and issues clearance.", tags: ["Declarations"], requiresAuth: true },
    reject: { type: "mutation", summary: "Reject declaration (officer)", description: "Rejects a declaration with a reason.", tags: ["Declarations"], requiresAuth: true },
  },
  payments: {
    getPaymentStatus: { type: "query", summary: "Get payment status", description: "Returns the payment status for a declaration.", tags: ["Payments"], requiresAuth: true },
    initiatePayment: { type: "mutation", summary: "Initiate payment", description: "Initiates a duty payment via Mojaloop.", tags: ["Payments"], requiresAuth: true },
    confirmPayment: { type: "mutation", summary: "Confirm payment", description: "Confirms a completed payment.", tags: ["Payments"], requiresAuth: true },
  },
  aeo: {
    getStatus: { type: "query", summary: "Get AEO status", description: "Returns the AEO (Authorised Economic Operator) status for the current trader.", tags: ["AEO"], requiresAuth: true },
    apply: { type: "mutation", summary: "Apply for AEO", description: "Submits an AEO application.", tags: ["AEO"], requiresAuth: true },
    listApplications: { type: "query", summary: "List AEO applications (admin)", description: "Returns all AEO applications.", tags: ["AEO"], requiresAuth: true },
    approve: { type: "mutation", summary: "Approve AEO application (admin)", description: "Approves an AEO application and issues a certificate.", tags: ["AEO"], requiresAuth: true },
  },
  geospatial: {
    getPortHeatmap: { type: "query", summary: "Get port activity heatmap", description: "Returns geospatial heatmap data for port activity.", tags: ["Geospatial"], requiresAuth: true },
    getVesselPositions: { type: "query", summary: "Get vessel positions", description: "Returns current AIS positions for tracked vessels.", tags: ["Geospatial"], requiresAuth: true },
  },
  cargoTracking: {
    getLiveVessels: { type: "query", summary: "Get live vessel positions", description: "Returns current AIS positions for all tracked vessels in the East Africa corridor. Refreshes every 30 seconds.", tags: ["Cargo Tracking"], requiresAuth: false, responseExample: { vessels: [{ mmsi: "636091234", vesselName: "MSC NAIROBI", lat: -4.0435, lon: 39.6682, speed: 12.4, heading: 285, status: "underway", riskFlag: "green" }], totalCount: 8, lastRefresh: "2026-03-09T15:00:00Z", sourceService: "sedona-svc" } },
    getVesselRoute: { type: "query", summary: "Get vessel route polyline", description: "Returns historical track waypoints for a specific vessel identified by MMSI.", tags: ["Cargo Tracking"], requiresAuth: false, requestExample: { mmsi: "636091234" } },
    getShipmentPosition: { type: "query", summary: "Get shipment position by declaration", description: "Returns the current vessel position linked to a specific declaration reference.", tags: ["Cargo Tracking"], requiresAuth: true, requestExample: { declarationRef: "URN-2026-001234" } },
    getPortArrivals: { type: "query", summary: "Get upcoming port arrivals", description: "Returns the list of vessels with upcoming ETAs at the home port.", tags: ["Cargo Tracking"], requiresAuth: false },
    getVesselStats: { type: "query", summary: "Get vessel statistics", description: "Returns summary statistics: total vessels, underway/moored/anchored counts, risk flag breakdown.", tags: ["Cargo Tracking"], requiresAuth: false },
  },
  onboarding: {
    getProgress: { type: "query", summary: "Get onboarding progress", description: "Returns the current onboarding wizard progress for the authenticated user.", tags: ["Onboarding"], requiresAuth: true },
    saveStep: { type: "mutation", summary: "Save onboarding step", description: "Saves data for a specific onboarding step and advances to the next.", tags: ["Onboarding"], requiresAuth: true, requestExample: { step: "company_profile", data: { companyName: "Acme Trading Ltd", country: "KE" } } },
    resetOnboarding: { type: "mutation", summary: "Reset onboarding", description: "Deletes the user's onboarding progress, allowing them to restart.", tags: ["Onboarding"], requiresAuth: true },
    calculateAeoEligibility: { type: "mutation", summary: "Calculate AEO eligibility", description: "Runs the AEO eligibility assessment from company profile data.", tags: ["Onboarding", "AEO"], requiresAuth: true },
    getOnboardingStats: { type: "query", summary: "Get onboarding stats (admin)", description: "Returns onboarding completion rates across all users.", tags: ["Onboarding"], requiresAuth: true },
  },
  security: {
    getAlerts: { type: "query", summary: "Get security alerts", description: "Returns recent security alerts.", tags: ["Security"], requiresAuth: true },
    getStats: { type: "query", summary: "Get security statistics", description: "Returns security monitoring statistics.", tags: ["Security"], requiresAuth: true },
  },
  threatIntel: {
    getIndicators: { type: "query", summary: "Get threat indicators", description: "Returns STIX 2.1 threat indicators from OpenCTI.", tags: ["Threat Intelligence"], requiresAuth: true },
    getStats: { type: "query", summary: "Get threat intelligence stats", description: "Returns summary statistics for the threat intelligence feed.", tags: ["Threat Intelligence"], requiresAuth: true },
    matchDeclaration: { type: "mutation", summary: "Match declaration against threats", description: "Checks a declaration against the threat indicator database.", tags: ["Threat Intelligence"], requiresAuth: true },
  },
  cep: {
    getAlerts: { type: "query", summary: "Get CEP pattern alerts", description: "Returns Flink CEP trade pattern detection alerts.", tags: ["CEP / Fraud Detection"], requiresAuth: true },
    getStats: { type: "query", summary: "Get CEP statistics", description: "Returns pattern detection statistics.", tags: ["CEP / Fraud Detection"], requiresAuth: true },
  },
  portCongestion: {
    getForecast: { type: "query", summary: "Get port congestion forecast", description: "Returns 24/48/72-hour congestion predictions for monitored ports.", tags: ["Port Operations"], requiresAuth: true },
    getPortStatus: { type: "query", summary: "Get port status", description: "Returns current operational status for all monitored ports.", tags: ["Port Operations"], requiresAuth: true },
  },
  traderScorecard: {
    getScorecard: { type: "query", summary: "Get trader performance scorecard", description: "Returns the compliance score, clearance percentile, and AEO tier for the current trader.", tags: ["Trader"], requiresAuth: true },
    getLeaderboard: { type: "query", summary: "Get trader leaderboard (admin)", description: "Returns the top traders by compliance score.", tags: ["Trader"], requiresAuth: true },
  },
  drawback: {
    listClaims: { type: "query", summary: "List drawback claims", description: "Returns duty drawback claims for the current trader.", tags: ["Finance"], requiresAuth: true },
    createClaim: { type: "mutation", summary: "Create drawback claim", description: "Submits a new duty drawback claim.", tags: ["Finance"], requiresAuth: true },
    approveClaim: { type: "mutation", summary: "Approve drawback claim (admin)", description: "Approves a duty drawback claim.", tags: ["Finance"], requiresAuth: true },
  },
  devPortal: {
    listApiKeys: { type: "query", summary: "List API keys", description: "Returns the developer's API keys.", tags: ["Developer Portal"], requiresAuth: true },
    createApiKey: { type: "mutation", summary: "Create API key", description: "Creates a new API key for the developer.", tags: ["Developer Portal"], requiresAuth: true },
    rotateApiKey: { type: "mutation", summary: "Rotate API key", description: "Rotates an existing API key, invalidating the old one.", tags: ["Developer Portal"], requiresAuth: true },
    revokeApiKey: { type: "mutation", summary: "Revoke API key", description: "Permanently revokes an API key.", tags: ["Developer Portal"], requiresAuth: true },
  },
  aseanSw: {
    getMessages: { type: "query", summary: "Get ASEAN SW messages", description: "Returns G2G message queue for ASEAN Single Window exchange.", tags: ["ASEAN Single Window"], requiresAuth: true },
    sendMessage: { type: "mutation", summary: "Send ASEAN SW message", description: "Dispatches a G2G document to an ASEAN member state.", tags: ["ASEAN Single Window"], requiresAuth: true },
    acknowledgeMessage: { type: "mutation", summary: "Acknowledge ASEAN SW message", description: "Acknowledges receipt of an inbound G2G message.", tags: ["ASEAN Single Window"], requiresAuth: true },
  },
  bondedWarehouse: {
    getInventory: { type: "query", summary: "Get bonded warehouse inventory", description: "Returns current inventory for the bonded warehouse.", tags: ["Bonded Warehouse"], requiresAuth: true },
    admitGoods: { type: "mutation", summary: "Admit goods to warehouse", description: "Records admission of goods under duty suspension.", tags: ["Bonded Warehouse"], requiresAuth: true },
    releaseGoods: { type: "mutation", summary: "Release goods from warehouse", description: "Releases goods from the bonded warehouse after duty payment.", tags: ["Bonded Warehouse"], requiresAuth: true },
  },
};

// ─── OPENAPI SPEC BUILDER ────────────────────────────────────────────────────

function buildOpenApiSpec(baseUrl: string): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  const tags = new Set<string>();

  for (const [routerKey, procedures] of Object.entries(ROUTER_CATALOGUE)) {
    for (const [procName, meta] of Object.entries(procedures)) {
      const path = `/api/trpc/${routerKey}.${procName}`;
      meta.tags.forEach(t => tags.add(t));

      const operation: Record<string, unknown> = {
        operationId: `${routerKey}_${procName}`,
        summary: meta.summary,
        description: meta.description,
        tags: meta.tags,
        security: meta.requiresAuth ? [{ cookieAuth: [] }] : [],
        responses: {
          "200": {
            description: "Successful response",
            content: {
              "application/json": {
                schema: { type: "object", properties: { result: { type: "object", properties: { data: { type: "object", description: "Procedure response data" } } } } },
                ...(meta.responseExample ? { example: { result: { data: meta.responseExample } } } : {}),
              },
            },
          },
          "400": { description: "Bad request — invalid input" },
          "401": { description: "Unauthorised — authentication required" },
          "403": { description: "Forbidden — insufficient permissions" },
          "500": { description: "Internal server error" },
        },
      };

      if (meta.type === "query") {
        operation.parameters = [
          {
            name: "input",
            in: "query",
            description: "JSON-encoded input object",
            required: false,
            schema: { type: "string", format: "json" },
            ...(meta.requestExample ? { example: JSON.stringify(meta.requestExample) } : {}),
          },
          {
            name: "batch",
            in: "query",
            description: "tRPC batch flag",
            required: false,
            schema: { type: "integer", enum: [1] },
          },
        ];
        paths[path] = { get: operation };
      } else {
        operation.requestBody = {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { "0": { type: "object", properties: { json: { type: "object", description: "Input payload" } } } } },
              ...(meta.requestExample ? { example: { "0": { json: meta.requestExample } } } : {}),
            },
          },
        };
        paths[path] = { post: operation };
      }
    }
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "TradeGateway™ NGSWTP API",
      version: "2.0.0",
      description: [
        "## TradeGateway™ Next Generation Single Window Trade Platform",
        "",
        "The TradeGateway NGSWTP API provides programmatic access to all customs, trade, and compliance functions.",
        "All endpoints use the **tRPC HTTP Batch Link** protocol — queries use GET, mutations use POST.",
        "",
        "### Authentication",
        "Authentication uses Keycloak-issued bearer tokens. Deployment-managed local sessions are supported only for explicitly provisioned users and test/demo flows.",
        "",
        "### Tech Stack",
        "- **Runtime**: Node.js + Express + tRPC 11",
        "- **Payments**: Mojaloop + TigerBeetle",
        "- **Geospatial**: Apache Sedona (AIS vessel tracking)",
        "- **ML**: Ray (risk scoring) + Flink CEP (pattern detection)",
        "- **Security**: OpenCTI (threat intel) + Wazuh (SIEM/XDR)",
        "- **Database**: TiDB Cloud (MySQL-compatible) + Drizzle ORM",
      ].join("\n"),
      contact: {
        name: "TradeGateway API Support",
        email: "api@tradegateway.gov",
        url: "https://tradegateway.gov/developer",
      },
      license: { name: "Government Open Licence v3.0", url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" },
    },
    servers: [
      { url: baseUrl, description: "Current environment" },
      { url: "https://api.tradegateway.gov", description: "Production" },
      { url: "https://sandbox.tradegateway.gov", description: "Sandbox" },
    ],
    tags: Array.from(tags).sort().map(name => ({ name })),
    paths,
    components: {
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "session",
          description: "Deployment-managed local session cookie for explicitly provisioned users; production clients should use Keycloak bearer authentication.",
        },
      },
      schemas: {
        TrpcError: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                message: { type: "string" },
                code: { type: "integer" },
                data: { type: "object", properties: { code: { type: "string" }, httpStatus: { type: "integer" } } },
              },
            },
          },
        },
      },
    },
  };
}

// ─── REGISTER ROUTE ──────────────────────────────────────────────────────────

export function registerOpenApiRoute(app: Express): void {
  app.get("/api/openapi.json", (req, res) => {
    const protocol = req.headers["x-forwarded-proto"] ?? req.protocol;
    const host = req.headers["x-forwarded-host"] ?? req.headers.host;
    const baseUrl = `${protocol}://${host}`;
    const spec = buildOpenApiSpec(baseUrl);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=300"); // 5-minute cache
    res.json(spec);
  });

  console.log("[OpenAPI] Spec endpoint registered at /api/openapi.json");
}
