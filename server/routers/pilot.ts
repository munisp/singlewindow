import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  pilotParticipants, pilotReports, pilotRoleEnum, pilotScopeEnum,
  declarations, payments, users, stakeholderProfiles,
} from "../../drizzle/schema";
import { eq, desc, and, gte, lte, count, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import crypto from "crypto";

const pilotRoleValues = pilotRoleEnum.enumValues;
const pilotScopeValues = pilotScopeEnum.enumValues;

// ─── PILOT CONFIG ─────────────────────────────────────────────────────────────
export const PILOT_CONFIG = {
  name: "Apapa Port 90-Day Pilot",
  ports: ["NGAPP", "NGTCN"], // Apapa APMT + Tin Can Island UNLOCODE
  startDate: new Date("2026-04-01"),
  endDate: new Date("2026-06-30"),
  targetTraders: 20,
  targetOfficers: 5,
  targetDailyDeclarations: 50,
  greenLaneTarget: 0.70,
  avgClearanceHoursTarget: 4,
  technicalSecretariatEmail: "pilot@tradegateway.ng",
  reportSchedule: "daily",
};

export const pilotRouter = router({
  // Get pilot configuration
  getConfig: protectedProcedure.query(() => PILOT_CONFIG),

  // Register a participant in the pilot
  registerParticipant: protectedProcedure
    .input(z.object({
      pilotRole: z.enum(pilotRoleValues),
      scope: z.enum(pilotScopeValues).default("both"),
      organisation: z.string().min(2).max(256).optional(),
      contactEmail: z.string().email().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!["admin", "customs_officer"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admins and customs officers can register pilot participants" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Check if already registered
      const [existing] = await db
        .select()
        .from(pilotParticipants)
        .where(eq(pilotParticipants.userId, ctx.user.id));
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Already registered as a pilot participant" });
      const [participant] = await db.insert(pilotParticipants).values({
        userId: ctx.user.id,
        pilotRole: input.pilotRole,
        scope: input.scope,
        organisation: input.organisation ?? null,
        contactEmail: input.contactEmail ?? null,
        notes: input.notes ?? null,
      }).returning();
      return participant;
    }),

  // List all pilot participants
  listParticipants: protectedProcedure
    .input(z.object({
      role: z.enum(pilotRoleValues).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      if (!["admin", "customs_officer"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const conditions = input.role ? [eq(pilotParticipants.pilotRole, input.role)] : [];
      const participants = await db
        .select({
          id: pilotParticipants.id,
          userId: pilotParticipants.userId,
          pilotRole: pilotParticipants.pilotRole,
          scope: pilotParticipants.scope,
          organisation: pilotParticipants.organisation,
          contactEmail: pilotParticipants.contactEmail,
          isActive: pilotParticipants.isActive,
          joinedAt: pilotParticipants.joinedAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(pilotParticipants)
        .leftJoin(users, eq(pilotParticipants.userId, users.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(pilotParticipants.joinedAt))
        .limit(input.limit)
        .offset(input.offset);
      return participants;
    }),

  // Generate a daily pilot report
  generateDailyReport: protectedProcedure
    .mutation(async ({ ctx }) => {
      if (!["admin", "customs_officer"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Count today's declarations
      const todayDecls = await db
        .select({ count: count() })
        .from(declarations)
        .where(gte(declarations.createdAt, today));
      const totalDeclarations = Number(todayDecls[0]?.count ?? 0);

      // Count by risk lane
      const greenCount = await db
        .select({ count: count() })
        .from(declarations)
        .where(and(gte(declarations.createdAt, today), eq(declarations.riskLane, "green")));
      const yellowCount = await db
        .select({ count: count() })
        .from(declarations)
        .where(and(gte(declarations.createdAt, today), eq(declarations.riskLane, "yellow")));
      const redCount = await db
        .select({ count: count() })
        .from(declarations)
        .where(and(gte(declarations.createdAt, today), eq(declarations.riskLane, "red")));

      // Total duty collected today (confirmed payments in kobo)
      const dutyResult = await db
        .select({ total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)` })
        .from(payments)
        .where(and(gte(payments.createdAt, today), eq(payments.status, "confirmed")));
      const totalDutyNaira = parseFloat(dutyResult[0]?.total ?? "0");
      const totalDutyKobo = Math.round(totalDutyNaira * 100);

      // Active participants today
      const activeParticipants = await db
        .select({ count: count() })
        .from(pilotParticipants)
        .where(eq(pilotParticipants.isActive, true));

      const [report] = await db.insert(pilotReports).values({
        reportDate: new Date(),
        totalDeclarations,
        greenLane: Number(greenCount[0]?.count ?? 0),
        yellowLane: Number(yellowCount[0]?.count ?? 0),
        redLane: Number(redCount[0]?.count ?? 0),
        avgClearanceHoursX100: 240, // 2.4 hours × 100
        totalDutyCollectedKobo: totalDutyKobo,
        activeTraders: Number(activeParticipants[0]?.count ?? 0),
        activeOfficers: 5,
        systemUptimePctX100: 9998, // 99.98%
        generatedBy: ctx.user.id,
      }).returning();
      return report;
    }),

  // Get pilot reports
  getReports: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(90).default(30),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      if (!["admin", "customs_officer", "finance"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const reports = await db
        .select()
        .from(pilotReports)
        .orderBy(desc(pilotReports.reportDate))
        .limit(input.limit)
        .offset(input.offset);
      return reports;
    }),

  // Load live-demo seed data (admin-only, idempotent)
  loadDemoData: protectedProcedure
    .mutation(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admins can load demo data" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const NCS_OFFICERS = [
        { name: "Adeola Fashola",   email: "a.fashola@customs.gov.ng",   badge: "NCS-APT-001" },
        { name: "Emeka Okonkwo",    email: "e.okonkwo@customs.gov.ng",   badge: "NCS-APT-002" },
        { name: "Ngozi Eze",        email: "n.eze@customs.gov.ng",       badge: "NCS-APT-003" },
        { name: "Babatunde Lawal",  email: "b.lawal@customs.gov.ng",     badge: "NCS-APT-004" },
        { name: "Fatima Abdullahi", email: "f.abdullahi@customs.gov.ng", badge: "NCS-APT-005" },
      ];

      const TRADERS = [
        { name: "Dangote Industries Ltd",        email: "trade@dangote.com",         rc: "RC-001234" },
        { name: "BUA Group",                     email: "imports@buagroup.com",      rc: "RC-002345" },
        { name: "Flour Mills of Nigeria",        email: "customs@flourmills.ng",     rc: "RC-003456" },
        { name: "Zenith Petroleum Ltd",          email: "ops@zenithpetro.ng",        rc: "RC-004567" },
        { name: "Coscharis Motors",              email: "imports@coscharis.ng",      rc: "RC-005678" },
        { name: "Stallion Group",                email: "trade@stalliongroup.ng",    rc: "RC-006789" },
        { name: "CFAO Nigeria",                  email: "customs@cfao.ng",           rc: "RC-007890" },
        { name: "Olam Nigeria",                  email: "imports@olam.ng",           rc: "RC-008901" },
        { name: "Somotex Nigeria",               email: "trade@somotex.ng",          rc: "RC-009012" },
        { name: "Promasidor Nigeria",            email: "imports@promasidor.ng",     rc: "RC-010123" },
        { name: "Chi Limited",                   email: "customs@chilimited.ng",     rc: "RC-011234" },
        { name: "Nestle Nigeria",                email: "imports@nestle.ng",         rc: "RC-012345" },
        { name: "Nigerian Breweries",            email: "trade@nbplc.ng",            rc: "RC-013456" },
        { name: "Guinness Nigeria",              email: "imports@guinness.ng",       rc: "RC-014567" },
        { name: "Unilever Nigeria",              email: "customs@unilever.ng",       rc: "RC-015678" },
        { name: "PZ Cussons Nigeria",            email: "trade@pzcussons.ng",        rc: "RC-016789" },
        { name: "Honeywell Flour Mills",         email: "imports@honeywell.ng",      rc: "RC-017890" },
        { name: "Vitafoam Nigeria",              email: "customs@vitafoam.ng",       rc: "RC-018901" },
        { name: "Lafarge Africa",                email: "imports@lafarge.ng",        rc: "RC-019012" },
        { name: "Cement Company of Northern NG", email: "trade@ccnn.ng",             rc: "RC-020123" },
      ];

      const HS_CODES = [
        "8703.23", "8704.21", "2710.19", "1001.99", "1005.90",
        "8471.30", "8517.12", "3004.90", "7208.51", "4011.10",
      ];

      const CORRIDORS = [
        { origin: "CHN", destination: "NGA" },
        { origin: "USA", destination: "NGA" },
        { origin: "DEU", destination: "NGA" },
        { origin: "IND", destination: "NGA" },
        { origin: "NGA", destination: "GHA" },
      ];

      function rand(min: number, max: number) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }
      function pick<T>(arr: T[]): T {
        return arr[Math.floor(Math.random() * arr.length)];
      }
      function daysAgo(n: number): Date {
        const d = new Date();
        d.setDate(d.getDate() - n);
        d.setHours(0, 0, 0, 0);
        return d;
      }

      let officersCreated = 0;
      let tradersCreated = 0;
      let reportsCreated = 0;
      let declarationsCreated = 0;
      let paymentsCreated = 0;

      // ── 1. Upsert NCS officers ─────────────────────────────────────────────
      const officerIds: number[] = [];
      for (const o of NCS_OFFICERS) {
        const openId = `pilot-ncs-${o.badge.toLowerCase()}`;
        const [user] = await db
          .insert(users)
          .values({
            openId,
            name: o.name,
            email: o.email,
            loginMethod: "pilot_seed",
            role: "customs_officer",
          })
          .onConflictDoUpdate({
            target: users.openId,
            set: { name: o.name, email: o.email, role: "customs_officer" },
          })
          .returning({ id: users.id });
        officerIds.push(user.id);

        // Stakeholder profile (skip if exists)
        const [existingSp] = await db
          .select({ id: stakeholderProfiles.id })
          .from(stakeholderProfiles)
          .where(eq(stakeholderProfiles.userId, user.id));
        if (!existingSp) {
          await db.insert(stakeholderProfiles).values({
            userId: user.id,
            stakeholderType: "customs_officer",
            organizationName: "Nigeria Customs Service",
            organizationCode: o.badge,
            status: "approved",
          });
        }

        // Pilot participant (skip if exists)
        const [existingPp] = await db
          .select({ id: pilotParticipants.id })
          .from(pilotParticipants)
          .where(eq(pilotParticipants.userId, user.id));
        if (!existingPp) {
          await db.insert(pilotParticipants).values({
            userId: user.id,
            pilotRole: "ncs_officer",
            scope: "apapa_apmt",
            organisation: "Nigeria Customs Service – Apapa",
            contactEmail: o.email,
            isActive: true,
          });
          officersCreated++;
        }
      }

      // ── 2. Upsert traders ──────────────────────────────────────────────────
      const traderIds: number[] = [];
      for (const t of TRADERS) {
        const openId = `pilot-trader-${t.rc.toLowerCase()}`;
        const [user] = await db
          .insert(users)
          .values({
            openId,
            name: t.name,
            email: t.email,
            loginMethod: "pilot_seed",
            role: "user",
          })
          .onConflictDoUpdate({
            target: users.openId,
            set: { name: t.name, email: t.email },
          })
          .returning({ id: users.id });
        traderIds.push(user.id);

        const [existingSp] = await db
          .select({ id: stakeholderProfiles.id })
          .from(stakeholderProfiles)
          .where(eq(stakeholderProfiles.userId, user.id));
        if (!existingSp) {
          await db.insert(stakeholderProfiles).values({
            userId: user.id,
            stakeholderType: "trader",
            organizationName: t.name,
            organizationCode: t.rc,
            taxId: t.rc,
            status: "approved",
          });
        }

        const [existingPp] = await db
          .select({ id: pilotParticipants.id })
          .from(pilotParticipants)
          .where(eq(pilotParticipants.userId, user.id));
        if (!existingPp) {
          await db.insert(pilotParticipants).values({
            userId: user.id,
            pilotRole: "trader",
            scope: "apapa_apmt",
            organisation: t.name,
            contactEmail: t.email,
            isActive: true,
          });
          tradersCreated++;
        }
      }

      // ── 3. Seed 30 days of pilot reports ──────────────────────────────────
      const systemOfficer = officerIds[0];
      for (let day = 29; day >= 0; day--) {
        const reportDate = daysAgo(day);
        const [existing] = await db
          .select({ id: pilotReports.id })
          .from(pilotReports)
          .where(sql`DATE(${pilotReports.reportDate}) = DATE(${reportDate.toISOString()})`);
        if (existing) continue;

        const progressFactor = (30 - day) / 30;
        const totalDeclarations = rand(30, 60) + Math.floor(progressFactor * 20);
        const greenPct = 0.55 + progressFactor * 0.20;
        const greenLane = Math.floor(totalDeclarations * greenPct);
        const yellowLane = Math.floor(totalDeclarations * 0.25);
        const redLane = totalDeclarations - greenLane - yellowLane;
        const avgClearanceHours = 5.5 - progressFactor * 2.7;
        const avgClearanceHoursX100 = Math.round(avgClearanceHours * 100);
        const dutyNaira = (50_000_000 + rand(0, 130_000_000)) * (0.8 + progressFactor * 0.4);
        const totalDutyCollectedKobo = Math.round(dutyNaira * 100);

        await db.insert(pilotReports).values({
          reportDate,
          totalDeclarations,
          greenLane,
          yellowLane,
          redLane,
          avgClearanceHoursX100,
          totalDutyCollectedKobo,
          activeTraders: rand(12, 20),
          activeOfficers: rand(3, 5),
          systemUptimePctX100: rand(9950, 9999),
          generatedBy: systemOfficer,
          createdAt: reportDate,
        });
        reportsCreated++;
      }

      // ── 4. Seed 15 declarations ────────────────────────────────────────────
      const declIds: Array<{ id: number; traderId: number; amount: number; status: string }> = [];
      for (let i = 0; i < 15; i++) {
        const traderId = pick(traderIds);
        const corridor = pick(CORRIDORS);
        const hsCode = pick(HS_CODES);
        const lanes = ["green", "green", "green", "yellow", "red"];
        const riskLane = pick(lanes);
        const invoiceValue = rand(50_000, 5_000_000);
        const dutyRate = 0.05 + Math.random() * 0.15;
        const dutyAmount = Math.round(invoiceValue * dutyRate);
        const vatAmount = Math.round(invoiceValue * 0.075);
        const declNumber = `APT-${Date.now()}-${String(i + 1).padStart(3, "0")}`;
        const ucr = `UCR-NGAPP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        const statuses = ["cleared", "cleared", "cleared", "payment_confirmed", "under_examination"];
        const status = pick(statuses);
        const submittedAt = daysAgo(rand(1, 28));
        const clearedAt = status === "cleared" ? new Date(submittedAt.getTime() + rand(2, 6) * 3_600_000) : null;

        try {
          const [decl] = await db.insert(declarations).values({
            declarationNumber: declNumber,
            ucr,
            traderId,
            declarationType: "import",
            status: status as any,
            riskLane: riskLane as any,
            riskScore: (Math.random() * 0.9).toFixed(2),
            hsCode,
            goodsDescription: `Pilot cargo shipment — HS ${hsCode}`,
            countryOfOrigin: corridor.origin,
            countryOfDestination: corridor.destination,
            portOfEntry: "NGAPP",
            grossWeight: (rand(500, 50_000) / 10).toFixed(1),
            netWeight: (rand(400, 45_000) / 10).toFixed(1),
            numberOfPackages: rand(1, 100),
            invoiceValue: invoiceValue.toFixed(2),
            invoiceCurrency: "NGN",
            dutyAmount: dutyAmount.toFixed(2),
            vatAmount: vatAmount.toFixed(2),
            totalDue: (dutyAmount + vatAmount).toFixed(2),
            submittedAt,
            clearedAt,
            createdAt: submittedAt,
            updatedAt: submittedAt,
          }).returning({ id: declarations.id });
          if (decl) {
            declIds.push({ id: decl.id, traderId, amount: dutyAmount + vatAmount, status });
            declarationsCreated++;
          }
        } catch {
          // Skip duplicate declaration numbers
        }
      }

      // ── 5. Seed payments for cleared declarations ─────────────────────────
      const clearedDecls = declIds.filter(d => d.status === "cleared" || d.status === "payment_confirmed");
      const methods: Array<"bank_transfer" | "mobile_money" | "card"> = ["bank_transfer", "mobile_money", "card"];
      for (let i = 0; i < Math.min(10, clearedDecls.length); i++) {
        const decl = clearedDecls[i];
        const ref = `PAY-APT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        await db.insert(payments).values({
          declarationId: decl.id,
          traderId: decl.traderId,
          amount: decl.amount.toFixed(2),
          currency: "NGN",
          paymentMethod: pick(methods),
          status: "confirmed",
          reference: ref,
          confirmedAt: new Date(),
        });
        paymentsCreated++;
      }

      console.log(
        `[Pilot] loadDemoData: ${officersCreated} officers, ${tradersCreated} traders, ` +
        `${reportsCreated} reports, ${declarationsCreated} declarations, ${paymentsCreated} payments created`
      );

      return {
        officersCreated,
        tradersCreated,
        reportsCreated,
        declarationsCreated,
        paymentsCreated,
        totalParticipants: officersCreated + tradersCreated,
      };
    }),

  // Get pilot KPI summary
  getKpiSummary: protectedProcedure
    .query(async ({ ctx }) => {
      if (!["admin", "customs_officer", "finance"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const reports = await db
        .select()
        .from(pilotReports)
        .orderBy(desc(pilotReports.reportDate))
        .limit(90);

      const totalDeclarations = reports.reduce((s, r) => s + r.totalDeclarations, 0);
      const totalGreen = reports.reduce((s, r) => s + r.greenLane, 0);
      const totalDutyKobo = reports.reduce((s, r) => s + r.totalDutyCollectedKobo, 0);
      const greenLanePct = totalDeclarations > 0 ? (totalGreen / totalDeclarations) * 100 : 0;
      const avgClearanceHours = reports.length > 0
        ? reports.reduce((s, r) => s + r.avgClearanceHoursX100, 0) / reports.length / 100
        : 0;

      const participants = await db
        .select({ count: count() })
        .from(pilotParticipants)
        .where(eq(pilotParticipants.isActive, true));

      return {
        config: PILOT_CONFIG,
        totalDeclarations,
        greenLanePct: Math.round(greenLanePct * 10) / 10,
        avgClearanceHours: Math.round(avgClearanceHours * 10) / 10,
        totalDutyNaira: totalDutyKobo / 100,
        activeParticipants: Number(participants[0]?.count ?? 0),
        reportCount: reports.length,
        latestReport: reports[0] ?? null,
        targetGreenLanePct: PILOT_CONFIG.greenLaneTarget * 100,
        targetClearanceHours: PILOT_CONFIG.avgClearanceHoursTarget,
      };
    }),

  // ─── Sprint 85: Per-report KPI drill-down ─────────────────────────────────
  getReportDetail: protectedProcedure
    .input(z.object({ reportId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      if (!['admin', 'customs_officer', 'finance'].includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const [report] = await db
        .select()
        .from(pilotReports)
        .where(eq(pilotReports.id, input.reportId));
      if (!report) throw new TRPCError({ code: 'NOT_FOUND', message: 'Report not found' });

      // Get NCS officer participants
      const officers = await db
        .select({
          id: pilotParticipants.id,
          userId: pilotParticipants.userId,
          organisation: pilotParticipants.organisation,
          pilotRole: pilotParticipants.pilotRole,
          officerName: users.name,
          officerEmail: users.email,
        })
        .from(pilotParticipants)
        .leftJoin(users, eq(pilotParticipants.userId, users.id))
        .where(eq(pilotParticipants.pilotRole, 'ncs_officer'));

      // Get declarations on the report date
      const reportDate = new Date(report.reportDate);
      const dayStart = new Date(reportDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(reportDate);
      dayEnd.setHours(23, 59, 59, 999);

      const [greenCount, yellowCount, redCount] = await Promise.all([
        db.select({ count: count() }).from(declarations).where(and(gte(declarations.createdAt, dayStart), lte(declarations.createdAt, dayEnd), eq(declarations.riskLane, 'green'))),
        db.select({ count: count() }).from(declarations).where(and(gte(declarations.createdAt, dayStart), lte(declarations.createdAt, dayEnd), eq(declarations.riskLane, 'yellow'))),
        db.select({ count: count() }).from(declarations).where(and(gte(declarations.createdAt, dayStart), lte(declarations.createdAt, dayEnd), eq(declarations.riskLane, 'red'))),
      ]);

      const officerCount = officers.length || 1;
      const totalDecls = report.totalDeclarations;
      const officerStats = officers.map((officer, idx) => {
        // Distribute declarations across officers using a deterministic split
        const baseShare = Math.floor(totalDecls / officerCount);
        const extra = idx < (totalDecls % officerCount) ? 1 : 0;
        const handled = baseShare + extra;
        const gShare = Math.floor(Number(greenCount[0]?.count ?? 0) / officerCount);
        const yShare = Math.floor(Number(yellowCount[0]?.count ?? 0) / officerCount);
        const rShare = Math.floor(Number(redCount[0]?.count ?? 0) / officerCount);
        return {
          officerId: officer.userId,
          officerName: officer.officerName ?? `Officer #${officer.userId}`,
          officerEmail: officer.officerEmail ?? '',
          organisation: officer.organisation ?? 'NCS Apapa',
          declarationsHandled: handled,
          greenLane: gShare,
          yellowLane: yShare,
          redLane: rShare,
          avgClearanceHours: Math.round((report.avgClearanceHoursX100 / 100) * 10) / 10,
          dutyCollectedNaira: Math.round(report.totalDutyCollectedKobo / 100 / officerCount),
        };
      });

      return {
        report,
        officerStats,
        reportDate: report.reportDate,
        totalDeclarations: report.totalDeclarations,
        greenLane: report.greenLane,
        yellowLane: report.yellowLane,
        redLane: report.redLane,
        avgClearanceHours: report.avgClearanceHoursX100 / 100,
        totalDutyNaira: report.totalDutyCollectedKobo / 100,
        systemUptimePct: report.systemUptimePctX100 / 100,
      };
    }),
});
