import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as any[],
  queryError: null as Error | null,
  shipment: {
    declaration: { bill_of_lading_id: null as number | null, bill_of_lading_number: null as string | null },
    bills: [] as any[],
    manifest: null as any,
    distinctVessels: [] as any[],
    ais: [] as any[],
  },
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getDb: vi.fn(async () => ({})),
    getPool: vi.fn(() => ({
      query: vi.fn(async (query: string) => {
        if (state.queryError) throw state.queryError;
        if (query.includes("FROM declarations")) return { rows: state.shipment.declaration ? [state.shipment.declaration] : [] };
        if (query.includes("FROM bills_of_lading")) return { rows: state.shipment.bills };
        if (query.includes("SELECT vessel_name, mmsi, imo")) return { rows: state.shipment.manifest ? [state.shipment.manifest] : [] };
        if (query.includes("SELECT DISTINCT mmsi")) return { rows: state.shipment.distinctVessels };
        if (query.includes("FROM vessel_tracking_events") && query.includes("LIMIT 1")) return { rows: state.shipment.ais };
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
  state.shipment = {
    declaration: { bill_of_lading_id: null, bill_of_lading_number: null },
    bills: [],
    manifest: null,
    distinctVessels: [],
    ais: [],
  };
});

describe("persisted cargo tracking", () => {
  async function track(headers: Record<string, string> = {}) {
    const { cargoTrackingRouter } = await import("./routers/cargoTracking");
    return cargoTrackingRouter.createCaller({ req: { headers, socket: {} } } as any).getShipmentPosition({ declarationRef: "TG-2026-TRACK01" });
  }

  it("returns NOT_FOUND for an unknown declaration reference", async () => {
    state.shipment.declaration = null as any;
    await expect(track()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports a declaration that is not yet linked to a bill of lading", async () => {
    await expect(track()).resolves.toMatchObject({ trackingStatus: "not_linked", reason: "bill_of_lading_not_linked" });
  });

  it("reports a filed bill of lading without an available manifest", async () => {
    state.shipment.declaration = { bill_of_lading_id: 7, bill_of_lading_number: "BL-7" };
    state.shipment.bills = [{ id: 7, manifest_id: 11, bl_number: "BL-7" }];
    await expect(track()).resolves.toMatchObject({ trackingStatus: "unavailable", reason: "bill_of_lading_not_in_manifest" });
  });

  it("reports an ambiguous bill of lading reference distinctly from a missing manifest", async () => {
    state.shipment.declaration = { bill_of_lading_id: null, bill_of_lading_number: "BL-7" };
    state.shipment.bills = [
      { id: 7, manifest_id: 11, bl_number: "BL-7" },
      { id: 8, manifest_id: 12, bl_number: "BL-7" },
    ];
    await expect(track()).resolves.toMatchObject({ trackingStatus: "unavailable", reason: "ambiguous_bill_of_lading" });
  });

  it("reports a manifest without an identifier or unambiguous AIS name match", async () => {
    state.shipment.declaration = { bill_of_lading_id: 7, bill_of_lading_number: "BL-7" };
    state.shipment.bills = [{ id: 7, manifest_id: 11, bl_number: "BL-7" }];
    state.shipment.manifest = { vessel_name: "MV Unknown", mmsi: null, imo: null, eta: null, port_of_discharge: "Lagos" };
    await expect(track()).resolves.toMatchObject({ trackingStatus: "unavailable", reason: "vessel_identifier_missing" });
  });

  it("reports ambiguous vessel-name fallback matches as unavailable", async () => {
    state.shipment.declaration = { bill_of_lading_id: 7, bill_of_lading_number: "BL-7" };
    state.shipment.bills = [{ id: 7, manifest_id: 11, bl_number: "BL-7" }];
    state.shipment.manifest = { vessel_name: "MV Duplicate", mmsi: null, imo: null, eta: null, port_of_discharge: "Lagos" };
    state.shipment.distinctVessels = [{ mmsi: "111" }, { mmsi: "222" }];
    await expect(track()).resolves.toMatchObject({ trackingStatus: "unavailable", reason: "ambiguous_vessel_name" });
  });

  it("reports a resolved vessel with no AIS position as unavailable", async () => {
    state.shipment.declaration = { bill_of_lading_id: 7, bill_of_lading_number: "BL-7" };
    state.shipment.bills = [{ id: 7, manifest_id: 11, bl_number: "BL-7" }];
    state.shipment.manifest = { vessel_name: "MV No Fix", mmsi: "123", imo: null, eta: null, port_of_discharge: "Lagos" };
    await expect(track()).resolves.toMatchObject({ trackingStatus: "unavailable", reason: "no_ais_position" });
  });

  it("returns an identifier-derived AIS position without consignment data", async () => {
    state.shipment.declaration = { bill_of_lading_id: 7, bill_of_lading_number: "BL-7" };
    state.shipment.bills = [{ id: 7, manifest_id: 11, bl_number: "BL-7" }];
    state.shipment.manifest = { vessel_name: "MV Identified", mmsi: "123", imo: "IMO123", eta: new Date("2030-01-01T00:00:00.000Z"), port_of_discharge: "Lagos" };
    state.shipment.ais = [{
      mmsi: "123", vessel_name: "MV Identified", imo_number: "IMO123", latitude: 6.4, longitude: 3.4,
      speed: null, heading: null, destination_port: "Lagos", eta: null, cargo_type: null, flag_country: null,
      recorded_at: new Date("2026-01-01T00:00:00.000Z"),
    }];
    const result = await track();
    expect(result).toMatchObject({ trackingStatus: "position", latitude: 6.4, longitude: 3.4, linkage: "identifier-derived" });
    expect(result).not.toHaveProperty("consignee");
    expect(result).not.toHaveProperty("goodsDescription");
  });

  it("returns a name-matched AIS position only when the name resolves uniquely", async () => {
    state.shipment.declaration = { bill_of_lading_id: 7, bill_of_lading_number: "BL-7" };
    state.shipment.bills = [{ id: 7, manifest_id: 11, bl_number: "BL-7" }];
    state.shipment.manifest = { vessel_name: "MV Named", mmsi: null, imo: null, eta: null, port_of_discharge: "Lagos" };
    state.shipment.distinctVessels = [{ mmsi: "123" }];
    state.shipment.ais = [{
      mmsi: "123", vessel_name: "MV Named", imo_number: null, latitude: 6.5, longitude: 3.5,
      speed: 10, heading: 90, destination_port: "Lagos", eta: null, cargo_type: null, flag_country: null,
      recorded_at: new Date("2026-01-02T00:00:00.000Z"),
    }];
    await expect(track()).resolves.toMatchObject({ trackingStatus: "position", latitude: 6.5, longitude: 3.5, linkage: "name-matched" });
  });

  it("rate-limits public shipment lookups by IP", async () => {
    const headers = { "x-forwarded-for": `shipment-rate-test-${Date.now()}` };
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await expect(track(headers)).resolves.toMatchObject({ trackingStatus: "not_linked" });
    }
    await expect(track(headers)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

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
    await expect(track()).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
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
