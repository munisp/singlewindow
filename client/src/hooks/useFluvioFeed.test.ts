/**
 * Phase 17 (G4/G8) — WS URL resolution tests for useFluvioFeed.
 */
import { describe, it, expect } from "vitest";
import { resolveFluvioWsUrl } from "./useFluvioFeed";

const httpsLoc = { protocol: "https:", host: "trade.gov.ng" };
const httpLoc = { protocol: "http:", host: "localhost:5173" };

describe("resolveFluvioWsUrl", () => {
  it("honours an explicit env URL", () => {
    expect(resolveFluvioWsUrl("wss://fluvio.internal/ws", httpsLoc)).toBe("wss://fluvio.internal/ws");
  });

  it('"off" disables the feed (honest disabled state)', () => {
    expect(resolveFluvioWsUrl("off", httpsLoc)).toBeNull();
    expect(resolveFluvioWsUrl("OFF", httpsLoc)).toBeNull();
  });

  it("defaults to same-origin wss on https (never ws://localhost)", () => {
    expect(resolveFluvioWsUrl(undefined, httpsLoc)).toBe("wss://trade.gov.ng/ws");
  });

  it("uses ws: only on http dev origins", () => {
    expect(resolveFluvioWsUrl("", httpLoc)).toBe("ws://localhost:5173/ws");
  });

  it("never returns a hardcoded localhost URL in production", () => {
    const url = resolveFluvioWsUrl(undefined, httpsLoc);
    expect(url).not.toContain("localhost");
    expect(url!.startsWith("wss://")).toBe(true);
  });
});
