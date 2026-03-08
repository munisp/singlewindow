/**
 * Tests for geospatial tRPC router.
 * Uses appRouter.createCaller pattern consistent with other test files.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock the db module - must be before any imports that use it
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
  listPortLocations: vi.fn(),
  getPortCongestionHistory: vi.fn(),
  listVesselTracking: vi.fn(),
  getHeatmapData: vi.fn(),
  insertPortLocation: vi.fn(),
  insertCongestionEvent: vi.fn(),
  insertVesselPosition: vi.fn(),
  getPortCount: vi.fn().mockResolvedValue(5),
  getCongestionCount: vi.fn().mockResolvedValue(5),
  seedPortLocations: vi.fn().mockResolvedValue(undefined),
  seedCongestionEvents: vi.fn().mockResolvedValue(undefined),
  // other helpers used by appRouter
  getUserByOpenId: vi.fn(),
  createUser: vi.fn(),
  getUserById: vi.fn(),
  getAllUsers: vi.fn(),
  createDeclaration: vi.fn(),
  getDeclarationById: vi.fn(),
  getDeclarationsByTrader: vi.fn(),
  getAllDeclarations: vi.fn(),
  updateDeclarationStatus: vi.fn(),
  getDeclarationStats: vi.fn(),
  createPayment: vi.fn(),
  getPaymentsByDeclaration: vi.fn(),
  getAllPayments: vi.fn(),
  createProfile: vi.fn(),
  getProfileByUserId: vi.fn(),
  updateProfile: vi.fn(),
  getAllProfiles: vi.fn(),
  createKYCVerification: vi.fn(),
  getKYCByUserId: vi.fn(),
  getAllKYCVerifications: vi.fn(),
  updateKYCStatus: vi.fn(),
  createAEOApplication: vi.fn(),
  getAEOByUserId: vi.fn(),
  getAllAEOApplications: vi.fn(),
  updateAEOStatus: vi.fn(),
  createNotification: vi.fn(),
  getUserNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
  createOGAWorkflow: vi.fn(),
  getOGAWorkflowsByDeclaration: vi.fn(),
  getAllOGAWorkflows: vi.fn(),
  updateOGAWorkflowStatus: vi.fn(),
  createRiskAssessment: vi.fn(),
  getRiskByDeclaration: vi.fn(),
  screenEntity: vi.fn(),
  createScreeningRecord: vi.fn(),
  getAllScreeningRecords: vi.fn(),
}));

import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const mockUser = {
  id: 1,
  openId: "test-open-id",
  name: "Test User",
  email: "test@example.com",
  role: "user" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: null,
  loginMethod: null,
};
const mockAdminUser = { ...mockUser, role: "admin" as const };

function createCtx(user: typeof mockUser | null): TrpcContext {
  return { user, req: {} as any, res: {} as any };
}

const mockPort = {
  id: 1,
  portCode: "GHTEM",
  portName: "Tema Port",
  country: "GHA",
  latitude: 5.6333,
  longitude: -0.0167,
  portType: "seaport",
  isActive: true,
  createdAt: new Date(),
};

const mockCongestionEvent = {
  id: 1,
  portCode: "GHTEM",
  congestionStatus: "moderate" as const,
  vesselCount: 12,
  waitTimeHours: 6.5,
  declarationBacklog: 45,
  inspectionQueueSize: 8,
  metadata: {},
  recordedAt: new Date(),
};

describe("geospatial router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getPortCount).mockResolvedValue(5);
    vi.mocked(db.getCongestionCount).mockResolvedValue(5);
    vi.mocked(db.seedPortLocations).mockResolvedValue(undefined);
    vi.mocked(db.seedCongestionEvents).mockResolvedValue(undefined);
  });

  describe("listPorts", () => {
    it("returns an array for authenticated user", async () => {
      vi.mocked(db.listPortLocations).mockResolvedValue([mockPort]);
      const caller = appRouter.createCaller(createCtx(mockUser));
      const result = await caller.geospatial.listPorts();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].portCode).toBe("GHTEM");
    });

    it("accepts optional country filter", async () => {
      vi.mocked(db.listPortLocations).mockResolvedValue([mockPort]);
      const caller = appRouter.createCaller(createCtx(mockUser));
      const result = await caller.geospatial.listPorts({ country: "GHA" });
      expect(db.listPortLocations).toHaveBeenCalledWith({ country: "GHA" });
      expect(Array.isArray(result)).toBe(true);
    });

    it("rejects unauthenticated requests", async () => {
      const caller = appRouter.createCaller(createCtx(null));
      await expect(caller.geospatial.listPorts()).rejects.toThrow();
    });
  });

  describe("portCongestionHistory", () => {
    it("returns an array for a valid portCode", async () => {
      vi.mocked(db.getPortCongestionHistory).mockResolvedValue([mockCongestionEvent]);
      const caller = appRouter.createCaller(createCtx(mockUser));
      const result = await caller.geospatial.portCongestionHistory({ portCode: "GHTEM", hours: 24 });
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].portCode).toBe("GHTEM");
    });

    it("passes the correct time window", async () => {
      vi.mocked(db.getPortCongestionHistory).mockResolvedValue([]);
      const caller = appRouter.createCaller(createCtx(mockUser));
      await caller.geospatial.portCongestionHistory({ portCode: "SGSIN", hours: 48 });
      expect(db.getPortCongestionHistory).toHaveBeenCalledWith("SGSIN", expect.any(Date));
    });
  });

  describe("listVessels", () => {
    it("returns an array for authenticated user", async () => {
      vi.mocked(db.listVesselTracking).mockResolvedValue([]);
      const caller = appRouter.createCaller(createCtx(mockUser));
      const result = await caller.geospatial.listVessels({ limit: 10 });
      expect(Array.isArray(result)).toBe(true);
    });

    it("accepts optional destinationPort filter", async () => {
      vi.mocked(db.listVesselTracking).mockResolvedValue([]);
      const caller = appRouter.createCaller(createCtx(mockUser));
      await caller.geospatial.listVessels({ destinationPort: "GHTEM", limit: 20 });
      expect(db.listVesselTracking).toHaveBeenCalledWith({ destinationPort: "GHTEM", limit: 20 });
    });
  });

  describe("heatmapData", () => {
    it("returns an array of port heatmap entries", async () => {
      vi.mocked(db.getHeatmapData).mockResolvedValue([{
        portCode: "GHTEM",
        portName: "Tema Port",
        latitude: 5.6333,
        longitude: -0.0167,
        congestionStatus: "moderate" as const,
        vesselCount: 12,
        waitTimeHours: 6.5,
        declarationBacklog: 45,
        recordedAt: new Date(),
      }]);
      const caller = appRouter.createCaller(createCtx(mockUser));
      const result = await caller.geospatial.heatmapData();
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].portCode).toBe("GHTEM");
      expect(result[0].lat).toBe(5.6333);
      expect(typeof result[0].weight).toBe("number");
    });
  });

  describe("recordCongestion", () => {
    it("allows authenticated user to record congestion", async () => {
      vi.mocked(db.insertCongestionEvent).mockResolvedValue(mockCongestionEvent);
      const caller = appRouter.createCaller(createCtx(mockUser));
      const result = await caller.geospatial.recordCongestion({
        portCode: "GHTEM",
        congestionStatus: "moderate",
        vesselCount: 12,
        waitTimeHours: 6.5,
      });
      expect(result.portCode).toBe("GHTEM");
      expect(result.congestionStatus).toBe("moderate");
    });
  });

  describe("addPort", () => {
    it("allows admin to add a new port", async () => {
      vi.mocked(db.insertPortLocation).mockResolvedValue(mockPort);
      const caller = appRouter.createCaller(createCtx(mockAdminUser));
      const result = await caller.geospatial.addPort({
        portCode: "NEWPT",
        portName: "New Port",
        country: "GHA",
        latitude: 5.0,
        longitude: -0.5,
        portType: "seaport",
      });
      expect(result.portCode).toBe("GHTEM");
    });

    it("rejects non-admin users", async () => {
      const caller = appRouter.createCaller(createCtx(mockUser));
      await expect(
        caller.geospatial.addPort({
          portCode: "NEWPT",
          portName: "New Port",
          country: "GHA",
          latitude: 5.0,
          longitude: -0.5,
          portType: "seaport",
        })
      ).rejects.toThrow();
    });
  });
});
