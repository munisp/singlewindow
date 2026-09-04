/**
 * D1–D3 platform defect fixes — regression tests.
 *
 * D1: ddosSlowDown skip predicate must match mount-relative /health paths.
 * D2: unmatched /api/* must return a JSON 404 (never the SPA HTML).
 * D3: production tRPC errorFormatter must strip stack traces but keep data.code.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { ddosSlowDownSkip, ddosSlowDown } from "./_core/security";
import { productionErrorFormatter } from "./_core/trpc";
import { apiNotFound } from "./_core/apiNotFound";

// ─── D1: ddosSlowDown skip (mount-relative path pitfall) ────────────────────
describe("D1: ddosSlowDown skip predicate", () => {
  it("skips mount-relative /health paths", () => {
    expect(ddosSlowDownSkip({ path: "/health" } as any)).toBe(true);
    expect(ddosSlowDownSkip({ path: "/health/live" } as any)).toBe(true);
    expect(ddosSlowDownSkip({ path: "/health/ready" } as any)).toBe(true);
  });

  it("does NOT match full /api/health paths (they would be a skip bug if used)", () => {
    // When mounted at /api, Express strips the prefix — the full path form
    // must NOT be what the predicate relies on.
    expect(ddosSlowDownSkip({ path: "/api/health/live" } as any)).toBe(false);
  });

  it("does not skip ordinary API traffic", () => {
    expect(ddosSlowDownSkip({ path: "/trpc/auth.me" } as any)).toBe(false);
  });

  it("passes health requests through the mounted middleware without delay", async () => {
    const app = express();
    app.use("/api", ddosSlowDown);
    app.get("/api/health/live", (_req, res) => res.json({ ok: true }));
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    try {
      const port = (server.address() as AddressInfo).port;
      const start = Date.now();
      const res = await fetch(`http://127.0.0.1:${port}/api/health/live`);
      expect(res.status).toBe(200);
      // Skipped requests complete fast — never the old 20 s delay.
      expect(Date.now() - start).toBeLessThan(5_000);
    } finally {
      server.close();
    }
  }, 10_000);
});

// ─── D3: production tRPC error formatter ────────────────────────────────────
describe("D3: production errorFormatter", () => {
  afterEach(() => vi.unstubAllEnvs());

  const shape = {
    message: "UNAUTHORIZED",
    code: -32001,
    data: {
      code: "UNAUTHORIZED",
      httpStatus: 401,
      stack: "TRPCError: UNAUTHED\n    at /app/dist/index.js:123:45",
      path: "auth.me",
      cause: { internal: "db connection string …" },
    },
  };

  it("strips stack and internals in production but keeps code/httpStatus/path", () => {
    vi.stubEnv("NODE_ENV", "production");
    const out = productionErrorFormatter(shape, { code: "UNAUTHORIZED" });
    expect(out.data).toEqual({
      code: "UNAUTHORIZED",
      httpStatus: 401,
      path: "auth.me",
    });
    expect(JSON.stringify(out)).not.toContain("/app/dist");
    expect(out.message).toBe("UNAUTHORIZED");
  });

  it("masks INTERNAL_SERVER_ERROR messages in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const out = productionErrorFormatter(
      {
        ...shape,
        message: "pq: password authentication failed for user …",
        data: { ...shape.data, code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
      },
      { code: "INTERNAL_SERVER_ERROR" }
    );
    expect(out.message).toBe("Internal server error");
    expect(out.data.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("passes the full shape through outside production (dev diagnostics)", () => {
    vi.stubEnv("NODE_ENV", "development");
    const out = productionErrorFormatter(shape, { code: "UNAUTHORIZED" });
    expect(out).toBe(shape);
  });
});

// ─── D2: unknown /api/* returns JSON 404 ────────────────────────────────────
describe("D2: apiNotFound", () => {
  async function withServer(build: (app: express.Express) => void) {
    const app = express();
    build(app);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = (server.address() as AddressInfo).port;
    return { server, base: `http://127.0.0.1:${port}` };
  }

  it("returns JSON 404 for unknown /api/* paths", async () => {
    const { server, base } = await withServer((app) => apiNotFound(app));
    try {
      const res = await fetch(`${base}/api/definitely-not-a-route`);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    } finally {
      server.close();
    }
  });

  it("passes /api/auth/* through (edge-handled, never 404'd by the app)", async () => {
    const { server, base } = await withServer((app) => {
      apiNotFound(app);
      app.use((_req, res) => res.status(200).send("spa-fallback"));
    });
    try {
      const res = await fetch(`${base}/api/auth/callback?code=x`);
      expect(res.status).toBe(200); // fell through to the next handler
      expect(await res.text()).toBe("spa-fallback");
    } finally {
      server.close();
    }
  });

  it("does not affect non-/api paths", async () => {
    const { server, base } = await withServer((app) => {
      apiNotFound(app);
      app.use((_req, res) => res.status(200).send("<html>spa</html>"));
    });
    try {
      const res = await fetch(`${base}/app/customs`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("spa");
    } finally {
      server.close();
    }
  });
});
