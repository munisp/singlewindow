/**
 * RFC 8785 — JSON Canonicalization Scheme (JCS)
 *
 * Produces the canonical byte representation of a JSON value:
 *  - Object members sorted by key using UTF-16 code-unit order; no whitespace.
 *  - Strings use minimal JSON escaping (JSON.stringify semantics).
 *  - Numbers follow ECMAScript Number::toString shortest round-trip semantics.
 *  - No duplicate keys possible (input is a parsed JS value).
 *
 * This is the normative canonicalization for envelope v1.0 signed payloads
 * (see blueeconomy-contracts docs/envelope-signature.md). Any divergence is a
 * security defect — do not modify without updating every producer/consumer.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export function canonicalizeJcs(value: JsonValue): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value)) {
        throw new Error("JCS: non-finite numbers are not permitted");
      }
      // JSON.stringify(number) implements ECMAScript Number::toString.
      return JSON.stringify(value);
    }
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return "[" + value.map((v) => canonicalizeJcs(v)).join(",") + "]";
      }
      const keys = Object.keys(value).sort(); // UTF-16 code-unit order
      const members = keys.map(
        (k) => JSON.stringify(k) + ":" + canonicalizeJcs(value[k])
      );
      return "{" + members.join(",") + "}";
    }
    default:
      throw new Error(`JCS: unsupported value type ${typeof value}`);
  }
}
