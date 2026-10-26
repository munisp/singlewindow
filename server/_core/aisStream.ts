/**
 * Phase 33: AIS live vessel-position ingestion worker (aisstream.io).
 *
 * Fail-closed / opt-in: startAisStream() is a no-op unless AISSTREAM_API_KEY
 * is set. The worker never crashes the host process — socket errors are
 * logged and the connection is retried with backoff. Positions are upserted
 * into ais_vessel_positions (one row per MMSI, latest wins).
 */
import WebSocket from "ws";
import { getDb } from "../db";
import { aisVesselPositions } from "../../drizzle/schema";

// Gulf of Guinea bounding box: [[latMin, lonMin], [latMax, lonMax]]
const BOUNDING_BOXES: number[][][] = [[[2.5, -6.0], [8.5, 10.5]]];
const RETRY_MS = 15_000;

let started = false;

export function startAisStream(): void {
  if (started) return;
  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) {
    console.log("[AIS] AISSTREAM_API_KEY not set — live vessel streaming disabled (fail-closed)");
    return;
  }
  started = true;
  connect(apiKey);
}

function connect(apiKey: string): void {
  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");

  ws.on("open", () => {
    console.log("[AIS] connected to aisstream.io — subscribing Gulf of Guinea");
    ws.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: BOUNDING_BOXES, FilterMessageTypes: ["PositionReport"] }));
  });

  ws.on("message", (raw: WebSocket.RawData) => {
    void handleMessage(raw);
  });

  ws.on("error", (err) => {
    console.error("[AIS] stream error:", err instanceof Error ? err.message : err);
  });

  ws.on("close", () => {
    console.warn(`[AIS] stream closed — reconnecting in ${RETRY_MS / 1000}s`);
    setTimeout(() => connect(apiKey), RETRY_MS);
  });
}

async function handleMessage(raw: WebSocket.RawData): Promise<void> {
  let msg: any;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return; // non-JSON frame — ignore
  }
  const report = msg?.Message?.PositionReport;
  if (!report) return;
  const mmsi = String(report.UserID ?? "");
  const lat = Number(report.Latitude);
  const lon = Number(report.Longitude);
  if (!mmsi || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

  try {
    const db = await getDb();
    if (!db) return; // DB unavailable — drop the frame, keep streaming
    await db
      .insert(aisVesselPositions)
      .values({
        mmsi,
        shipName: typeof msg?.MetaData?.ShipName === "string" ? msg.MetaData.ShipName.trim() : null,
        lat,
        lon,
        sog: Number.isFinite(Number(report.Sog)) ? Number(report.Sog) : null,
        cog: Number.isFinite(Number(report.Cog)) ? Number(report.Cog) : null,
        navStatus: report.NavigationalStatus != null ? String(report.NavigationalStatus) : null,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: aisVesselPositions.mmsi,
        set: {
          shipName: typeof msg?.MetaData?.ShipName === "string" ? msg.MetaData.ShipName.trim() : null,
          lat,
          lon,
          sog: Number.isFinite(Number(report.Sog)) ? Number(report.Sog) : null,
          cog: Number.isFinite(Number(report.Cog)) ? Number(report.Cog) : null,
          navStatus: report.NavigationalStatus != null ? String(report.NavigationalStatus) : null,
          lastSeenAt: new Date(),
        },
      });
  } catch (err) {
    console.error("[AIS] position upsert failed:", err instanceof Error ? err.message : err);
  }
}
