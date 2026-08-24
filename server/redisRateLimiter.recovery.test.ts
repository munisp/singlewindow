import { beforeEach, describe, expect, it, vi } from "vitest";

type RedisTestState = { available: boolean; instances: any[] };
function getRedisTestState(): RedisTestState {
  const global = globalThis as typeof globalThis & { __redisTestState?: RedisTestState };
  return global.__redisTestState ??= { available: true, instances: [] };
}

vi.mock("ioredis", () => {
  const redisState = getRedisTestState();
  class MockRedis {
    status = "connecting";
    eval = vi.fn().mockResolvedValue(1);
    get = vi.fn().mockResolvedValue(null);
    set = vi.fn().mockResolvedValue("OK");
    ping = vi.fn().mockResolvedValue("PONG");
    listeners = new Map<string, Set<(...args: any[]) => void>>();

    on(event: string, listener: (...args: any[]) => void) {
      const listeners = this.listeners.get(event) ?? new Set();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    once(event: string, listener: (...args: any[]) => void) {
      const wrapped = (...args: any[]) => {
        this.removeListener(event, wrapped);
        listener(...args);
      };
      return this.on(event, wrapped);
    }

    removeListener(event: string, listener: (...args: any[]) => void) {
      this.listeners.get(event)?.delete(listener);
      return this;
    }

    emit(event: string, ...args: any[]) {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
      return true;
    }

    constructor() {
      (redisState.instances as any[]).push(this);
      if (redisState.available) {
        queueMicrotask(() => {
          this.status = "ready";
          this.emit("ready");
        });
      }
    }

    quit = vi.fn(async () => {
      this.status = "end";
      this.emit("end");
    });
  }

  return { default: MockRedis };
});

const redisState = getRedisTestState();

beforeEach(() => {
  redisState.available = true;
  redisState.instances.length = 0;
});

describe("Redis availability recovery", () => {
  it("waits for a healthy client during the first call after initialization", async () => {
    vi.resetModules();
    const { closeRedis, incrementRateLimit } = await import("./_core/redisRateLimiter");

    await expect(incrementRateLimit("cold-start", 60_000)).resolves.toBe(1);
    const instances = redisState.instances as any[];
    expect(instances).toHaveLength(1);
    expect(instances[0].eval).toHaveBeenCalledOnce();

    await closeRedis();
  });

  it("falls back promptly while Redis remains unavailable", async () => {
    redisState.available = false;
    vi.resetModules();
    const { closeRedis, incrementRateLimit } = await import("./_core/redisRateLimiter");

    const startedAt = Date.now();
    await expect(incrementRateLimit("partition", 60_000)).resolves.toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(1_000);

    await closeRedis();
  });

  it("recovers session revocation checks after a transient Redis outage", async () => {
    vi.resetModules();
    const { closeRedis, incrementRateLimit, isSessionRevoked } = await import("./_core/redisRateLimiter");

    await incrementRateLimit("recovery", 60_000);
    const redis = (redisState.instances as any[])[0];
    redis.status = "reconnecting";
    const outageCheck = isSessionRevoked("session-001");
    queueMicrotask(() => redis.emit("error", new Error("Redis unavailable")));
    await expect(outageCheck).rejects.toThrow("Redis unavailable");

    const recoveryCheck = isSessionRevoked("session-001");
    queueMicrotask(() => {
      redis.status = "ready";
      redis.emit("ready");
    });
    await expect(recoveryCheck).resolves.toBe(false);

    await closeRedis();
  });
});
