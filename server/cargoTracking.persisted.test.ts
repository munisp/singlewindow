import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as any[], queryError: null as Error | null }));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getDb: vi.fn(async () => ({})),
    getPool: vi.fn(() => ({
      query: vi.fn(async (query: string) => {
        if (state.queryError) throw state.queryError;
        if (query.includes("COUNT(DISTINCT mmsi)")) {
          return {
            rows: state.rows.length
              ? [{ total: String(state.rows.length), moored: "0", anchored: "0", underway: String(state.rows.length), red_flag: "0", amber_flag: "0" }]
              : [{ total: "0", moored: "0", anchored: "0", underway: "0", red_flag: "0", amber_flag: "0" }],
          };
        }
        return { rows: state.rows };
      }),
    })),
  };
});

vi.mock("./_core/kafka", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_core/kafka")>();
  return { ...actual, publishEvent: vi.fn() };
});

afterEach(() => {
  state.rows = [];
  state.queryError = null;
});

describe("persisted cargo tracking", () => {
  it("returns persisted vessel events without fabricating shipment or port metadata", async () => {
    const { cargoTrackingRouter } = await import("./routers/cargoTracking");
    state.rows = [{
      mmsi: "123456789",
      vessel_name: "Persisted Vessel",
      imo_number: "IMO123",
      latitude: 6.4,
      longitude: 3.4,
      speed: 12,
      heading: 90,
      destination_port: "Lagos",
      eta: new Date("2030-01-01T00:00:00.000Z"),
      cargo_type: "container",
      flag_country: "NG",
      recorded_at: new Date("2026-01-01T00:00:00.000Z"),
    }];
    const caller = cargoTrackingRouter.createCaller({} as any);
    const result = await caller.getLiveVessels({ riskFilter: "all", statusFilter: "all" });
    expect(result.vessels).toHaveLength(1);
    expect(result.vessels[0]).toMatchObject({
      mmsi: "123456789",
      vesselName: "Persisted Vessel",
      lat: 6.4,
      riskFlag: null,
      cargoStatus: null,
      callSign: null,
      draught: null,
      length: null,
      originLat: null,
      originLon: null,
    });
    expect(result.vessels[0].declarationRef).toBeNull();
    expect(result.sourceService).toBe("vessel_tracking_events");
  });

  it("returns successful empty results when no persisted tracking rows exist", async () => {
    const { cargoTrackingRouter } = await import("./routers/cargoTracking");
    const caller = cargoTrackingRouter.createCaller({} as any);
    await expect(caller.getLiveVessels({ riskFilter: "all", statusFilter: "all" }))
      .resolves.toMatchObject({ vessels: [], totalCount: 0, sourceService: "vessel_tracking_events" });
    await expect(caller.searchVessels({ q: "missing" })).resolves.toEqual([]);
    await expect(caller.getVesselRoute({ mmsi: "missing" }))
      .resolves.toMatchObject({ waypoints: [], vessel: null, sourceService: "vessel_tracking_events" });
    await expect(caller.getVesselStats())
      .resolves.toMatchObject({ total: 0, redFlag: null, amberFlag: null, greenFlag: null, withDeclaration: null });
  });

  it("maps persisted query failures to service unavailability", async () => {
    const { cargoTrackingRouter } = await import("./routers/cargoTracking");
    state.queryError = new Error("database offline");
    const caller = cargoTrackingRouter.createCaller({} as any);
    await expect(caller.getLiveVessels({ riskFilter: "all", statusFilter: "all" }))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("does not report cargo-event success when Kafka publication fails", async () => {
    const kafka = await import("./_core/kafka");
    const publish = vi.mocked(kafka.publishEvent).mockRejectedValueOnce(new Error("Kafka offline"));
    const { cargoTrackingRouter } = await import("./routers/cargoTracking");
    const caller = cargoTrackingRouter.createCaller({
      user: { id: 42 },
      req: { method: "GET" },
    } as any);
    await expect(caller.logCargoEvent({
      mmsi: "123456789",
      vesselName: "Persisted Vessel",
      eventType: "arrived",
      portCode: "NGAPP",
    })).rejects.toThrow("Kafka offline");
    expect(publish).toHaveBeenCalledOnce();
  });
});
