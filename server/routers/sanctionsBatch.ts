import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { sanctionsBatchJobs } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { storagePut } from "../storage";

export const sanctionsBatchRouter = router({
  list: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    return db.select().from(sanctionsBatchJobs).orderBy(desc(sanctionsBatchJobs.createdAt)).limit(50);
  }),

  create: adminProcedure
    .input(z.object({ fileName: z.string(), fileBase64: z.string(), totalRows: z.number().int().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const buf = Buffer.from(input.fileBase64, "base64");
      const key = `sanctions-batch/${ctx.user.id}-${Date.now()}-${input.fileName}`;
      const { url } = await storagePut(key, buf, "text/csv");
      const [created] = await db.insert(sanctionsBatchJobs).values({
        submittedBy: ctx.user.id,
        fileName: input.fileName,
        fileUrl: url,
        fileKey: key,
        totalRows: input.totalRows ?? 0,
        status: "pending",
      }).returning({ id: sanctionsBatchJobs.id });
      return { id: created.id, fileUrl: url };
    }),

  getStatus: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [job] = await db.select().from(sanctionsBatchJobs).where(eq(sanctionsBatchJobs.id, input.id)).limit(1);
      return job ?? null;
    }),
});
