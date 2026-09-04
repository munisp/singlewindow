/**
 * formatters.ts — shared display-label formatting helpers.
 *
 * Raw enum/seed values (e.g. "docs_required", "seed-oga_permits-permit_type-171",
 * "Nig") leak into UI labels across dashboards. These helpers convert them to
 * human-readable labels. Always keep the raw value available in a title/tooltip
 * at the call site.
 */

/** Known raw values → curated display labels. */
const KNOWN_LABELS: Record<string, string> = {
  docs_required: "Docs Required",
  payment_pending: "Payment Pending",
  under_review: "Under Review",
  re_export: "Re-Export",
  mobile_money: "Mobile Money",
  bank_transfer: "Bank Transfer",
  not_required: "Not Required",
  // Common platform enums
  in_progress: "In Progress",
  risk_review: "Risk Review",
  physical_inspection: "Physical Inspection",
  duty_assessed: "Duty Assessed",
  duty_paid: "Duty Paid",
  docs_verified: "Docs Verified",
  pre_arrival: "Pre-Arrival",
  on_hold: "On Hold",
  release_ordered: "Release Ordered",
};

/** Acronyms/brand terms that must keep specific casing. */
const SPECIAL_WORDS: Record<string, string> = {
  oga: "OGA",
  ncs: "NCS",
  nrs: "NRS",
  aeo: "AEO",
  hs: "HS",
  tin: "TIN",
  asean: "ASEAN",
  kyc: "KYC",
  sla: "SLA",
  api: "API",
  id: "ID",
};

/** Matches seed-generated artifacts like "seed-oga_permits-permit_type-171". */
const SEED_ARTIFACT_RE = /^seed-[a-z0-9_]+-[a-z0-9_]+-\d+$/i;

/** Small ISO alpha-2/alpha-3 → country name map for common platform values. */
const COUNTRY_NAMES: Record<string, string> = {
  NG: "Nigeria", NGA: "Nigeria", Nig: "Nigeria",
  GH: "Ghana", GHA: "Ghana",
  CI: "Côte d'Ivoire", CIV: "Côte d'Ivoire",
  BJ: "Benin", BEN: "Benin",
  TG: "Togo", TGO: "Togo",
  CM: "Cameroon", CMR: "Cameroon",
  CN: "China", CHN: "China",
  US: "United States", USA: "United States",
  GB: "United Kingdom", GBR: "United Kingdom",
  AE: "United Arab Emirates", ARE: "United Arab Emirates",
  IN: "India", IND: "India",
  ZA: "South Africa", ZAF: "South Africa",
  KE: "Kenya", KEN: "Kenya",
};

/**
 * Convert a raw status/type value into a human-readable label.
 * - Known values map to curated labels ("docs_required" → "Docs Required").
 * - Seed artifacts collapse to a generic label derived from the middle segment
 *   ("seed-oga_permits-permit_type-171" → "Permit Type").
 * - Otherwise snake_case/kebab-case is title-cased with special-word casing
 *   preserved ("oga_officer" → "OGA Officer").
 * Returns the fallback (default "—") for null/undefined/empty input.
 */
export function humanizeLabel(
  raw: string | null | undefined,
  fallback = "—",
): string {
  if (raw == null) return fallback;
  const trimmed = String(raw).trim();
  if (!trimmed) return fallback;

  const known = KNOWN_LABELS[trimmed.toLowerCase()];
  if (known) return known;

  // Mask seed artifacts: use the middle descriptor segment as the label.
  if (SEED_ARTIFACT_RE.test(trimmed)) {
    const parts = trimmed.split("-");
    const descriptor = parts.length >= 3 ? parts[parts.length - 2] : "record";
    return titleCaseWords(descriptor);
  }

  return titleCaseWords(trimmed);
}

function titleCaseWords(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const special = SPECIAL_WORDS[word.toLowerCase()];
      if (special) return special;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Resolve a country code/abbreviation to a full country name.
 * Unknown values are returned unchanged (trimmed). Null/empty → fallback.
 */
export function countryName(
  code: string | null | undefined,
  fallback = "—",
): string {
  if (code == null) return fallback;
  const trimmed = String(code).trim();
  if (!trimmed) return fallback;
  return COUNTRY_NAMES[trimmed] ?? COUNTRY_NAMES[trimmed.toUpperCase()] ?? trimmed;
}
