/**
 * Demo Mode Authentication Endpoint
 *
 * ONLY registered when DEMO_MODE=true.
 * Provides a zero-friction demo experience — no OAuth required.
 *
 * The 6 demo users are pre-seeded in the database via the seed script.
 * This route simply signs a JWT for the requested demo role.
 *
 * POST /api/demo/session
 * Body: { role?: "trader" | "customs" | "oga" | "admin" | "security" | "developer" }
 * Response: Sets the app_session_id cookie with a valid signed JWT for a demo user.
 *
 * DELETE /api/demo/session
 * Clears the demo session cookie.
 *
 * GET /api/demo/status
 * Returns { demoMode: true } so the frontend can detect demo mode.
 */
import type { Express, Request, Response } from "express";
import { sdk } from "../_core/sdk";
import { getSessionCookieOptions } from "../_core/cookies";
import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";

export type DemoRole = "trader" | "customs" | "oga" | "admin" | "security" | "developer";

// These users are pre-seeded in the DB via the postgres superuser (bypasses RLS).
// The openId values must match what was inserted.
const DEMO_USERS: Record<DemoRole, { openId: string; name: string; title: string }> = {
  trader:    { openId: "demo-trader",    name: "Amara Diallo",       title: "Licensed Trader" },
  customs:   { openId: "demo-customs",   name: "Kwame Asante",       title: "Senior Customs Officer" },
  oga:       { openId: "demo-oga",       name: "Fatima Al-Hassan",   title: "OGA Permit Officer" },
  admin:     { openId: "demo-admin",     name: "Chidi Okonkwo",      title: "Platform Administrator" },
  security:  { openId: "demo-security",  name: "Ngozi Eze",          title: "Security Analyst" },
  developer: { openId: "demo-developer", name: "Tunde Adeyemi",      title: "API Developer" },
};

export function registerDemoAuthRoute(app: Express) {
  /**
   * GET /api/demo/status — lets the frontend know demo mode is active
   */
  app.get("/api/demo/status", (_req: Request, res: Response) => {
    res.json({ demoMode: true, roles: Object.keys(DEMO_USERS) });
  });

  /**
   * POST /api/demo/session
   * Signs a JWT for the requested demo role (user must already exist in DB).
   */
  app.post("/api/demo/session", async (req: Request, res: Response) => {
    try {
      const { role = "admin" } = req.body as { role?: DemoRole };

      if (!DEMO_USERS[role]) {
        res.status(400).json({
          error: `Invalid role. Must be one of: ${Object.keys(DEMO_USERS).join(", ")}`,
        });
        return;
      }

      const demoUser = DEMO_USERS[role];

      // Sign a JWT session token — the user already exists in the DB
      const sessionToken = await sdk.createSessionToken(demoUser.openId, {
        name: demoUser.name,
        expiresInMs: ONE_YEAR_MS,
      });

      // Set the session cookie
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      res.json({
        ok: true,
        openId: demoUser.openId,
        name: demoUser.name,
        title: demoUser.title,
        demoRole: role,
        cookieName: COOKIE_NAME,
      });
    } catch (error) {
      console.error("[Demo] Failed to create demo session:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * DELETE /api/demo/session — clears the demo session cookie
   */
  app.delete("/api/demo/session", (req: Request, res: Response) => {
    const cookieOptions = getSessionCookieOptions(req);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    res.json({ ok: true });
  });

  console.log("[Demo] Demo auth endpoints registered at /api/demo/session (POST/DELETE) and /api/demo/status (GET)");
}
