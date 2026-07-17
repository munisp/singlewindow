/**
 * crsImport.ts
 * OWASP CRS Bulk Import — fetches the latest CRS release from GitHub,
 * parses all SecRule definitions, and upserts them into coraza_waf_rules.
 *
 * Procedure: keycloakAdminProcedure (requires realm-admin Keycloak role)
 */

import { z } from "zod";
import { keycloakAdminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { corazaWafRules } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// ─── GitHub CRS API ──────────────────────────────────────────────────────────

const CRS_REPO = "coreruleset/coreruleset";
const CRS_RULES_DIR = "rules";
const GITHUB_RAW = "https://raw.githubusercontent.com";
const GITHUB_API = "https://api.github.com";

interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
}

interface GitHubFile {
  name: string;
  type: string;
  download_url: string;
}

interface ParsedRule {
  ruleId: string;
  description: string;
  severity: string;
  category: string;
  paranoiaLevel: number;
  phase: number;
  action: string;
  tags: string[];
}

// ─── CRS Rule Parser ─────────────────────────────────────────────────────────

/**
 * Derive a human-readable category name from the CRS .conf filename.
 * e.g. "REQUEST-942-APPLICATION-ATTACK-SQLI.conf" → "SQL Injection"
 */
function categoryFromFilename(filename: string): string {
  const map: Record<string, string> = {
    "901": "Initialization",
    "905": "Common Exceptions",
    "911": "Method Enforcement",
    "913": "Scanner Detection",
    "920": "Protocol Enforcement",
    "921": "Protocol Attack",
    "922": "Multipart Attack",
    "930": "Local File Inclusion",
    "931": "Remote File Inclusion",
    "932": "Remote Code Execution",
    "933": "PHP Injection",
    "934": "Node.js Injection",
    "941": "XSS",
    "942": "SQL Injection",
    "943": "Session Fixation",
    "944": "Java Attack",
    "949": "Blocking Evaluation",
    "950": "Data Leakages",
    "951": "SQL Data Leakage",
    "952": "Java Data Leakage",
    "953": "PHP Data Leakage",
    "954": "IIS Data Leakage",
    "955": "Data Leakage",
    "959": "Reputation",
    "980": "Correlated Attack Scoring",
  };
  const match = filename.match(/(\d{3})-/);
  if (match) return map[match[1]] ?? filename.replace(/\.conf$/, "");
  return filename.replace(/\.conf$/, "");
}

/**
 * Parse a single CRS .conf file content and extract all SecRule definitions.
 * Returns an array of ParsedRule objects.
 */
function parseCrsConf(content: string, filename: string): ParsedRule[] {
  const rules: ParsedRule[] = [];
  const category = categoryFromFilename(filename);

  // Match multi-line SecRule blocks — join continuation lines first
  const normalized = content.replace(/\\\n\s*/g, " ");

  // Match: SecRule ... "id:NNNNNN, ..."
  const ruleRegex = /SecRule\s+\S+\s+"([^"]+)"/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRegex.exec(normalized)) !== null) {
    const opts = match[1];

    // Extract id
    const idMatch = opts.match(/\bid:(\d+)/);
    if (!idMatch) continue;
    const ruleId = idMatch[1];

    // Extract msg (description)
    const msgMatch = opts.match(/\bmsg:'([^']+)'/);
    const description = msgMatch ? msgMatch[1] : `CRS Rule ${ruleId}`;

    // Extract severity
    const sevMatch = opts.match(/\bseverity:'?([A-Z]+)'?/i);
    const severityRaw = sevMatch ? sevMatch[1].toLowerCase() : "medium";
    const severity = ["critical", "error", "warning", "notice"].includes(severityRaw)
      ? severityRaw === "error" ? "high"
        : severityRaw === "notice" ? "low"
        : severityRaw
      : "medium";

    // Extract phase
    const phaseMatch = opts.match(/\bphase:(\d+)/);
    const phase = phaseMatch ? parseInt(phaseMatch[1], 10) : 2;

    // Extract action (block/pass/deny)
    const actionMatch = opts.match(/\b(block|pass|deny|redirect|drop)\b/i);
    const action = actionMatch ? actionMatch[1].toLowerCase() : "block";

    // Extract paranoia level from tag
    const plMatch = opts.match(/paranoia-level\/(\d+)/);
    const paranoiaLevel = plMatch ? parseInt(plMatch[1], 10) : 1;

    // Extract all tags
    const tagMatches = [...opts.matchAll(/\btag:'([^']+)'/g)];
    const tags = tagMatches.map((m) => m[1]);

    rules.push({
      ruleId,
      description,
      severity,
      category,
      paranoiaLevel,
      phase,
      action,
      tags,
    });
  }

  return rules;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const res = await fetch(`${GITHUB_API}/repos/${CRS_REPO}/releases/latest`, {
    headers: { "User-Agent": "TradeGateway-NGSWTP/1.0", Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<GitHubRelease>;
}

async function fetchRuleFileList(tag: string): Promise<GitHubFile[]> {
  const res = await fetch(
    `${GITHUB_API}/repos/${CRS_REPO}/contents/${CRS_RULES_DIR}?ref=${tag}`,
    { headers: { "User-Agent": "TradeGateway-NGSWTP/1.0", Accept: "application/vnd.github.v3+json" } }
  );
  if (!res.ok) throw new Error(`GitHub API error listing rules: ${res.status}`);
  const files: GitHubFile[] = await res.json();
  return files.filter((f) => f.name.endsWith(".conf") && f.type === "file");
}

async function fetchRuleFileContent(tag: string, filename: string): Promise<string> {
  const url = `${GITHUB_RAW}/${CRS_REPO}/${tag}/${CRS_RULES_DIR}/${filename}`;
  const res = await fetch(url, { headers: { "User-Agent": "TradeGateway-NGSWTP/1.0" } });
  if (!res.ok) throw new Error(`Failed to fetch ${filename}: ${res.status}`);
  return res.text();
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const crsImportRouter = router({
  /**
   * Fetch the latest OWASP CRS release from GitHub, parse all rule files,
   * and upsert them into the coraza_waf_rules table.
   * Returns a summary of inserted/updated/skipped counts.
   */
  bulkImportRules: keycloakAdminProcedure
    .input(
      z.object({
        /** Override the CRS version tag (e.g. "v4.28.0"). Defaults to latest. */
        versionTag: z.string().optional(),
        /** Only import rules at or below this paranoia level (1-4). Default: 2 */
        maxParanoiaLevel: z.number().int().min(1).max(4).default(2),
        /** If true, skip rules that already exist in the DB (no update). */
        skipExisting: z.boolean().default(false),
        /** Dry run — parse and return counts without writing to DB. */
        dryRun: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // 1. Resolve version tag
      let tag = input.versionTag;
      let releaseName = tag ?? "latest";
      if (!tag) {
        const release = await fetchLatestRelease();
        tag = release.tag_name;
        releaseName = release.name ?? tag;
      }

      // 2. Fetch list of .conf files
      const files = await fetchRuleFileList(tag);

      // 3. Parse all rule files in parallel (batches of 5 to avoid rate limits)
      const allRules: ParsedRule[] = [];
      const batchSize = 5;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const contents = await Promise.all(
          batch.map((f) => fetchRuleFileContent(tag!, f.name))
        );
        for (let j = 0; j < batch.length; j++) {
          const parsed = parseCrsConf(contents[j], batch[j].name);
          allRules.push(...parsed);
        }
      }

      // 4. Filter by paranoia level
      const filtered = allRules.filter(
        (r) => r.paranoiaLevel <= input.maxParanoiaLevel
      );

      // 5. Deduplicate by ruleId (keep first occurrence)
      const seen = new Set<string>();
      const unique = filtered.filter((r) => {
        if (seen.has(r.ruleId)) return false;
        seen.add(r.ruleId);
        return true;
      });

      if (input.dryRun) {
        return {
          dryRun: true,
          crsVersion: tag,
          releaseName,
          totalParsed: allRules.length,
          afterParanoiaFilter: filtered.length,
          uniqueRules: unique.length,
          inserted: 0,
          updated: 0,
          skipped: 0,
          categories: [...new Set(unique.map((r) => r.category))].sort(),
        };
      }

      // 6. Upsert into DB
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      const importedAt = new Date();

      for (const rule of unique) {
        const existing = await db
          .select({ id: corazaWafRules.id })
          .from(corazaWafRules)
          .where(eq(corazaWafRules.ruleId, rule.ruleId))
          .limit(1);

        if (existing.length > 0) {
          if (input.skipExisting) {
            skipped++;
            continue;
          }
          // Update metadata only — preserve enabled/disabled state and audit trail
          await db
            .update(corazaWafRules)
            .set({
              description: rule.description,
              severity: rule.severity,
              category: rule.category,
              crsVersion: tag,
              paranoiaLevel: rule.paranoiaLevel,
              tags: JSON.stringify(rule.tags),
              phase: rule.phase,
              action: rule.action,
              importedAt,
              updatedAt: new Date(),
            })
            .where(eq(corazaWafRules.ruleId, rule.ruleId));
          updated++;
        } else {
          await db.insert(corazaWafRules).values({
            ruleId: rule.ruleId,
            description: rule.description,
            severity: rule.severity,
            category: rule.category,
            enabled: true,
            crsVersion: tag,
            paranoiaLevel: rule.paranoiaLevel,
            tags: JSON.stringify(rule.tags),
            phase: rule.phase,
            action: rule.action,
            importedAt,
          });
          inserted++;
        }
      }

      return {
        dryRun: false,
        crsVersion: tag,
        releaseName,
        totalParsed: allRules.length,
        afterParanoiaFilter: filtered.length,
        uniqueRules: unique.length,
        inserted,
        updated,
        skipped,
        categories: [...new Set(unique.map((r) => r.category))].sort(),
      };
    }),

  /**
   * Fetch the latest CRS release metadata without importing.
   * Used by the UI to show the current available version.
   */
  getLatestCrsRelease: keycloakAdminProcedure.query(async () => {
    const release = await fetchLatestRelease();
    return {
      tagName: release.tag_name,
      name: release.name,
      publishedAt: release.published_at,
    };
  }),

  /**
   * Get a summary of what is currently in the DB (version distribution).
   */
  getImportSummary: keycloakAdminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const rows = await db
      .select({
        crsVersion: corazaWafRules.crsVersion,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(corazaWafRules)
      .groupBy(corazaWafRules.crsVersion);

    const total = await (db as NodePgDatabase<Record<string, unknown>>)
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(corazaWafRules);

    return {
      totalRules: total[0]?.count ?? 0,
      byVersion: rows,
    };
  }),
});
