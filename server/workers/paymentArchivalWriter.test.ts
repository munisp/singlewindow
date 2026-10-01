/**
 * paymentArchivalWriter.test.ts — Phase 22 lakehouse archival writer
 *
 * Runs without a live DB or RustFS: ../db and @aws-sdk/client-s3 are mocked.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ─── Chainable drizzle mock ─────────────────────────────────────────────────

type JobRow = {
  id: number;
  jobId: string;
  tier: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
};

const job: JobRow = {
  id: 7,
  jobId: "archival-warm-2026-10-01-abcd1234",
  tier: "warm",
  periodStart: new Date("2026-09-01T00:00:00Z"),
  periodEnd: new Date("2026-09-24T00:00:00Z"),
  status: "pending",
};

const queueRow = {
  id: 42,
  transferId: "txn-123",
  debitAccountId: "NCS_REVENUE",
  creditAccountId: "TRADER_ESCROW_1",
  amountMinorUnits: BigInt(125050),
  currency: "GHS",
  ledger: "primary",
  attemptCount: 1,
  committedAt: new Date("2026-09-10T12:00:00Z"),
  createdAt: new Date("2026-09-10T11:59:00Z"),
};

let selectQueue: unknown[][];
let capturedSets: Record<string, unknown>[];
let claimRows: JobRow[];

function makeDb() {
  return {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => selectQueue.shift() ?? [],
          }),
        }),
      }),
    })),
    update: vi.fn(() => ({
      set: (vals: Record<string, unknown>) => {
        capturedSets.push(vals);
        return {
          where: () => {
            const isClaim = vals.status === "running";
            const result = Promise.resolve([]);
            return Object.assign(result, {
              returning: async () => (isClaim ? claimRows : []),
            });
          },
        };
      },
    })),
  };
}

let mockDb: ReturnType<typeof makeDb>;
let s3Send: ReturnType<typeof vi.fn>;

vi.mock("../db", () => ({
  getDb: async () => mockDb,
}));

vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class S3Client {
    send = (cmd: unknown) => s3Send(cmd);
  }
  return { S3Client, PutObjectCommand };
});

async function importWriter(bucket: string) {
  vi.stubEnv("PAYMENT_ARCHIVE_SINK_BUCKET", bucket);
  vi.stubEnv("RUSTFS_ACCESS_KEY", "test-ak");
  vi.stubEnv("RUSTFS_SECRET_KEY", "test-sk");
  vi.resetModules();
  return import("./paymentArchivalWriter");
}

beforeEach(() => {
  mockDb = makeDb();
  s3Send = vi.fn(async () => ({}));
  selectQueue = [];
  capturedSets = [];
  claimRows = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("paymentArchivalWriter", () => {
  it("is disabled with a single log line when PAYMENT_ARCHIVE_SINK_BUCKET is unset", async () => {
    const mod = await importWriter("");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mod.startPaymentArchivalWriter();
    expect(mod.getPaymentArchivalWriterStatus().enabled).toBe(false);
    expect(mod.getPaymentArchivalWriterStatus().running).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("PAYMENT_ARCHIVE_SINK_BUCKET not set"),
    );
    expect(await mod.runPaymentArchivalWriterCycle()).toBe(0);
    logSpy.mockRestore();
    mod.stopPaymentArchivalWriter();
  });

  it("claims a pending job idempotently, writes CSV, and marks completed with the REAL uri/bytes/count", async () => {
    const mod = await importWriter("payment-archive-bucket");
    selectQueue = [[{ id: 7 }], [queueRow]]; // pending ids, then export rows
    claimRows = [{ ...job }];

    const processed = await mod.runPaymentArchivalWriterCycle();
    expect(processed).toBe(1);

    // Claim happened via status='running'
    expect(capturedSets[0]).toEqual({ status: "running" });

    // The sink received the CSV at the tier/date/jobId key in the configured bucket
    expect(s3Send).toHaveBeenCalledTimes(1);
    const cmd = s3Send.mock.calls[0][0] as { input: { Bucket: string; Key: string; Body: Buffer; ContentType: string } };
    expect(cmd.input.Bucket).toBe("payment-archive-bucket");
    expect(cmd.input.Key).toMatch(/^warm\/\d{4}-\d{2}-\d{2}\/archival-warm-2026-10-01-abcd1234\.csv$/);
    expect(cmd.input.ContentType).toBe("text/csv");
    const csvText = cmd.input.Body.toString("utf8");
    expect(csvText).toContain("txn-123");
    expect(csvText).toContain("125050"); // bigint preserved as exact integer string

    // Completion recorded with real values derived from the actual payload
    const completion = capturedSets[1] as {
      status: string;
      storageUri: string;
      bytesWritten: bigint;
      transfersArchived: number;
    };
    expect(completion.status).toBe("completed");
    expect(completion.storageUri).toBe(`s3://payment-archive-bucket/${cmd.input.Key}`);
    expect(completion.bytesWritten).toBe(BigInt(Buffer.byteLength(csvText, "utf8")));
    expect(completion.transfersArchived).toBe(1);
  });

  it("marks the job failed with errorMessage and NEVER writes a storageUri on sink error", async () => {
    const mod = await importWriter("payment-archive-bucket");
    selectQueue = [[{ id: 7 }], [queueRow]];
    claimRows = [{ ...job }];
    s3Send.mockRejectedValueOnce(new Error("NoSuchBucket: payment-archive-bucket"));

    const processed = await mod.runPaymentArchivalWriterCycle();
    expect(processed).toBe(0);

    const failure = capturedSets[1] as Record<string, unknown>;
    expect(failure.status).toBe("failed");
    expect(String(failure.errorMessage)).toContain("NoSuchBucket");
    expect(failure.storageUri).toBeUndefined(); // no fake URI, ever
  });

  it("skips a job another worker already claimed (0-row claim)", async () => {
    const mod = await importWriter("payment-archive-bucket");
    selectQueue = [[{ id: 7 }]];
    claimRows = []; // concurrent worker won the claim

    const processed = await mod.runPaymentArchivalWriterCycle();
    expect(processed).toBe(0);
    expect(s3Send).not.toHaveBeenCalled();
    expect(capturedSets).toHaveLength(1); // only the claim attempt
  });
});
