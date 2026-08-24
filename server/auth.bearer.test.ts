import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/keycloakVerifier", () => ({
  verifyKeycloakToken: vi.fn(),
  extractRoleFromPayload: vi.fn(),
}));

vi.mock("./_core/redisRateLimiter", () => ({
  isSessionRevoked: vi.fn().mockResolvedValue(false),
}));

vi.mock("./db", () => ({
  getPool: vi.fn().mockReturnValue(null),
  getUserByOpenId: vi.fn(),
  upsertUser: vi.fn().mockResolvedValue(undefined),
}));

const cookieUser = {
  id: 17,
  openId: "cookie-user",
  name: "Cookie User",
  email: "cookie@example.com",
  loginMethod: "manus",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

let sdk: typeof import("./_core/sdk").sdk;

beforeEach(async () => {
  process.env.JWT_SECRET = "auth-test-secret-012345678901234567890123";
  ({ sdk } = await import("./_core/sdk"));
  const { verifyKeycloakToken } = await import("./_core/keycloakVerifier");
  const { getUserByOpenId } = await import("./db");
  vi.mocked(verifyKeycloakToken).mockRejectedValue(new Error("invalid token"));
  vi.mocked(getUserByOpenId).mockResolvedValue(cookieUser as never);
});

describe("Bearer authentication precedence", () => {
  it("rejects an invalid Bearer token even when the session cookie is valid", async () => {
    const sessionCookie = await sdk.createSessionToken("cookie-user", { name: "Cookie User" });

    await expect(
      sdk.authenticateRequest({
        headers: {
          authorization: "Bearer malformed-token",
          cookie: `app_session_id=${sessionCookie}`,
        },
      } as any),
    ).rejects.toThrow("Invalid Bearer token");
  });

  it("authenticates with a valid session cookie when no Bearer token is present", async () => {
    const sessionCookie = await sdk.createSessionToken("cookie-user", { name: "Cookie User" });

    await expect(
      sdk.authenticateRequest({
        headers: {
          authorization: undefined,
          cookie: `app_session_id=${sessionCookie}`,
        },
      } as any),
    ).resolves.toMatchObject({ id: cookieUser.id, openId: cookieUser.openId });
  });
});
