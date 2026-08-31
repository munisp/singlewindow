/**
 * imoCompendium.ts — IMO Compendium Reference Model wire-conformance layer
 * (Phase 10 WP-3). Transforms accepted MSW declaration versions (FAL 1-7 +
 * MDOH) into the IMO Compendium message shape for MSW-to-MSW exchange, and
 * reverse-maps inbound foreign-MSW messages into platform declaration drafts.
 *
 * Contract (blueeconomy-contracts branch phase10/wp3-conformance, NORMATIVE):
 *   docs/imo-wco-conformance.md,
 *   mappings/msw/v1/<form>.yaml (vendored as server/data/imoMapping/v1/*.json),
 *   schema/msw/v1/imo/imomsw-message.schema.json.
 *
 * FAIL CLOSED (docs/imo-wco-conformance.md §2):
 *   - unknown/unmapped platform field       → IMO_EXPORT_UNMAPPED_ELEMENT
 *   - missing mandatory IMO element         → IMO_EXPORT_MISSING_MANDATORY
 *   - type/pattern violation                → IMO_EXPORT_TYPE_VIOLATION
 *   - unregistered extension                → IMO_EXPORT_UNREGISTERED_EXTENSION
 *   - inbound unknown IMO element/extension → IMO_IMPORT_UNMAPPED_ELEMENT /
 *                                             IMO_IMPORT_UNREGISTERED_EXTENSION
 *   Nothing is ever silently dropped; absent optional values are omitted,
 *   never fabricated.
 *
 * DIGEST-BOUND: every export carries source.formPayloadDigestSha256 — the
 * sha256 (JCS-canonical) digest of the accepted declaration version it was
 * transformed from (mswService.mswDigestOf). The exporter verifies the
 * supplied digest matches the payload (IMO_EXPORT_DIGEST_MISMATCH) so a stale
 * or mismatched version can never be exported under a borrowed digest.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeJcs } from "./pcsEnvelope";
import { MSW_FORM_TYPES, MSW_PERSONAL_DATA_FORMS, type MswFormType } from "./mswEnvelope";

// ─── Reason codes (stable, machine-readable) ─────────────────────────────────

export const IMO_REASON_CODES = [
  "IMO_EXPORT_UNMAPPED_ELEMENT",
  "IMO_EXPORT_MISSING_MANDATORY",
  "IMO_EXPORT_TYPE_VIOLATION",
  "IMO_EXPORT_UNREGISTERED_EXTENSION",
  "IMO_EXPORT_DIGEST_MISMATCH",
  "IMO_IMPORT_UNMAPPED_ELEMENT",
  "IMO_IMPORT_MISSING_MANDATORY",
  "IMO_IMPORT_TYPE_VIOLATION",
  "IMO_IMPORT_UNREGISTERED_EXTENSION",
  "IMO_IMPORT_SHAPE_VIOLATION",
  "IMO_MAPPING_UNAVAILABLE",
] as const;
export type ImoReasonCode = (typeof IMO_REASON_CODES)[number];

export class ImoConformanceError extends Error {
  constructor(
    public readonly reasonCode: ImoReasonCode,
    message: string
  ) {
    super(message);
    this.name = "ImoConformanceError";
  }
}

// ─── Mapping-table types (mirror of mappings/msw/v1/<form>.yaml) ─────────────

interface MappingField {
  platform: string;
  type: "string" | "integer" | "number" | "boolean" | "datetime" | "array";
  pattern?: string;
  mandatory: boolean;
  imoPath: string;
  wcoPath: string | null;
  repeating?: boolean;
  itemFields?: MappingField[];
}

interface FormMapping {
  mappingVersion: string;
  form: MswFormType;
  imoMessage: string;
  fields: MappingField[];
  extensionFields: string[];
}

// ESM-safe (package.json "type": "module"); mirrors lib/certificatePdf.ts.
const MODULE_DIR =
  typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const MAPPING_DIR = path.join(MODULE_DIR, "..", "data", "imoMapping", "v1");

const mappingCache = new Map<MswFormType, FormMapping>();
let extensionRegistryCache: Record<MswFormType, Set<string>> | null = null;

/** Loads (and caches) the vendored mapping table for a form. Fail closed. */
export function loadFormMapping(formType: MswFormType): FormMapping {
  const cached = mappingCache.get(formType);
  if (cached) return cached;
  let raw: string;
  try {
    raw = readFileSync(path.join(MAPPING_DIR, `${formType.toLowerCase()}.json`), "utf8");
  } catch {
    throw new ImoConformanceError(
      "IMO_MAPPING_UNAVAILABLE",
      `no vendored IMO mapping table for form ${formType}`
    );
  }
  const mapping = JSON.parse(raw) as FormMapping;
  if (mapping.mappingVersion !== "1.0" || mapping.form !== formType || !Array.isArray(mapping.fields)) {
    throw new ImoConformanceError(
      "IMO_MAPPING_UNAVAILABLE",
      `vendored IMO mapping table for ${formType} is malformed or version-mismatched`
    );
  }
  mappingCache.set(formType, mapping);
  return mapping;
}

function loadExtensionRegistry(): Record<MswFormType, Set<string>> {
  if (extensionRegistryCache) return extensionRegistryCache;
  let raw: string;
  try {
    raw = readFileSync(path.join(MAPPING_DIR, "extension-registry.json"), "utf8");
  } catch {
    throw new ImoConformanceError("IMO_MAPPING_UNAVAILABLE", "extension registry is unavailable");
  }
  const parsed = JSON.parse(raw) as { registryVersion: string; extensions: { form: MswFormType; field: string }[] };
  if (parsed.registryVersion !== "1.0" || !Array.isArray(parsed.extensions)) {
    throw new ImoConformanceError("IMO_MAPPING_UNAVAILABLE", "extension registry is malformed");
  }
  const registry = Object.fromEntries(MSW_FORM_TYPES.map((f) => [f, new Set<string>()])) as Record<MswFormType, Set<string>>;
  for (const entry of parsed.extensions) {
    registry[entry.form]?.add(entry.field);
  }
  extensionRegistryCache = registry;
  return registry;
}

// ─── Value validation ────────────────────────────────────────────────────────

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function validateValue(field: MappingField, value: unknown, errPrefix: "IMO_EXPORT" | "IMO_IMPORT", where: string): void {
  const fail = (detail: string): never => {
    throw new ImoConformanceError(
      `${errPrefix}_TYPE_VIOLATION` as ImoReasonCode,
      `${where}: ${detail} (field '${field.platform}')`
    );
  };
  switch (field.type) {
    case "string":
      if (typeof value !== "string" || value.length === 0) fail(`expected non-empty string, got ${JSON.stringify(value)}`);
      break;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) fail(`expected integer, got ${JSON.stringify(value)}`);
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) fail(`expected finite number, got ${JSON.stringify(value)}`);
      break;
    case "boolean":
      if (typeof value !== "boolean") fail(`expected boolean, got ${JSON.stringify(value)}`);
      break;
    case "datetime":
      if (typeof value !== "string" || !DATETIME_RE.test(value)) fail(`expected RFC 3339 datetime, got ${JSON.stringify(value)}`);
      break;
    default:
      fail(`unsupported scalar type '${field.type}'`);
  }
  if (field.pattern && typeof value === "string" && !new RegExp(field.pattern).test(value)) {
    fail(`value ${JSON.stringify(value)} violates pattern ${field.pattern}`);
  }
}

// ─── Path helpers (imoPath segments ↔ nested wire object) ───────────────────

function setPath(target: Record<string, unknown>, imoPath: string, value: unknown): void {
  const segments = imoPath.split("/");
  let node = target;
  for (const seg of segments.slice(0, -1)) {
    const next = node[seg];
    if (next === undefined) {
      node[seg] = {};
    } else if (typeof next !== "object" || next === null || Array.isArray(next)) {
      throw new ImoConformanceError("IMO_MAPPING_UNAVAILABLE", `imoPath collision at ${imoPath}`);
    }
    node = node[seg] as Record<string, unknown>;
  }
  node[segments[segments.length - 1]] = value;
}

function getPath(source: Record<string, unknown>, imoPath: string): unknown {
  const segments = imoPath.split("/");
  let node: unknown = source;
  for (const seg of segments) {
    if (typeof node !== "object" || node === null || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

/** Collects every key path present in a nested wire object (arrays → "<path>[]"). */
function collectPaths(node: unknown, prefix: string, sink: Set<string>): void {
  if (Array.isArray(node)) {
    sink.add(`${prefix}[]`);
    for (const item of node) collectPaths(item, `${prefix}[]`, sink);
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      collectPaths(v, prefix ? `${prefix}/${k}` : k, sink);
    }
    return;
  }
  sink.add(prefix);
}

// ─── Export (platform declaration → IMO message) ─────────────────────────────

export interface ImoExportInput {
  formType: MswFormType;
  declarationId: string;
  visitId: string;
  version: number;
  /** sha256:<64 hex> of the JCS-canonical formPayload (mswService.mswDigestOf). */
  formPayloadDigestSha256: string;
  /** The accepted declaration form payload (platform field names). */
  formPayload: Record<string, unknown>;
  /** MSW operator identifier of this window (env-governed at the boundary). */
  sender: string;
  messageId: string;
  issuedAt: string;
}

export interface ImoMswMessage {
  messageType: "IMO-MSW-FAL-EXPORT" | "IMO-MSW-FAL-IMPORT";
  specVersion: "1.0";
  messageId: string;
  issuedAt: string;
  sender: string;
  formType: MswFormType;
  source?: {
    declarationId: string;
    visitId: string;
    version: number;
    formPayloadDigestSha256: string;
  };
  imoMessage: Record<string, unknown>;
  extensions?: { blueeconomy: Record<string, Record<string, unknown>> };
}

function mapScalarFields(
  fields: MappingField[],
  payload: Record<string, unknown>,
  out: Record<string, unknown>,
  direction: "IMO_EXPORT" | "IMO_IMPORT",
  where: string,
  seen: Set<string>
): void {
  for (const field of fields) {
    seen.add(field.platform);
    const value = payload[field.platform];
    if (value === undefined || value === null) {
      if (field.mandatory) {
        throw new ImoConformanceError(
          `${direction}_MISSING_MANDATORY` as ImoReasonCode,
          `${where}: mandatory IMO element '${field.imoPath}' cannot be populated — platform field '${field.platform}' is absent`
        );
      }
      continue; // absent optional → omitted, never fabricated
    }
    if (field.repeating) {
      if (!Array.isArray(value)) {
        throw new ImoConformanceError(`${direction}_TYPE_VIOLATION` as ImoReasonCode, `${where}: field '${field.platform}' must be an array`);
      }
      if (field.mandatory && value.length === 0) {
        throw new ImoConformanceError(`${direction}_MISSING_MANDATORY` as ImoReasonCode, `${where}: mandatory list '${field.imoPath}' is empty`);
      }
      const items = value.map((item, i) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          throw new ImoConformanceError(`${direction}_TYPE_VIOLATION` as ImoReasonCode, `${where}: '${field.platform}[${i}]' must be an object`);
        }
        const itemOut: Record<string, unknown> = {};
        const itemSeen = new Set<string>();
        mapScalarFields(field.itemFields ?? [], item as Record<string, unknown>, itemOut, direction, `${where}.${field.platform}[${i}]`, itemSeen);
        const unknownItemFields = Object.keys(item as Record<string, unknown>).filter((k) => !itemSeen.has(k));
        if (unknownItemFields.length > 0) {
          throw new ImoConformanceError(
            `${direction}_UNMAPPED_ELEMENT` as ImoReasonCode,
            `${where}.${field.platform}[${i}]: unmapped fields ${unknownItemFields.join(", ")} — refusing to drop data silently`
          );
        }
        return itemOut;
      });
      setPath(out, field.imoPath, items);
      continue;
    }
    validateValue(field, value, direction, where);
    setPath(out, field.imoPath, value);
  }
}

/**
 * Transforms an accepted platform declaration version into the IMO Compendium
 * message shape. Fail closed; digest-bound; round-trip lossless for mapped
 * fields. Personal-data forms (FAL4/5/6/MDOH) remain RESTRICTED-floored —
 * classification is applied by the envelope layer (mswExchange), not here.
 */
export function exportDeclarationToImo(input: ImoExportInput): ImoMswMessage {
  const mapping = loadFormMapping(input.formType);
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new ImoConformanceError("IMO_EXPORT_TYPE_VIOLATION", "version must be an integer >= 1");
  }
  const actualDigest = `sha256:${createHash("sha256").update(canonicalizeJcs(input.formPayload), "utf8").digest("hex")}`;
  if (input.formPayloadDigestSha256 !== actualDigest) {
    throw new ImoConformanceError(
      "IMO_EXPORT_DIGEST_MISMATCH",
      `supplied source digest ${input.formPayloadDigestSha256} does not match the payload digest ${actualDigest} — refusing to export a mismatched version`
    );
  }

  const imoMessage: Record<string, unknown> = {};
  const seen = new Set<string>();
  mapScalarFields(mapping.fields, input.formPayload, imoMessage, "IMO_EXPORT", input.formType, seen);

  const registry = loadExtensionRegistry();
  const extensions: Record<string, unknown> = {};
  const unknown: string[] = [];
  for (const key of Object.keys(input.formPayload)) {
    if (seen.has(key)) continue;
    if (registry[input.formType].has(key)) {
      extensions[key] = input.formPayload[key];
    } else {
      unknown.push(key);
    }
  }
  if (unknown.length > 0) {
    throw new ImoConformanceError(
      "IMO_EXPORT_UNMAPPED_ELEMENT",
      `${input.formType}: platform fields [${unknown.join(", ")}] have no IMO Compendium element and are not registered extensions — export rejected, nothing dropped silently`
    );
  }

  const message: ImoMswMessage = {
    messageType: "IMO-MSW-FAL-EXPORT",
    specVersion: "1.0",
    messageId: input.messageId,
    issuedAt: input.issuedAt,
    sender: input.sender,
    formType: input.formType,
    source: {
      declarationId: input.declarationId,
      visitId: input.visitId,
      version: input.version,
      formPayloadDigestSha256: input.formPayloadDigestSha256,
    },
    imoMessage,
  };
  if (Object.keys(extensions).length > 0) {
    message.extensions = { blueeconomy: { [input.formType]: extensions } };
  }
  return message;
}

// ─── Import (foreign IMO message → platform declaration draft) ───────────────

export interface ImoImportResult {
  formType: MswFormType;
  /** Platform-field-named payload for the declaration DRAFT. */
  formPayload: Record<string, unknown>;
  /** Provenance stamp recorded on the draft (docs/imo-wco-conformance.md §5). */
  provenance: {
    direction: "IMPORT";
    foreignSender: string;
    sourceMessageId: string;
    importedAt: string;
  };
  /** True when the form carries NDPA PERSONAL data (envelope floors at RESTRICTED). */
  containsPersonalData: boolean;
}

/**
 * Reverse-maps a validated inbound IMO message into a platform declaration
 * draft. The draft is NEVER auto-accepted: it must traverse the platform's
 * own submission/maker-checker lifecycle. Fail closed on unknown IMO
 * elements, unregistered extensions, missing mandatory elements and type
 * violations.
 */
export function importImoToDeclaration(message: unknown, importedAt: string): ImoImportResult {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    throw new ImoConformanceError("IMO_IMPORT_SHAPE_VIOLATION", "message must be an object");
  }
  const m = message as Record<string, unknown>;
  if (m.specVersion !== "1.0" || (m.messageType !== "IMO-MSW-FAL-EXPORT" && m.messageType !== "IMO-MSW-FAL-IMPORT")) {
    throw new ImoConformanceError("IMO_IMPORT_SHAPE_VIOLATION", "specVersion must be '1.0' with an IMO-MSW-FAL messageType");
  }
  if (typeof m.messageId !== "string" || m.messageId.length < 8 || typeof m.sender !== "string" || m.sender.length === 0) {
    throw new ImoConformanceError("IMO_IMPORT_SHAPE_VIOLATION", "messageId/sender missing or malformed");
  }
  const formType = m.formType as MswFormType;
  if (!(MSW_FORM_TYPES as readonly string[]).includes(formType)) {
    throw new ImoConformanceError("IMO_IMPORT_SHAPE_VIOLATION", `unknown formType ${JSON.stringify(m.formType)}`);
  }
  if (typeof m.imoMessage !== "object" || m.imoMessage === null || Array.isArray(m.imoMessage)) {
    throw new ImoConformanceError("IMO_IMPORT_SHAPE_VIOLATION", "imoMessage must be an object");
  }
  const mapping = loadFormMapping(formType);
  const wire = m.imoMessage as Record<string, unknown>;

  const formPayload: Record<string, unknown> = {};
  const extract = (fields: MappingField[], fromWire: Record<string, unknown>, into: Record<string, unknown>, where: string) => {
    for (const field of fields) {
      const value = getPath(fromWire, field.imoPath);
      if (value === undefined || value === null) {
        if (field.mandatory) {
          throw new ImoConformanceError(
            "IMO_IMPORT_MISSING_MANDATORY",
            `${where}: mandatory IMO element '${field.imoPath}' is absent — import rejected`
          );
        }
        continue;
      }
      if (field.repeating) {
        if (!Array.isArray(value)) {
          throw new ImoConformanceError("IMO_IMPORT_TYPE_VIOLATION", `${where}: '${field.imoPath}' must be an array`);
        }
        if (field.mandatory && value.length === 0) {
          throw new ImoConformanceError("IMO_IMPORT_MISSING_MANDATORY", `${where}: mandatory list '${field.imoPath}' is empty`);
        }
        into[field.platform] = value.map((item, i) => {
          if (typeof item !== "object" || item === null || Array.isArray(item)) {
            throw new ImoConformanceError("IMO_IMPORT_TYPE_VIOLATION", `${where}: '${field.imoPath}[${i}]' must be an object`);
          }
          const itemOut: Record<string, unknown> = {};
          extract(field.itemFields ?? [], wrapItem(field, item as Record<string, unknown>), itemOut, `${where}.${field.platform}[${i}]`);
          return itemOut;
        });
        continue;
      }
      validateValue(field, value, "IMO_IMPORT", where);
      into[field.platform] = value;
    }
  };

  // Fail closed on ANY wire element not covered by the mapping (incl. item fields).
  const coveredPaths = new Set<string>();
  const cover = (fields: MappingField[]) => {
    for (const f of fields) {
      if (f.repeating) {
        coveredPaths.add(`${f.imoPath}[]`);
        for (const sub of f.itemFields ?? []) coveredPaths.add(`${f.imoPath}[]/${sub.imoPath}`);
      } else {
        coveredPaths.add(f.imoPath);
      }
    }
  };
  cover(mapping.fields);
  const presentPaths = new Set<string>();
  collectPaths(wire, "", presentPaths);
  const unmapped = [...presentPaths].filter((p) => !coveredPaths.has(p));
  if (unmapped.length > 0) {
    throw new ImoConformanceError(
      "IMO_IMPORT_UNMAPPED_ELEMENT",
      `${formType}: inbound IMO elements [${unmapped.join(", ")}] are not in the mapping table — import rejected, nothing dropped silently`
    );
  }

  extract(mapping.fields, wire, formPayload, formType);

  // Registered extensions (only) flow back into the draft payload.
  if (m.extensions !== undefined) {
    const ext = m.extensions as Record<string, unknown>;
    const keys = Object.keys(ext);
    if (keys.some((k) => k !== "blueeconomy")) {
      throw new ImoConformanceError("IMO_IMPORT_UNREGISTERED_EXTENSION", `unknown extension namespaces [${keys.join(", ")}]`);
    }
    const be = (ext.blueeconomy ?? {}) as Record<string, unknown>;
    const formExt = (be[formType] ?? {}) as Record<string, unknown>;
    const registry = loadExtensionRegistry();
    for (const [k, v] of Object.entries(formExt)) {
      if (!registry[formType].has(k)) {
        throw new ImoConformanceError("IMO_IMPORT_UNREGISTERED_EXTENSION", `extension '${k}' is not registered for ${formType}`);
      }
      formPayload[k] = v;
    }
  }

  return {
    formType,
    formPayload,
    provenance: {
      direction: "IMPORT",
      foreignSender: m.sender as string,
      sourceMessageId: m.messageId as string,
      importedAt,
    },
    containsPersonalData: MSW_PERSONAL_DATA_FORMS.has(formType),
  };
}

/** Re-roots repeating-item sub-paths (itemFields carry relative imoPaths). */
function wrapItem(field: MappingField, item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const sub of field.itemFields ?? []) {
    const v = getPath(item, sub.imoPath);
    if (v !== undefined) setPath(out, sub.imoPath, v);
  }
  return out;
}
