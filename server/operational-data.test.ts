import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn();
const values = vi.fn();
const onConflictDoNothing = vi.fn();

vi.mock("./db", () => ({
  getDb: vi.fn(async () => ({ insert })),
}));

describe("operational data safeguards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onConflictDoNothing.mockResolvedValue([]);
    values.mockReturnValue({ onConflictDoNothing });
    insert.mockReturnValue({ values });
  });

  it("persists WAF events through an event-id deduplicating insert", async () => {
    const { handleWafMessage } = await import("./kafkaConsumer");

    const event = {
      event_id: "waf-test-1",
      severity: "high",
      attack_type: "XSS",
      source_ip: "192.0.2.1",
    };
    await handleWafMessage(event);
    await handleWafMessage(event);

    expect(insert).toHaveBeenCalledTimes(2);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "waf-test-1",
      severity: "high",
      attackType: "XSS",
    }));
    expect(onConflictDoNothing).toHaveBeenCalledWith(expect.objectContaining({ target: expect.anything() }));
  });

  it("classifies offset reports outside the freshness window as stale", async () => {
    const { classifyOffsetFreshness } = await import("./routers/fluvio");
    const now = Date.now();
    expect(classifyOffsetFreshness(new Date(now - 299_999), now)).toBe("current");
    expect(classifyOffsetFreshness(new Date(now - 300_001), now)).toBe("stale");
  });

  it("rejects WAF events outside the declared severity and attack-type sets", async () => {
    const { handleWafMessage } = await import("./kafkaConsumer");

    await handleWafMessage({
      event_id: "waf-invalid-severity",
      severity: "urgent",
      attack_type: "XSS",
    });
    await handleWafMessage({
      event_id: "waf-invalid-attack",
      severity: "high",
      attack_type: "MADE_UP_ATTACK",
    });

    expect(insert).not.toHaveBeenCalled();
  });
});
