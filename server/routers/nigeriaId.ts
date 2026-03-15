/**
 * nigeriaId.ts — NIN (National Identification Number) Identity Provider router
 *
 * Integrates with the Nigeria Identity Management Commission (NIMC) via
 * Keycloak's external identity provider federation.
 *
 * Flow:
 *   1. Frontend calls nigeriaId.initiateAuth → receives a Keycloak IDP redirect URL
 *   2. User authenticates with NIMC portal (OIDC/OAuth2)
 *   3. NIMC redirects back to /api/oauth/callback with IDP token
 *   4. Frontend calls nigeriaId.verifyToken with the IDP token
 *   5. Server validates token, extracts NIN, links to trader KYC record
 *
 * Procedures:
 *   nigeriaId.initiateAuth          — Generate the Keycloak NIN IDP redirect URL
 *   nigeriaId.verifyToken           — Validate NIN IDP token and link to user
 *   nigeriaId.getVerificationStatus — Check NIN verification status for current user
 *   nigeriaId.adminListVerified     — Admin: list all NIN-verified traders
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { users, kycVerifications } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";

// ─── NIMC IDP Configuration ───────────────────────────────────────────────────
const KEYCLOAK_BASE = process.env.KEYCLOAK_URL || "http://localhost:8080";
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || "tradegateway";
const NIN_IDP_ALIAS = process.env.NIGERIA_ID_IDP_ALIAS || "nigeria-nimc";
const NIN_CLIENT_ID = process.env.NIGERIA_ID_CLIENT_ID || "";
const NIN_CLIENT_SECRET = process.env.NIGERIA_ID_CLIENT_SECRET || "";
const NIN_REDIRECT_URI_BASE = process.env.NIGERIA_ID_REDIRECT_URI || "";

// ─── Token validation helper ──────────────────────────────────────────────────
interface NimcTokenClaims {
  sub: string;           // NIMC subject ID
  nin?: string;          // National Identification Number
  given_name?: string;
  family_name?: string;
  birthdate?: string;    // ISO date
  phone_number?: string;
  email?: string;
  gender?: string;
  address?: { formatted?: string };
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  active?: boolean;
}

async function validateNimcToken(idpToken: string): Promise<NimcTokenClaims> {
  // Development mode — decode without verification if no client credentials
  if (!NIN_CLIENT_ID || !NIN_CLIENT_SECRET) {
    const parts = idpToken.split(".");
    if (parts.length !== 3) throw new Error("Invalid JWT format");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload as NimcTokenClaims;
  }

  // Production: validate via Keycloak token introspection
  const introspectUrl = `${KEYCLOAK_BASE}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token/introspect`;
  const body = new URLSearchParams({
    token: idpToken,
    client_id: NIN_CLIENT_ID,
    client_secret: NIN_CLIENT_SECRET,
  });

  const res = await fetch(introspectUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Keycloak introspection failed: ${res.status}`);
  }

  const data = await res.json() as NimcTokenClaims;
  if (!data.active) {
    throw new Error("NIN IDP token is inactive or expired");
  }

  return data;
}

// ─── Router ───────────────────────────────────────────────────────────────────
export const nigeriaIdRouter = router({

  /**
   * Generate the Keycloak NIN IDP redirect URL.
   * The frontend redirects the user to this URL to begin NIN authentication.
   */
  initiateAuth: protectedProcedure
    .input(z.object({
      returnPath: z.string().default("/app/trader/profile"),
      origin: z.string().url("Must be a valid URL"),
    }))
    .mutation(async ({ input }) => {
      const redirectUri = NIN_REDIRECT_URI_BASE
        ? `${NIN_REDIRECT_URI_BASE}/api/oauth/callback`
        : `${input.origin}/api/oauth/callback`;

      const params = new URLSearchParams({
        client_id: NIN_CLIENT_ID || "tradegateway-app",
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid profile nin",
        kc_idp_hint: NIN_IDP_ALIAS,
        state: Buffer.from(JSON.stringify({
          origin: input.origin,
          returnPath: input.returnPath,
          provider: "nimc",
        })).toString("base64url"),
      });

      const authUrl = `${KEYCLOAK_BASE}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?${params}`;

      return {
        authUrl,
        provider: "nimc",
        idpAlias: NIN_IDP_ALIAS,
        message: "Redirect user to authUrl to begin NIN verification",
      };
    }),

  /**
   * Validate the NIN IDP token returned after NIMC authentication,
   * extract the NIN, and link it to the current user's KYC record.
   */
  verifyToken: protectedProcedure
    .input(z.object({
      idpToken: z.string().min(10, "Invalid IDP token"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      let claims: NimcTokenClaims;
      try {
        claims = await validateNimcToken(input.idpToken);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `NIN token validation failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      const nin = claims.nin ?? claims.sub;
      if (!nin) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "NIN not found in token claims" });
      }

      // Confirm user exists
      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (!existingUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      // Check for existing KYC verification record
      const [existingKyc] = await db
        .select({ id: kycVerifications.id, status: kycVerifications.status })
        .from(kycVerifications)
        .where(eq(kycVerifications.userId, ctx.user.id))
        .orderBy(desc(kycVerifications.createdAt))
        .limit(1);

      const maskedNin = `${nin.substring(0, 4)}****${nin.substring(nin.length - 2)}`;
      const nimcMetadata = {
        nin,
        nimcSubjectId: claims.sub,
        givenName: claims.given_name,
        familyName: claims.family_name,
        birthdate: claims.birthdate,
        phoneNumber: claims.phone_number,
        gender: claims.gender,
        address: claims.address?.formatted,
        verifiedAt: new Date().toISOString(),
        provider: "nimc",
      };

      if (existingKyc) {
        // Update existing KYC record to APPROVED with NIN metadata
        await db
          .update(kycVerifications)
          .set({
            status: "APPROVED",
            reviewNotes: `NIN verified via NIMC IDP. NIN: ${maskedNin}`,
            reviewedAt: new Date(),
            metadata: { nimc: nimcMetadata },
            updatedAt: new Date(),
          })
          .where(eq(kycVerifications.id, existingKyc.id));
      } else {
        // Create a new KYC verification record
        await db.insert(kycVerifications).values({
          userId: ctx.user.id,
          verificationType: "INDIVIDUAL",
          status: "APPROVED",
          reviewNotes: `NIN verified via NIMC IDP. NIN: ${maskedNin}`,
          reviewedAt: new Date(),
          reviewedBy: null,
          metadata: { nimc: nimcMetadata },
          submittedAt: new Date(),
        });
      }

      return {
        success: true,
        nin: maskedNin,
        verifiedAt: new Date().toISOString(),
        name: [claims.given_name, claims.family_name].filter(Boolean).join(" ") || undefined,
        message: "NIN verified and linked to your account",
      };
    }),

  /**
   * Get NIN verification status for the current user.
   */
  getVerificationStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { verified: false, status: "unknown" as const };

      const [kyc] = await db
        .select({
          id: kycVerifications.id,
          status: kycVerifications.status,
          verificationType: kycVerifications.verificationType,
          reviewedAt: kycVerifications.reviewedAt,
          createdAt: kycVerifications.createdAt,
          metadata: kycVerifications.metadata,
        })
        .from(kycVerifications)
        .where(eq(kycVerifications.userId, ctx.user.id))
        .orderBy(desc(kycVerifications.createdAt))
        .limit(1);

      if (!kyc) return { verified: false, status: "not_started" as const };

      const meta = kyc.metadata as Record<string, unknown> | null;
      const isNimcVerified = !!(meta?.nimc) && kyc.status === "APPROVED";

      return {
        verified: isNimcVerified,
        status: kyc.status,
        verificationType: kyc.verificationType,
        verifiedAt: kyc.reviewedAt?.toISOString() ?? null,
        kycId: kyc.id,
        provider: isNimcVerified ? "nimc" : null,
      };
    }),

  /**
   * Admin: list all NIN-verified traders.
   */
  adminListVerified: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };

      const items = await db
        .select({
          userId: kycVerifications.userId,
          kycId: kycVerifications.id,
          status: kycVerifications.status,
          verificationType: kycVerifications.verificationType,
          verifiedAt: kycVerifications.reviewedAt,
          createdAt: kycVerifications.createdAt,
        })
        .from(kycVerifications)
        .where(eq(kycVerifications.status, "APPROVED"))
        .orderBy(desc(kycVerifications.reviewedAt))
        .limit(input.limit)
        .offset(input.offset);

      return { items, total: items.length };
    }),
});
