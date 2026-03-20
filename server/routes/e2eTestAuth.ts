/**
 * E2E Test Authentication Endpoint
 *
 * ONLY registered when NODE_ENV=test or E2E_TEST_MODE=1.
 * Never exposed in production or development builds.
 *
 * POST /api/e2e/session
 * Body: { openId: string; name: string; role: "user" | "admin" }
 * Response: Sets the app_session_id cookie with a valid signed JWT.
 *
 * This allows Playwright tests to bypass OAuth and establish an authenticated
 * session by directly creating a test user in the database and signing a JWT
 * with the same JWT_SECRET the server uses.
 */

import type { Express, Request, Response } from "express";
import { sdk } from "../_core/sdk";
import { ENV } from "../_core/env";
import * as db from "../db";
import { getSessionCookieOptions } from "../_core/cookies";
import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";

export function registerE2eTestAuthRoute(app: Express) {
  // Double-guard: only mount in test mode
  const isTestMode =
    process.env.NODE_ENV === "test" || process.env.E2E_TEST_MODE === "1";
  if (!isTestMode) return;

  /**
   * POST /api/e2e/session
   * Creates a test user in the DB (if not exists) and sets a valid session cookie.
   */
  app.post("/api/e2e/session", async (req: Request, res: Response) => {
    try {
      const {
        openId = "e2e-test-trader",
        name = "E2E Test Trader",
        role = "user",
        email,
      } = req.body as {
        openId?: string;
        name?: string;
        role?: "user" | "admin";
        email?: string;
      };

      // Validate role
      if (role !== "user" && role !== "admin") {
        res.status(400).json({ error: "role must be 'user' or 'admin'" });
        return;
      }

      // Upsert the test user into the database
      await db.upsertUser({
        openId,
        name,
        email: email ?? `${openId}@e2e.tradegateway.test`,
        loginMethod: "e2e-test",
        role,
        lastSignedIn: new Date(),
      });

      // Sign a JWT session token using the same secret as the real auth flow
      const sessionToken = await sdk.createSessionToken(openId, {
        name,
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
        openId,
        name,
        role,
        cookieName: COOKIE_NAME,
      });
    } catch (error) {
      console.error("[E2E] Failed to create test session:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * DELETE /api/e2e/session
   * Clears the session cookie (logout for E2E tests).
   */
  app.delete("/api/e2e/session", (req: Request, res: Response) => {
    const cookieOptions = getSessionCookieOptions(req);
    res.clearCookie(COOKIE_NAME, {
      ...cookieOptions,
      maxAge: -1,
    });
    res.json({ ok: true });
  });

  console.log("[E2E] Test auth endpoints registered at /api/e2e/session (POST/DELETE)");
}
