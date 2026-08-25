import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  resolveTxt: vi.fn(),
  notifyOwner: vi.fn(),
  getTenantsWithPendingDomain: vi.fn(),
  markTenantDomainVerified: vi.fn(),
  resetTenantDomainFailCount: vi.fn(),
  incrementTenantDomainFailCount: vi.fn(),
  logDomainVerificationEvent: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({
  sdk: { authenticateRequest: mocks.authenticateRequest },
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: mocks.notifyOwner,
}));

vi.mock("./db", () => ({
  getTenantsWithPendingDomain: mocks.getTenantsWithPendingDomain,
  markTenantDomainVerified: mocks.markTenantDomainVerified,
  resetTenantDomainFailCount: mocks.resetTenantDomainFailCount,
  incrementTenantDomainFailCount: mocks.incrementTenantDomainFailCount,
  logDomainVerificationEvent: mocks.logDomainVerificationEvent,
}));

vi.mock("node:dns/promises", () => ({
  default: { resolveTxt: mocks.resolveTxt },
  resolveTxt: mocks.resolveTxt,
}));

import { tenantDomainPollerHandler } from "./scheduled/tenantDomainPoller";

const originalNodeEnv = process.env.NODE_ENV;
const tenant = {
  id: "4d1ef3c0-2a59-4e14-863e-7b9751c4c001",
  name: "Example Customs Authority",
  customDomain: "customs.example.ng",
  domainVerificationToken: "verify-token-123",
};

function makeResponse() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json };
}

async function invoke() {
  const response = makeResponse();
  await tenantDomainPollerHandler({ url: "/api/scheduled/tenant-domain-poll" } as never, response as never);
  return response;
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NODE_ENV = "production";
  mocks.authenticateRequest.mockResolvedValue({ isCron: true, taskUid: "tenant-domain-poll" });
  mocks.getTenantsWithPendingDomain.mockResolvedValue([]);
  mocks.markTenantDomainVerified.mockResolvedValue(undefined);
  mocks.resetTenantDomainFailCount.mockResolvedValue(undefined);
  mocks.incrementTenantDomainFailCount.mockResolvedValue({ domainVerificationFailCount: 1 });
  mocks.logDomainVerificationEvent.mockResolvedValue(undefined);
  mocks.notifyOwner.mockResolvedValue(false);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterAll(() => {
  process.env.NODE_ENV = originalNodeEnv;
  vi.restoreAllMocks();
});

describe("tenantDomainPollerHandler", () => {
  it("rejects non-cron callers", async () => {
    mocks.authenticateRequest.mockResolvedValue({ isCron: false, taskUid: "tenant-domain-poll" });

    const response = await invoke();

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ error: "cron-only endpoint" });
    expect(mocks.getTenantsWithPendingDomain).not.toHaveBeenCalled();
  });

  it("rejects cron identities that do not provide a task UID", async () => {
    mocks.authenticateRequest.mockResolvedValue({ isCron: true, taskUid: "" });

    const response = await invoke();

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ error: "cron-only endpoint" });
  });

  it("returns a dry-run result outside production without DNS or database work", async () => {
    process.env.NODE_ENV = "test";

    const response = await invoke();

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      mode: "dry-run",
      checked: 0,
      verified: 0,
      failed: 0,
      notified: 0,
    }));
    expect(mocks.resolveTxt).not.toHaveBeenCalled();
    expect(mocks.getTenantsWithPendingDomain).not.toHaveBeenCalled();
  });

  it("returns a successful empty result when no tenant is awaiting verification", async () => {
    const response = await invoke();

    expect(response.json).toHaveBeenCalledWith({
      ok: true,
      checked: 0,
      verified: 0,
      failed: 0,
      notified: 0,
      results: [],
    });
  });

  it("verifies a matching TXT token and records a success audit event", async () => {
    mocks.getTenantsWithPendingDomain.mockResolvedValue([tenant]);
    mocks.resolveTxt.mockResolvedValue([["verify-token-123"], ["unrelated-token"]]);

    const response = await invoke();

    expect(mocks.resolveTxt).toHaveBeenCalledWith("_ngswtp-verify.customs.example.ng");
    expect(mocks.markTenantDomainVerified).toHaveBeenCalledWith(tenant.id);
    expect(mocks.resetTenantDomainFailCount).toHaveBeenCalledWith(tenant.id);
    expect(mocks.logDomainVerificationEvent).toHaveBeenCalledWith(tenant.id, tenant.customDomain, "success");
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      verified: 1,
      failed: 0,
      results: [{ tenantId: tenant.id, domain: tenant.customDomain, status: "verified" }],
    }));
  });

  it("records a token mismatch below the notification threshold", async () => {
    mocks.getTenantsWithPendingDomain.mockResolvedValue([tenant]);
    mocks.resolveTxt.mockResolvedValue([["wrong-token"]]);
    mocks.incrementTenantDomainFailCount.mockResolvedValue({ domainVerificationFailCount: 2 });

    const response = await invoke();

    expect(mocks.notifyOwner).not.toHaveBeenCalled();
    expect(mocks.logDomainVerificationEvent).toHaveBeenCalledWith(
      tenant.id,
      tenant.customDomain,
      "failure",
      "TOKEN_MISMATCH",
      "TXT record found but token mismatch",
    );
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      failed: 1,
      notified: 0,
      results: [expect.objectContaining({ status: "pending", failCount: 2, notificationSent: false })],
    }));
  });

  it("notifies on each mismatch threshold and counts a delivered notification", async () => {
    mocks.getTenantsWithPendingDomain.mockResolvedValue([tenant]);
    mocks.resolveTxt.mockResolvedValue([["wrong-token"]]);
    mocks.incrementTenantDomainFailCount.mockResolvedValue({ domainVerificationFailCount: 3 });
    mocks.notifyOwner.mockResolvedValue(true);

    const response = await invoke();

    expect(mocks.notifyOwner).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining(tenant.customDomain),
      content: expect.stringContaining(tenant.domainVerificationToken),
    }));
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ notified: 1 }));
  });

  it("uses a zero fail count when the mismatch counter cannot return an update", async () => {
    mocks.getTenantsWithPendingDomain.mockResolvedValue([tenant]);
    mocks.resolveTxt.mockResolvedValue([["wrong-token"]]);
    mocks.incrementTenantDomainFailCount.mockResolvedValue(undefined);

    const response = await invoke();

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      results: [expect.objectContaining({ status: "pending", failCount: 0, notificationSent: false })],
    }));
  });

  it("does not increment notification count when a mismatch threshold notification fails", async () => {
    mocks.getTenantsWithPendingDomain.mockResolvedValue([tenant]);
    mocks.resolveTxt.mockResolvedValue([["wrong-token"]]);
    mocks.incrementTenantDomainFailCount.mockResolvedValue({ domainVerificationFailCount: 3 });
    mocks.notifyOwner.mockResolvedValue(false);

    const response = await invoke();

    expect(mocks.notifyOwner).toHaveBeenCalledOnce();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      notified: 0,
      results: [expect.objectContaining({ status: "pending", notificationSent: false })],
    }));
  });

  it("records a threshold DNS failure when notification delivery fails", async () => {
    mocks.getTenantsWithPendingDomain.mockResolvedValue([tenant]);
    mocks.resolveTxt.mockRejectedValue(Object.assign(new Error("not found"), { code: "ENODATA" }));
    mocks.incrementTenantDomainFailCount.mockResolvedValue({ domainVerificationFailCount: 3 });
    mocks.notifyOwner.mockResolvedValue(false);

    const response = await invoke();

    expect(mocks.notifyOwner).toHaveBeenCalledOnce();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      notified: 0,
      results: [expect.objectContaining({ status: "pending", notificationSent: false })],
    }));
  });

  it("does not notify for a non-multiple failure count above the threshold", async () => {
    mocks.getTenantsWithPendingDomain.mockResolvedValue([tenant]);
    mocks.resolveTxt.mockResolvedValue([["wrong-token"]]);
    mocks.incrementTenantDomainFailCount.mockResolvedValue({ domainVerificationFailCount: 4 });

    const response = await invoke();

    expect(mocks.notifyOwner).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      results: [expect.objectContaining({ failCount: 4, notificationSent: false })],
    }));
  });

  it("records expected DNS lookup failures as pending and notifies at the threshold", async () => {
    mocks.getTenantsWithPendingDomain.mockResolvedValue([tenant]);
    mocks.resolveTxt.mockRejectedValue(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
    mocks.incrementTenantDomainFailCount.mockResolvedValue({ domainVerificationFailCount: 3 });
    mocks.notifyOwner.mockResolvedValue(true);

    const response = await invoke();

    expect(mocks.logDomainVerificationEvent).toHaveBeenCalledWith(
      tenant.id,
      tenant.customDomain,
      "failure",
      "ENOTFOUND",
      "DNS lookup failed: ENOTFOUND",
    );
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      notified: 1,
      results: [expect.objectContaining({ status: "pending", reason: "DNS: ENOTFOUND" })],
    }));
  });

  it("records an unexpected DNS error and handles a missing error code", async () => {
    mocks.getTenantsWithPendingDomain.mockResolvedValue([tenant]);
    mocks.resolveTxt.mockRejectedValue(new Error("resolver unavailable"));
    mocks.incrementTenantDomainFailCount.mockResolvedValue(undefined);

    const response = await invoke();

    expect(mocks.logDomainVerificationEvent).toHaveBeenCalledWith(
      tenant.id,
      tenant.customDomain,
      "error",
      "DNS_LOOKUP_FAILED",
      expect.stringContaining("resolver unavailable"),
    );
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      failed: 1,
      results: [expect.objectContaining({ status: "error", failCount: 0 })],
    }));
  });

  it("returns a structured 500 response when a dependency fails before polling", async () => {
    mocks.getTenantsWithPendingDomain.mockRejectedValue(new Error("database offline"));

    const response = await invoke();

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      error: "database offline",
      context: { url: "/api/scheduled/tenant-domain-poll" },
      timestamp: expect.any(String),
    }));
  });

  it("serializes non-Error fatal dependencies without assuming a stack", async () => {
    mocks.getTenantsWithPendingDomain.mockRejectedValue("database offline");

    const response = await invoke();

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      error: "database offline",
      stack: undefined,
    }));
  });
});
