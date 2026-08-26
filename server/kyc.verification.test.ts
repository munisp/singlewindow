import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  createKYCDocument: vi.fn(),
  getKYCDocument: vi.fn(),
  updateKYCDocument: vi.fn(),
  listKYCDocuments: vi.fn(),
  createKYCVerification: vi.fn(),
  getLatestKYCVerification: vi.fn(),
  updateKYCVerification: vi.fn(),
  listKYCVerifications: vi.fn(),
  createUserNotification: vi.fn(),
  logAuditEvent: vi.fn(),
  withRlsContext: vi.fn(),
}));
vi.mock("./_core/notification", () => ({ notifyOwner: vi.fn() }));
vi.mock("./_core/permify", () => ({ assertCan: vi.fn() }));
vi.mock("./_core/kafkaEventPublisher", () => ({
  emitKycSubmitted: vi.fn().mockResolvedValue(undefined),
  emitKycApproved: vi.fn().mockResolvedValue(undefined),
  emitKycRejected: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./storage", () => ({ storagePut: vi.fn() }));
vi.mock("./_core/piiEncryption", () => ({ encryptPii: vi.fn((value: string) => `enc:${value}`) }));

import { kycRouter } from "./routers/kyc";
import {
  createKYCDocument,
  createKYCVerification,
  createUserNotification,
  getKYCDocument,
  listKYCVerifications,
  logAuditEvent,
  updateKYCDocument,
  updateKYCVerification,
  withRlsContext,
} from "./db";
import { notifyOwner } from "./_core/notification";
import { assertCan } from "./_core/permify";
import { emitKycApproved, emitKycRejected, emitKycSubmitted } from "./_core/kafkaEventPublisher";
import { storagePut } from "./storage";
import { encryptPii } from "./_core/piiEncryption";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(role: AuthenticatedUser["role"] = "user", userId = 55): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `${role}-${userId}`,
    email: `${role}-${userId}@example.test`,
    name: `${role} reviewer`,
    loginMethod: "manus",
    role,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastSignedIn: new Date("2026-01-01T00:00:00.000Z"),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function kycDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    userId: 55,
    documentType: "passport",
    filename: "passport.png",
    fileKey: "kyc/55/passport.png",
    fileUrl: "https://storage.example.test/kyc/55/passport.png",
    fileSize: 4,
    contentType: "image/png",
    status: "PENDING_ANALYSIS",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function verification(overrides: Record<string, unknown> = {}) {
  return {
    id: 301,
    userId: 55,
    verificationType: "INDIVIDUAL",
    status: "PENDING_REVIEW",
    reviewedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function rlsDb(rows: unknown[]) {
  const resolved = Promise.resolve(rows);
  const ordered = Object.assign(resolved, { limit: () => resolved });
  return {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ordered }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storagePut).mockResolvedValue({ url: "https://storage.example.test/kyc/55/upload.png" } as any);
  vi.mocked(createKYCDocument).mockResolvedValue(kycDocument({ id: 201 }) as any);
  vi.mocked(getKYCDocument).mockResolvedValue(kycDocument() as any);
  vi.mocked(updateKYCDocument).mockResolvedValue(kycDocument({ status: "ANALYSED", analysedAt: new Date("2026-01-02T00:00:00.000Z") }) as any);
  vi.mocked(createKYCVerification).mockResolvedValue(verification() as any);
  vi.mocked(updateKYCVerification).mockResolvedValue(verification({ reviewedAt: new Date("2026-01-02T00:00:00.000Z") }) as any);
  vi.mocked(createUserNotification).mockResolvedValue(undefined as any);
  vi.mocked(logAuditEvent).mockResolvedValue(undefined as any);
  vi.mocked(assertCan).mockResolvedValue(undefined as any);
  vi.mocked(notifyOwner).mockResolvedValue(undefined as any);
  (vi.mocked(withRlsContext) as any).mockImplementation(async (_user: unknown, callback: (db: unknown) => unknown) => callback(rlsDb([])));
});

afterEach(() => vi.unstubAllGlobals());

describe("KYC verification — document submission and analysis", () => {
  it("uploads a supported document, persists the immutable storage coordinates, and returns a pending-analysis contract", async () => {
    const result = await kycRouter.createCaller(createContext()).uploadDocument({
      filename: "passport.png",
      contentType: "image/png",
      documentType: "passport",
      fileSize: 4,
      fileData: "dGVzdA==",
    });

    expect(result).toEqual(expect.objectContaining({
      documentId: 201,
      fileUrl: "https://storage.example.test/kyc/55/upload.png",
      status: "PENDING_ANALYSIS",
    }));
    expect(storagePut).toHaveBeenCalledWith(
      expect.stringMatching(/^kyc\/55\/passport-[a-f0-9]{8}-passport\.png$/),
      expect.any(Buffer),
      "image/png",
    );
    expect(createKYCDocument).toHaveBeenCalledWith(expect.objectContaining({
      userId: 55,
      status: "PENDING_ANALYSIS",
      contentType: "image/png",
      fileUrl: "https://storage.example.test/kyc/55/upload.png",
    }));
  });

  it("rejects analysis for a missing document or a document owned by another trader", async () => {
    vi.mocked(getKYCDocument).mockResolvedValueOnce(null as any);
    await expect(kycRouter.createCaller(createContext()).analyseDocument({ documentId: 101, runAuthenticity: true }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    vi.mocked(getKYCDocument).mockResolvedValueOnce(kycDocument({ userId: 999 }) as any);
    await expect(kycRouter.createCaller(createContext()).analyseDocument({ documentId: 101, runAuthenticity: true }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(updateKYCDocument).not.toHaveBeenCalled();
  });

  it("reports service unavailability without updating a document record", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    await expect(kycRouter.createCaller(createContext()).analyseDocument({ documentId: 101, runAuthenticity: true }))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });

    expect(updateKYCDocument).not.toHaveBeenCalled();
  });

  it("persists typed analysis output only after the available service returns a successful response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ocr_confidence: 0.98,
          authenticity_score: 87,
          authenticity_verdict: "LIKELY_GENUINE",
          extracted_name: "Test Trader",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await kycRouter.createCaller(createContext()).analyseDocument({ documentId: 101, runAuthenticity: false });

    expect(result.status).toBe("ANALYSED");
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("/api/kyc/analyse"), expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"verify_authenticity":false'),
    }));
    expect(updateKYCDocument).toHaveBeenCalledWith(101, expect.objectContaining({
      status: "ANALYSED",
      ocrConfidence: 0.98,
      authenticityScore: 87,
      authenticityVerdict: "LIKELY_GENUINE",
      analysedAt: expect.any(Date),
    }));
  });

  it("surfaces an internal error when a reachable analysis service rejects the document", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 422, text: async () => "document unreadable" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(kycRouter.createCaller(createContext()).analyseDocument({ documentId: 101, runAuthenticity: true }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: expect.stringContaining("document unreadable") });
  });
});

describe("KYC verification — identity and business applications", () => {
  it("rejects identity verification when the asserted primary document is missing or belongs to a different trader", async () => {
    vi.mocked(getKYCDocument).mockResolvedValueOnce(null as any);
    await expect(kycRouter.createCaller(createContext()).verifyIdentity({ primaryDocumentId: 101, declarationAccepted: true }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    vi.mocked(getKYCDocument).mockResolvedValueOnce(kycDocument({ userId: 999 }) as any);
    await expect(kycRouter.createCaller(createContext()).verifyIdentity({ primaryDocumentId: 101, declarationAccepted: true }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(createKYCVerification).not.toHaveBeenCalled();
  });

  it("records a complete individual application, audits it, and emits a best-effort submission event", async () => {
    const result = await kycRouter.createCaller(createContext()).verifyIdentity({
      primaryDocumentId: 101,
      secondaryDocumentId: 102,
      selfieDocumentId: 103,
      declarationAccepted: true,
    });

    expect(result).toMatchObject({ verificationId: 301, status: "PENDING_REVIEW" });
    expect(createKYCVerification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 55,
      verificationType: "INDIVIDUAL",
      primaryDocumentId: 101,
      secondaryDocumentId: 102,
      selfieDocumentId: 103,
      status: "PENDING_REVIEW",
      submittedAt: expect.any(Date),
    }));
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "kyc_identity_submitted", actorType: "trader" }));
    expect(emitKycSubmitted).toHaveBeenCalledWith(expect.objectContaining({ verificationId: 301, userId: 55, documentCount: 3 }));
  });

  it("requires acceptance of the legally binding identity declaration before performing database work", async () => {
    await expect(kycRouter.createCaller(createContext()).verifyIdentity({ primaryDocumentId: 101, declarationAccepted: false }))
      .rejects.toBeDefined();
    expect(getKYCDocument).not.toHaveBeenCalled();
    expect(createKYCVerification).not.toHaveBeenCalled();
  });

  it("encrypts business identifiers at rest while retaining the non-sensitive business metadata and optional document references", async () => {
    const result = await kycRouter.createCaller(createContext()).verifyBusiness({
      businessRegistrationDocId: 201,
      taxCertificateDocId: 202,
      directorIdDocId: 203,
      incorporationCertDocId: 204,
      memorandumDocId: 205,
      businessName: "Trade Export Holdings",
      registrationNumber: "REG-2026-55",
      taxIdentificationNumber: "TAX-0000055",
      declarationAccepted: true,
    });

    expect(result).toMatchObject({ verificationId: 301, status: "PENDING_REVIEW" });
    expect(encryptPii).toHaveBeenCalledWith("REG-2026-55");
    expect(encryptPii).toHaveBeenCalledWith("TAX-0000055");
    expect(createKYCVerification).toHaveBeenCalledWith(expect.objectContaining({
      verificationType: "BUSINESS",
      primaryDocumentId: 201,
      secondaryDocumentId: 202,
      selfieDocumentId: 203,
      metadata: {
        businessName: "Trade Export Holdings",
        registrationNumber: "enc:REG-2026-55",
        taxIdentificationNumber: "enc:TAX-0000055",
        incorporationCertDocId: 204,
        memorandumDocId: 205,
      },
    }));
    expect(emitKycSubmitted).toHaveBeenCalledWith(expect.objectContaining({ verificationType: "BUSINESS", documentCount: 3 }));
  });
});

describe("KYC verification — status retrieval and officer review", () => {
  it("returns the authenticated trader's latest approval and documents through two RLS-scoped reads", async () => {
    const approved = verification({ status: "APPROVED", verificationType: "BUSINESS" });
    const document = kycDocument({ id: 401 });
    const batches: unknown[][] = [[approved], [document]];
    (vi.mocked(withRlsContext) as any).mockImplementation(async (_user: unknown, callback: (db: unknown) => unknown) => callback(rlsDb(batches.shift() ?? [])));

    const result = await kycRouter.createCaller(createContext()).getVerification();

    expect(result).toMatchObject({ verification: approved, documents: [document], isVerified: true, verificationLevel: "BUSINESS" });
    expect(withRlsContext).toHaveBeenCalledTimes(2);
    expect(withRlsContext).toHaveBeenNthCalledWith(1, { id: 55, role: "user" }, expect.any(Function));
  });

  it("returns an explicit unverified state when no verification has been started", async () => {
    const result = await kycRouter.createCaller(createContext()).getVerification();
    expect(result).toEqual({ verification: null, documents: [], isVerified: false, verificationLevel: null });
  });

  it("lists only the authenticated trader's documents through an RLS-scoped read", async () => {
    const documents = [kycDocument({ id: 401 }), kycDocument({ id: 402, documentType: "utility_bill" })];
    (vi.mocked(withRlsContext) as any).mockImplementation(async (_user: unknown, callback: (db: unknown) => unknown) => callback(rlsDb(documents)));

    await expect(kycRouter.createCaller(createContext()).listDocuments()).resolves.toEqual(documents);
    expect(withRlsContext).toHaveBeenCalledWith({ id: 55, role: "user" }, expect.any(Function));
  });

  it("requires the admin procedure before a KYC decision can be made", async () => {
    await expect(kycRouter.createCaller(createContext()).reviewVerification({ verificationId: 301, decision: "APPROVED" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updateKYCVerification).not.toHaveBeenCalled();
  });

  it("approves a stakeholder with an owner notification, in-app result, audit record, and approval event", async () => {
    vi.mocked(updateKYCVerification).mockResolvedValueOnce(verification({ userId: 55, reviewedAt: new Date("2026-01-02T00:00:00.000Z") }) as any);

    const result = await kycRouter.createCaller(createContext("admin", 7)).reviewVerification({
      verificationId: 301,
      decision: "APPROVED",
      applicantName: "Trade Export Holdings",
      applicantType: "BUSINESS",
      notes: "Registry match completed",
    });

    expect(result).toMatchObject({ verificationId: 301, status: "APPROVED", notificationSent: true });
    expect(assertCan).toHaveBeenCalledWith("7", "kyc_verification", "301", "review");
    expect(updateKYCVerification).toHaveBeenCalledWith(301, expect.objectContaining({
      status: "APPROVED",
      reviewedBy: 7,
      reviewNotes: "Registry match completed",
      rejectionReason: null,
    }));
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ title: "New Stakeholder Approved — Trade Export Holdings", content: expect.stringContaining("Business") }));
    expect(createUserNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 55, type: "kyc_status_update", title: "KYC Verification Approved ✓" }));
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "kyc_review_approved", actorId: 7 }));
    expect(emitKycApproved).toHaveBeenCalledWith(expect.objectContaining({ verificationId: 301, userId: 55, reviewerId: 7 }));
    expect(emitKycRejected).not.toHaveBeenCalled();
  });

  it("rejects a stakeholder using the supplied reason in both owner and trader communications", async () => {
    vi.mocked(updateKYCVerification).mockResolvedValueOnce(verification({ userId: 55 }) as any);

    await kycRouter.createCaller(createContext("admin", 7)).reviewVerification({
      verificationId: 301,
      decision: "REJECTED",
      applicantName: "Test Trader",
      rejectionReason: "Passport image is unreadable",
    });

    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ title: "Stakeholder Verification Rejected — Test Trader", content: expect.stringContaining("Passport image is unreadable") }));
    expect(createUserNotification).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Reason: Passport image is unreadable") }));
    expect(emitKycRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "Passport image is unreadable" }));
  });

  it("requests more information without treating the decision as approval or rejection", async () => {
    vi.mocked(updateKYCVerification).mockResolvedValueOnce(verification({ userId: 55 }) as any);

    await kycRouter.createCaller(createContext("admin", 7)).reviewVerification({
      verificationId: 301,
      decision: "MORE_INFO_REQUIRED",
      notes: "Upload a recent utility bill",
    });

    expect(notifyOwner).not.toHaveBeenCalled();
    expect(createUserNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "KYC Verification — Additional Information Required",
      body: expect.stringContaining("Upload a recent utility bill"),
    }));
    expect(emitKycApproved).not.toHaveBeenCalled();
    expect(emitKycRejected).not.toHaveBeenCalled();
  });

  it("records an audit decision but suppresses trader notifications and decision events when the verification record no longer exists", async () => {
    vi.mocked(updateKYCVerification).mockResolvedValueOnce(null as any);

    const result = await kycRouter.createCaller(createContext("admin", 7)).reviewVerification({
      verificationId: 301,
      decision: "REJECTED",
    });

    expect(result).toMatchObject({ verificationId: 301, status: "REJECTED", reviewedAt: null });
    expect(createUserNotification).not.toHaveBeenCalled();
    expect(emitKycApproved).not.toHaveBeenCalled();
    expect(emitKycRejected).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "kyc_review_rejected" }));
  });

  it("maps ALL to an unfiltered pending-verification query and preserves a specific verification type", async () => {
    vi.mocked(listKYCVerifications).mockResolvedValue([] as any);
    const admin = kycRouter.createCaller(createContext("admin", 7));

    await admin.listPendingVerifications({ limit: 10, offset: 2, verificationType: "ALL" });
    expect(listKYCVerifications).toHaveBeenLastCalledWith({ status: "PENDING_REVIEW", verificationType: undefined, limit: 10, offset: 2 });

    await admin.listPendingVerifications({ limit: 5, offset: 0, verificationType: "BUSINESS" });
    expect(listKYCVerifications).toHaveBeenLastCalledWith({ status: "PENDING_REVIEW", verificationType: "BUSINESS", limit: 5, offset: 0 });
  });
});
