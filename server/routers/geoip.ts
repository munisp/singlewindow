import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../_core/trpc";

// ─── Dev-mode seed job stubs ──────────────────────────────────────────────────
const DEV_SEED_JOBS = [
  {
    id: 1,
    jobId: "seed-001",
    filename: "GeoLite2-City-Blocks-IPv4.csv",
    s3Key: "geoip/GeoLite2-City-Blocks-IPv4.csv",
    status: "completed",
    rowsInserted: 3_420_000,
    rowsSkipped: 1_200,
    rowsTotal: 3_421_200,
    errorMessage: null,
    triggeredBy: "admin",
    startedAt: new Date(Date.now() - 3_600_000),
    completedAt: new Date(Date.now() - 3_540_000),
    durationMs: 60_000,
    createdAt: new Date(Date.now() - 3_600_000),
  },
  {
    id: 2,
    jobId: "seed-002",
    filename: "GeoLite2-ASN-Blocks-IPv4.csv",
    s3Key: "geoip/GeoLite2-ASN-Blocks-IPv4.csv",
    status: "completed",
    rowsInserted: 890_000,
    rowsSkipped: 400,
    rowsTotal: 890_400,
    errorMessage: null,
    triggeredBy: "admin",
    startedAt: new Date(Date.now() - 7_200_000),
    completedAt: new Date(Date.now() - 7_140_000),
    durationMs: 60_000,
    createdAt: new Date(Date.now() - 7_200_000),
  },
];

export const geoipRouter = router({
  /**
   * uploadGeoipCsv — initiate a GeoLite2 CSV seed job from an S3 key.
   * In production this would enqueue a background worker to parse the CSV
   * and bulk-insert rows into geoip_cache. Here we record the job and return
   * a job ID for polling.
   */
  uploadGeoipCsv: adminProcedure
    .input(
      z.object({
        filename: z.string().min(1).max(256),
        s3Key: z.string().min(1).max(512),
        triggeredBy: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const jobId = `seed-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`;
      if (process.env.NODE_ENV !== "production") {
        return {
          jobId,
          status: "pending",
          message: `Seed job ${jobId} queued for ${input.filename} (dev stub)`,
        };
      }
      const { createGeoipSeedJob } = await import("../db");
      await createGeoipSeedJob({
        jobId,
        filename: input.filename,
        s3Key: input.s3Key,
        status: "pending",
        triggeredBy: input.triggeredBy ?? ctx.user.name ?? "admin",
      });
      return { jobId, status: "pending", message: `Seed job ${jobId} queued for ${input.filename}` };
    }),

  /**
   * getSeedJobs — paginated list of all seed jobs.
   */
  getSeedJobs: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) }))
    .query(async ({ input }) => {
      if (process.env.NODE_ENV !== "production") {
        return { jobs: DEV_SEED_JOBS, total: DEV_SEED_JOBS.length };
      }
      const { getGeoipSeedJobs } = await import("../db");
      const jobs = await getGeoipSeedJobs(input.limit, input.offset);
      return { jobs, total: jobs.length };
    }),

  /**
   * getSeedJobById — fetch a single seed job by its jobId.
   */
  getSeedJobById: adminProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ input }) => {
      if (process.env.NODE_ENV !== "production") {
        const job = DEV_SEED_JOBS.find((j) => j.jobId === input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: `Seed job ${input.jobId} not found` });
        return job;
      }
      const { getGeoipSeedJobById } = await import("../db");
      const job = await getGeoipSeedJobById(input.jobId);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: `Seed job ${input.jobId} not found` });
      return job;
    }),

  /**
   * getGeoipStats — summary of geoip_cache and seed job counts.
   */
  getGeoipStats: adminProcedure
    .query(async () => {
      if (process.env.NODE_ENV !== "production") {
        return {
          totalIps: 4_310_000,
          countriesCount: 249,
          asnsCount: 72_000,
          seedJobs: { total: 2, completed: 2, failed: 0, pending: 0, totalRowsInserted: 4_310_000 },
          lastSeedAt: new Date(Date.now() - 3_540_000),
        };
      }
      const { getGeoipSeedStats } = await import("../db");
      const seedStats = await getGeoipSeedStats();
      return {
        totalIps: seedStats.totalRowsInserted,
        countriesCount: null,
        asnsCount: null,
        seedJobs: seedStats,
        lastSeedAt: null,
      };
    }),

  /**
   * lookupIp — look up geolocation for a single IP address.
   */
  lookupIp: adminProcedure
    .input(z.object({ ip: z.string().min(7).max(45) }))
    .query(async ({ input }) => {
      if (process.env.NODE_ENV !== "production") {
        return {
          ip: input.ip,
          country: "Singapore",
          countryCode: "SG",
          city: "Singapore",
          asn: "AS4657",
          asnOrg: "StarHub Ltd",
          countryFlag: "🇸🇬",
        };
      }
      const { getGeoIp } = await import("../db");
      const geo = await getGeoIp(input.ip);
      if (!geo) throw new TRPCError({ code: "NOT_FOUND", message: `No geolocation data for ${input.ip}` });
      return geo;
    }),
});
