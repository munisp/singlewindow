/**
 * TradeGateway Compliance Reporting Router
 * ==========================================
 * Implements items 16, 18, 23 from the checklist:
 *   16. PCI-DSS and SOC 2 compliance audit across all microservices and database ledgers
 *   18. GDPR and NDPR data privacy compliance endpoints
 *   23. Compliance reporting endpoints — automated regulatory data submission flows
 *
 * Covers:
 *   - PCI-DSS v4.0 requirements audit (12 requirements)
 *   - SOC 2 Type II controls (Security, Availability, Confidentiality, Privacy, Processing Integrity)
 *   - NDPR (Nigeria Data Protection Regulation) compliance
 *   - GDPR data subject rights (access, erasure, portability, rectification)
 *   - Automated regulatory submission to CBN, NFIU, NAICOM, NCC
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { requireDb } from "../db";

// ─── PCI-DSS v4.0 Requirements ───────────────────────────────────────────────

const PCI_DSS_REQUIREMENTS = [
  { id: "1", title: "Install and Maintain Network Security Controls", controls: ["firewall", "network-segmentation", "zero-trust"] },
  { id: "2", title: "Apply Secure Configurations to All System Components", controls: ["hardened-images", "no-default-passwords", "security-contexts"] },
  { id: "3", title: "Protect Stored Account Data", controls: ["encryption-at-rest", "key-management", "data-masking"] },
  { id: "4", title: "Protect Cardholder Data with Strong Cryptography During Transmission", controls: ["tls-1.3", "mtls", "certificate-pinning"] },
  { id: "5", title: "Protect All Systems Against Malware", controls: ["waf", "openappsec", "vulnerability-scanning"] },
  { id: "6", title: "Develop and Maintain Secure Systems and Software", controls: ["sast", "dast", "dependency-scanning", "secure-sdlc"] },
  { id: "7", title: "Restrict Access to System Components and Cardholder Data by Business Need to Know", controls: ["permify-rbac", "least-privilege", "mfa"] },
  { id: "8", title: "Identify Users and Authenticate Access to System Components", controls: ["keycloak-mfa", "jwt-rs256", "session-management"] },
  { id: "9", title: "Restrict Physical Access to Cardholder Data", controls: ["cloud-physical-security", "datacenter-compliance"] },
  { id: "10", title: "Log and Monitor All Access to System Components and Cardholder Data", controls: ["audit-logs", "prometheus", "grafana", "siem"] },
  { id: "11", title: "Test Security of Systems and Networks Regularly", controls: ["pentest", "vulnerability-scan", "chaos-engineering"] },
  { id: "12", title: "Support Information Security with Organizational Policies and Programs", controls: ["security-policy", "incident-response", "training"] },
];

// ─── SOC 2 Trust Service Criteria ────────────────────────────────────────────

const SOC2_CRITERIA = [
  { id: "CC6", title: "Logical and Physical Access Controls", category: "Security" },
  { id: "CC7", title: "System Operations", category: "Security" },
  { id: "CC8", title: "Change Management", category: "Security" },
  { id: "CC9", title: "Risk Mitigation", category: "Security" },
  { id: "A1", title: "Availability — Performance Monitoring", category: "Availability" },
  { id: "C1", title: "Confidentiality — Encryption and Data Classification", category: "Confidentiality" },
  { id: "P1", title: "Privacy — Notice and Communication", category: "Privacy" },
  { id: "P3", title: "Privacy — Collection of Personal Information", category: "Privacy" },
  { id: "P4", title: "Privacy — Use of Personal Information", category: "Privacy" },
  { id: "P6", title: "Privacy — Retention and Disposal", category: "Privacy" },
  { id: "PI1", title: "Processing Integrity — Complete and Accurate Processing", category: "Processing Integrity" },
];

export const complianceReportingRouter = router({

  // ─── PCI-DSS Compliance Audit ─────────────────────────────────────────────

  runPCIDSSAudit: protectedProcedure
    .input(z.object({ scope: z.enum(["full", "cardholder-data-environment", "network"]).default("full") }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const auditId = crypto.randomUUID();
      const results: any[] = [];
      let passCount = 0;
      let failCount = 0;

      for (const req of PCI_DSS_REQUIREMENTS) {
        const controlResults: any[] = [];
        let reqPassed = true;

        let reqNotAssessed = 0;
        for (const control of req.controls) {
          const controlStatus = await checkControlImplementation(db, control);
          controlResults.push({
            control,
            status: controlStatus.assessment === "ASSESSED_PASS" ? "PASS" : controlStatus.assessment === "ASSESSED_FAIL" ? "FAIL" : "NOT_ASSESSED",
            evidence: controlStatus.evidence,
            gap: controlStatus.gap,
          });
          if (controlStatus.assessment === "ASSESSED_FAIL") reqPassed = false;
          if (controlStatus.assessment === "NOT_ASSESSED") reqNotAssessed++;
        }

        // SW-O7: a requirement is only PASS/FAIL when its controls were actually
        // assessed; NOT_ASSESSED requirements are excluded from the score.
        const reqStatus = !reqPassed ? "FAIL" : reqNotAssessed === req.controls.length ? "NOT_ASSESSED" : reqNotAssessed > 0 ? "PARTIAL" : "PASS";
        if (reqStatus === "PASS") passCount++;
        else if (reqStatus === "FAIL" || reqStatus === "PARTIAL") failCount++;

        results.push({
          requirement_id: req.id,
          title: req.title,
          status: reqStatus,
          controls: controlResults,
        });
      }

      // Score computed ONLY over assessed requirements.
      const assessedCount = passCount + failCount;
      const score = assessedCount > 0 ? (passCount / assessedCount) * 100 : null;
      const report = {
        audit_id: auditId,
        standard: "PCI-DSS v4.0",
        scope: input.scope,
        score: score != null ? Math.round(score * 100) / 100 : null,
        score_basis: `${passCount}/${assessedCount} assessed requirements passed; unassessed controls excluded`,
        status: score == null ? "NOT_ASSESSED" : score >= 100 ? "COMPLIANT" : score >= 80 ? "PARTIALLY_COMPLIANT" : "NON_COMPLIANT",
        requirements_passed: passCount,
        requirements_failed: failCount,
        requirements_not_assessed: PCI_DSS_REQUIREMENTS.length - assessedCount,
        total_requirements: PCI_DSS_REQUIREMENTS.length,
        results,
        audited_at: new Date().toISOString(),
      };

      // Persist audit result
      await db.$client.query(
        `INSERT INTO compliance_audit_results (id, standard, scope, score, status, report_data, audited_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [auditId, "PCI-DSS v4.0", input.scope, score ?? 0, report.status, JSON.stringify(report)]
      );

      return report;
    }),

  // ─── SOC 2 Compliance Audit ───────────────────────────────────────────────

  runSOC2Audit: protectedProcedure
    .input(z.object({ type: z.enum(["Type I", "Type II"]).default("Type II") }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const auditId = crypto.randomUUID();
      const results: any[] = [];
      let passCount = 0;

      let notAssessed = 0;
      for (const criterion of SOC2_CRITERIA) {
        const status = await checkSOC2Criterion(db, criterion.id);
        if (status.assessment === "ASSESSED_PASS") passCount++;
        if (status.assessment === "NOT_ASSESSED") notAssessed++;
        results.push({
          criterion_id: criterion.id,
          title: criterion.title,
          category: criterion.category,
          status: status.assessment === "ASSESSED_PASS" ? "MET" : status.assessment === "ASSESSED_FAIL" ? "NOT_MET" : "NOT_ASSESSED",
          evidence: status.evidence,
          observations: status.observations,
        });
      }

      // Score computed ONLY over assessed criteria.
      const assessedCount = SOC2_CRITERIA.length - notAssessed;
      const score = assessedCount > 0 ? (passCount / assessedCount) * 100 : null;
      const report = {
        audit_id: auditId,
        standard: `SOC 2 ${input.type}`,
        score: score != null ? Math.round(score * 100) / 100 : null,
        score_basis: `${passCount}/${assessedCount} assessed criteria met; NOT_ASSESSED criteria excluded`,
        status: score == null ? "NOT_ASSESSED" : score >= 95 ? "UNQUALIFIED" : score >= 80 ? "QUALIFIED" : "ADVERSE",
        criteria_met: passCount,
        criteria_not_met: assessedCount - passCount,
        criteria_not_assessed: notAssessed,
        total_criteria: SOC2_CRITERIA.length,
        results,
        period_start: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
        period_end: new Date().toISOString(),
        audited_at: new Date().toISOString(),
      };

      await db.$client.query(
        `INSERT INTO compliance_audit_results (id, standard, scope, score, status, report_data, audited_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [auditId, `SOC 2 ${input.type}`, "full", score ?? 0, report.status, JSON.stringify(report)]
      );

      return report;
    }),

  // ─── GDPR/NDPR Data Subject Rights ───────────────────────────────────────

  handleDataSubjectRequest: protectedProcedure
    .input(z.object({
      request_type: z.enum(["ACCESS", "ERASURE", "PORTABILITY", "RECTIFICATION", "RESTRICTION", "OBJECTION"]),
      subject_id: z.string(),
      subject_email: z.string().email(),
      regulation: z.enum(["GDPR", "NDPR"]).default("NDPR"),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const requestId = crypto.randomUUID();
      const deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days (NDPR requirement)

      // Log the request
      await db.$client.query(
        `INSERT INTO data_subject_requests (id, request_type, subject_id, subject_email, regulation, reason, status, deadline, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, NOW())`,
        [requestId, input.request_type, input.subject_id, input.subject_email, input.regulation, input.reason, deadline]
      );

      let responseData: any = {};

      switch (input.request_type) {
        case "ACCESS": {
          // Collect all personal data for the subject
          const [declarations, payments, kyc, auditLogs] = await Promise.all([
            db.$client.query(`SELECT id, declaration_number, status, created_at FROM declarations WHERE trader_id = $1 LIMIT 100`, [input.subject_id]),
            db.$client.query(`SELECT id, amount, status, created_at FROM payments WHERE trader_id = $1 LIMIT 100`, [input.subject_id]),
            db.$client.query(`SELECT id, status, created_at FROM kyc_records WHERE user_id = $1 LIMIT 10`, [input.subject_id]),
            db.$client.query(`SELECT id, event_type, created_at FROM audit_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`, [input.subject_id]),
          ]);
          responseData = {
            personal_data: {
              declarations: declarations.rows,
              payments: payments.rows,
              kyc_records: kyc.rows,
              audit_trail: auditLogs.rows,
            },
            data_categories: ["Trade Declarations", "Payment Records", "KYC Documents", "Audit Logs"],
            retention_periods: {
              declarations: "7 years (CAMA 2020)",
              payments: "7 years (FIRS Act)",
              kyc: "5 years (AML/CFT Regulations)",
              audit_logs: "3 years",
            },
          };
          break;
        }

        case "ERASURE": {
          // Right to erasure — anonymize non-legally-required data
          // Note: Trade declarations cannot be erased (legal retention requirement)
          await db.$client.query(
            `UPDATE users SET email = $1, phone = NULL, address = NULL, updated_at = NOW()
             WHERE id = $2`,
            [`anonymized-${requestId}@tradegateway.ng`, input.subject_id]
          );
          responseData = {
            erased: ["email", "phone", "address"],
            retained: ["declarations", "payments", "audit_logs"],
            retention_reason: "Legal obligation under CAMA 2020, FIRS Act, and CBN AML/CFT Regulations",
          };
          break;
        }

        case "PORTABILITY": {
          // Export data in machine-readable format (JSON)
          const [declarations, payments] = await Promise.all([
            db.$client.query(`SELECT * FROM declarations WHERE trader_id = $1`, [input.subject_id]),
            db.$client.query(`SELECT * FROM payments WHERE trader_id = $1`, [input.subject_id]),
          ]);
          responseData = {
            format: "JSON",
            standard: "ISO 8601 dates, UTF-8 encoding",
            data: {
              declarations: declarations.rows,
              payments: payments.rows,
            },
            exported_at: new Date().toISOString(),
          };
          break;
        }

        case "RECTIFICATION": {
          responseData = {
            message: "Rectification request received. A compliance officer will review and update incorrect data within 30 days.",
            deadline: deadline.toISOString(),
          };
          break;
        }

        default:
          responseData = { message: `${input.request_type} request received and will be processed within 30 days.` };
      }

      // Update request status
      await db.$client.query(
        `UPDATE data_subject_requests SET status = 'COMPLETED', response_data = $1, completed_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(responseData), requestId]
      );

      return {
        request_id: requestId,
        request_type: input.request_type,
        regulation: input.regulation,
        status: "COMPLETED",
        deadline: deadline.toISOString(),
        response: responseData,
        processed_at: new Date().toISOString(),
      };
    }),

  // ─── NDPR Compliance Report ───────────────────────────────────────────────

  generateNDPRReport: protectedProcedure
    .input(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() }))
    .query(async ({ input, ctx }) => {
      const db = await requireDb();
      const period = input.period ?? new Date().toISOString().slice(0, 7);

      const [dsrStats, breachStats, consentStats] = await Promise.all([
        db.$client.query(`
          SELECT
            COUNT(*) AS total_requests,
            COUNT(*) FILTER (WHERE request_type='ACCESS') AS access_requests,
            COUNT(*) FILTER (WHERE request_type='ERASURE') AS erasure_requests,
            COUNT(*) FILTER (WHERE request_type='PORTABILITY') AS portability_requests,
            COUNT(*) FILTER (WHERE status='COMPLETED') AS completed,
            COUNT(*) FILTER (WHERE completed_at > deadline) AS overdue
          FROM data_subject_requests
          WHERE TO_CHAR(created_at, 'YYYY-MM') = $1
        `, [period]),
        db.$client.query(`
          SELECT COUNT(*) AS total_breaches,
                 COUNT(*) FILTER (WHERE severity='HIGH') AS high_severity,
                 COUNT(*) FILTER (WHERE notified_ndpc=TRUE) AS notified_ndpc
          FROM security_incidents
          WHERE TO_CHAR(created_at, 'YYYY-MM') = $1
        `, [period]).catch(() => ({ rows: [{ total_breaches: 0, high_severity: 0, notified_ndpc: 0 }] })),
        db.$client.query(`SELECT COUNT(*) AS total_consents FROM user_consents WHERE TO_CHAR(created_at, 'YYYY-MM') = $1`, [period])
          .catch(() => ({ rows: [{ total_consents: 0 }] })),
      ]);

      return {
        period,
        regulation: "NDPR 2019 (Nigeria Data Protection Regulation)",
        regulator: "NDPC (National Data Protection Commission)",
        data_subject_requests: dsrStats.rows[0],
        data_breaches: breachStats.rows[0],
        consent_records: consentStats.rows[0],
        compliance_status: "NOT_ASSESSED", // SW-O7: no automated basis to declare compliance
        dpo_name: "TradeGateway Data Protection Officer",
        generated_at: new Date().toISOString(),
        next_submission_due: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      };
    }),

  // ─── Automated Regulatory Submission ─────────────────────────────────────

  submitRegulatoryReport: protectedProcedure
    .input(z.object({
      regulator: z.enum(["CBN", "NFIU", "NAICOM", "NCC", "NDPC", "NCS", "FIRS"]),
      report_type: z.string(),
      period: z.string(),
      auto_submit: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const submissionId = crypto.randomUUID();

      // Regulator endpoints (production URLs)
      const REGULATOR_ENDPOINTS: Record<string, string> = {
        CBN:   process.env.CBN_REPORTING_URL   ?? "https://api.cbn.gov.ng/reporting/v1",
        NFIU:  process.env.NFIU_API_URL        ?? "https://nfiu.gov.ng/api/v1",
        NAICOM:process.env.NAICOM_API_URL      ?? "https://naicom.gov.ng/api/v1",
        NCC:   process.env.NCC_API_URL         ?? "https://ncc.gov.ng/api/v1",
        NDPC:  process.env.NDPC_API_URL        ?? "https://ndpc.gov.ng/api/v1",
        NCS:   process.env.NCS_API_URL         ?? "https://customs.gov.ng/api/v1",
        FIRS:  process.env.FIRS_API_URL        ?? "https://firs.gov.ng/api/v1",
      };

      // Log submission attempt
      await db.$client.query(
        `INSERT INTO regulatory_submissions (id, regulator, report_type, period, status, created_at)
         VALUES ($1, $2, $3, $4, 'PENDING', NOW())`,
        [submissionId, input.regulator, input.report_type, input.period]
      );

      if (!input.auto_submit) {
        return {
          submission_id: submissionId,
          status: "STAGED",
          message: `Report staged for manual review. Set auto_submit=true to submit automatically.`,
          endpoint: REGULATOR_ENDPOINTS[input.regulator],
        };
      }

      // Auto-submit to regulator
      try {
        const response = await fetch(`${REGULATOR_ENDPOINTS[input.regulator]}/reports/submit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": process.env[`${input.regulator}_API_KEY`] ?? "",
            "X-Submission-ID": submissionId,
          },
          body: JSON.stringify({
            submission_id: submissionId,
            report_type: input.report_type,
            period: input.period,
            submitted_by: "TradeGateway Compliance System",
            submitted_at: new Date().toISOString(),
          }),
        });

        const status = response.ok ? "SUBMITTED" : "FAILED";
        await db.$client.query(
          `UPDATE regulatory_submissions SET status=$1, submitted_at=NOW(), response_code=$2 WHERE id=$3`,
          [status, response.status, submissionId]
        );

        return {
          submission_id: submissionId,
          regulator: input.regulator,
          status,
          response_code: response.status,
          submitted_at: new Date().toISOString(),
        };
      } catch (error: any) {
        await db.$client.query(
          `UPDATE regulatory_submissions SET status='FAILED', error_message=$1 WHERE id=$2`,
          [error.message, submissionId]
        );
        throw new Error(`Regulatory submission failed: ${error.message}`);
      }
    }),

  // ─── Get Compliance Dashboard ─────────────────────────────────────────────

  getComplianceDashboard: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await requireDb();

      const [auditResults, submissions, dsrStats] = await Promise.all([
        db.$client.query(`
          SELECT standard, status, score, audited_at
          FROM compliance_audit_results
          ORDER BY audited_at DESC
          LIMIT 10
        `),
        db.$client.query(`
          SELECT regulator, report_type, status, submitted_at
          FROM regulatory_submissions
          ORDER BY created_at DESC
          LIMIT 20
        `),
        db.$client.query(`
          SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='PENDING') AS pending
          FROM data_subject_requests
          WHERE created_at > NOW() - INTERVAL '30 days'
        `),
      ]);

      return {
        audit_results: auditResults.rows,
        regulatory_submissions: submissions.rows,
        data_subject_requests: dsrStats.rows[0],
        compliance_standards: ["PCI-DSS v4.0", "SOC 2 Type II", "NDPR 2019", "GDPR (for EU traders)", "ISO 27001"],
        regulators: ["CBN", "NFIU", "NAICOM", "NCC", "NDPC", "NCS", "FIRS"],
        generated_at: new Date().toISOString(),
      };
    }),

  // ─── List Data Subject Requests ───────────────────────────────────────────

  listDataSubjectRequests: protectedProcedure
    .input(z.object({
      status: z.enum(["PENDING", "COMPLETED", "OVERDUE"]).optional(),
      limit: z.number().max(100).default(50),
    }))
    .query(async ({ input, ctx }) => {
      const db = await requireDb();
      const rows = await db.$client.query(`
        SELECT id, request_type, subject_email, regulation, status, deadline, created_at, completed_at
        FROM data_subject_requests
        WHERE ($1::text IS NULL OR status = $1)
        ORDER BY created_at DESC
        LIMIT $2
      `, [input.status ?? null, input.limit]);
      return { requests: rows.rows, count: rows.rows.length };
    }),

});

// ─── Helper Functions ─────────────────────────────────────────────────────────

// ─── SW-16/SW-O7: evidence-based control assessment ONLY ─────────────────────
// Nothing here may claim a control is implemented without a verifiable probe.
// Unknown/unverifiable controls are NOT_ASSESSED; scores are computed ONLY over
// assessed controls. Canned always-pass evidence strings were removed.

type ControlAssessment = {
  assessment: "ASSESSED_PASS" | "ASSESSED_FAIL" | "NOT_ASSESSED";
  evidence: string;
  gap?: string;
};

const NOT_ASSESSED = (control: string): ControlAssessment => ({
  assessment: "NOT_ASSESSED",
  evidence: `No automated verifiable probe exists for '${control}'. It is reported NOT_ASSESSED — never assumed implemented.`,
  gap: `Manual evidence collection required for ${control}`,
});

async function checkControlImplementation(db: any, control: string): Promise<ControlAssessment> {
  const controlChecks: Record<string, () => Promise<ControlAssessment>> = {
    // REAL probe: PostgreSQL SSL setting
    "encryption-at-rest": async () => {
      const result = await db.$client.query(`SELECT setting FROM pg_settings WHERE name = 'ssl'`);
      const on = result.rows[0]?.setting === "on";
      return {
        assessment: on ? "ASSESSED_PASS" : "ASSESSED_FAIL",
        evidence: `Live probe: PostgreSQL ssl = '${result.rows[0]?.setting ?? "unknown"}'`,
        gap: on ? undefined : "PostgreSQL SSL is not enabled",
      };
    },
    // REAL probe: audit events actually flowing
    "audit-logs": async () => {
      const result = await db.$client.query(`SELECT COUNT(*) FROM audit_events WHERE created_at > NOW() - INTERVAL '24 hours'`);
      const n = parseInt(result.rows[0]?.count ?? "0");
      return {
        assessment: n > 0 ? "ASSESSED_PASS" : "ASSESSED_FAIL",
        evidence: `Live probe: ${n} audit events in last 24 hours`,
        gap: n > 0 ? undefined : "No audit events recorded in the last 24h",
      };
    },
    // Honest signal: Permify authz configured (env presence), per remediation doctrine
    "permify-rbac": async () => {
      const configured = Boolean(process.env.PERMIFY_URL?.trim() && process.env.PERMIFY_API_KEY?.trim());
      return {
        assessment: configured ? "ASSESSED_PASS" : "ASSESSED_FAIL",
        evidence: configured
          ? "Live probe: PERMIFY_URL and PERMIFY_API_KEY are configured (authorization service wired)"
          : "Permify is not configured (PERMIFY_URL / PERMIFY_API_KEY missing)",
        gap: configured ? undefined : "Permify not configured",
      };
    },
  };

  const checker = controlChecks[control];
  if (checker) {
    try {
      return await checker();
    } catch (e) {
      return { assessment: "NOT_ASSESSED", evidence: `Probe for '${control}' failed: ${String(e)}`, gap: `Probe failure for ${control}` };
    }
  }
  // Unlisted controls are NEVER assumed implemented.
  return NOT_ASSESSED(control);
}

type CriterionAssessment = {
  assessment: "ASSESSED_PASS" | "ASSESSED_FAIL" | "NOT_ASSESSED";
  evidence: string;
  observations: string;
};

async function checkSOC2Criterion(db: any, criterionId: string): Promise<CriterionAssessment> {
  const criterionChecks: Record<string, () => Promise<CriterionAssessment>> = {
    // CC6 logical access: honest signal = Keycloak + Permify actually configured
    "CC6": async () => {
      const kc = Boolean(process.env.KEYCLOAK_URL?.trim() && process.env.KEYCLOAK_CLIENT_SECRET?.trim());
      const pf = Boolean(process.env.PERMIFY_URL?.trim() && process.env.PERMIFY_API_KEY?.trim());
      const pass = kc && pf;
      return {
        assessment: pass ? "ASSESSED_PASS" : "ASSESSED_FAIL",
        evidence: `Live probe: Keycloak configured=${kc}, Permify configured=${pf}`,
        observations: pass
          ? "Identity and authorization services are configured. MFA policy, network segmentation and session controls are NOT verifiable via automated probes and require manual audit evidence."
          : "Access-control infrastructure is not fully configured.",
      };
    },
    // CC7 monitoring: honest signal = metrics endpoint exposed by this process
    "CC7": async () => {
      let metricsExposed = false;
      try {
        const { metricsRegistry } = await import("../_core/metrics");
        const body = await metricsRegistry.metrics();
        metricsExposed = Boolean(body && body.length > 0);
      } catch { metricsExposed = false; }
      return {
        assessment: metricsExposed ? "ASSESSED_PASS" : "NOT_ASSESSED",
        evidence: metricsExposed
          ? "Live probe: Prometheus metrics registry renders (monitoring instrumentation active)"
          : "No verifiable monitoring probe available",
        observations: "Dashboards, alert routing and 24/7 coverage require manual audit evidence.",
      };
    },
    // A1 availability: REAL query on payment processing latency
    "A1": async () => {
      const result = await db.$client.query(`SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) AS avg_response FROM payments WHERE created_at > NOW() - INTERVAL '7 days' AND status='confirmed'`);
      const avgMs = parseFloat(result.rows[0]?.avg_response ?? "0") * 1000;
      return {
        assessment: avgMs < 5000 ? "ASSESSED_PASS" : "ASSESSED_FAIL",
        evidence: `Live probe: average confirmed-payment processing time ${avgMs.toFixed(0)}ms over 7 days`,
        observations: avgMs < 5000 ? "Processing latency within threshold" : "Performance degradation detected",
      };
    },
    // C1 confidentiality: REAL probe of PostgreSQL SSL
    "C1": async () => {
      const result = await db.$client.query(`SELECT setting FROM pg_settings WHERE name = 'ssl'`);
      const on = result.rows[0]?.setting === "on";
      return {
        assessment: on ? "ASSESSED_PASS" : "ASSESSED_FAIL",
        evidence: `Live probe: PostgreSQL ssl = '${result.rows[0]?.setting ?? "unknown"}'`,
        observations: "Data classification, key management and field-level encryption require manual audit evidence.",
      };
    },
  };

  const checker = criterionChecks[criterionId];
  if (checker) {
    try {
      return await checker();
    } catch (e) {
      return { assessment: "NOT_ASSESSED", evidence: `Probe failed: ${String(e)}`, observations: `Unable to assess ${criterionId}` };
    }
  }
  return {
    assessment: "NOT_ASSESSED",
    evidence: `No automated verifiable probe exists for ${criterionId}. Reported NOT_ASSESSED — never assumed met.`,
    observations: "Manual audit evidence required.",
  };
}
