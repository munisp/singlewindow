/**
 * sanitize.ts — Input sanitization utilities for TradeGateway NGSWTP
 *
 * Provides:
 *   - sanitizeString()    — strip XSS payloads from user strings
 *   - sanitizeObject()    — recursively sanitize all string values in an object
 *   - sanitizeMiddleware  — Express middleware to sanitize req.body, req.query, req.params
 *   - validateEmail()     — RFC 5322 email validation
 *   - validateUrl()       — URL validation with allowlist
 *   - validateHsCode()    — WCO HS code format validation (6-10 digits)
 *   - validateIso3166()   — ISO 3166-1 alpha-2 country code validation
 *
 * All sanitization is defence-in-depth — Zod schemas are the primary validation layer.
 */
import { filterXSS, IFilterXSSOptions } from "xss";
import isEmail from "validator/lib/isEmail.js";
import isURL from "validator/lib/isURL.js";
import { Request, Response, NextFunction } from "express";

// ── XSS options — strip all tags and attributes ───────────────────────────────
const XSS_OPTIONS: IFilterXSSOptions = {
  whiteList: {},          // No HTML tags allowed in API inputs
  stripIgnoreTag: true,   // Strip unknown tags entirely
  stripIgnoreTagBody: ["script", "style", "iframe", "object", "embed"],
};

/**
 * Sanitize a single string value — strips XSS payloads.
 */
export function sanitizeString(value: string): string {
  if (typeof value !== "string") return value;
  return filterXSS(value.trim(), XSS_OPTIONS);
}

/**
 * Recursively sanitize all string values in an object or array.
 * Non-string primitives (numbers, booleans, dates) are passed through unchanged.
 */
export function sanitizeObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return sanitizeString(obj) as unknown as T;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item)) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = sanitizeObject(value);
  }
  return result as T;
}

/**
 * Express middleware — sanitize req.body, req.query, and req.params.
 * Applied globally to all routes.
 */
export function sanitizeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  try {
    if (req.body && typeof req.body === "object") {
      req.body = sanitizeObject(req.body);
    }
    // Express 5: req.query is a getter-only property on IncomingMessage.
    // We must NOT assign to it. Instead, sanitize the values in-place by
    // iterating the existing object and replacing string values directly.
    if (req.query && typeof req.query === "object") {
      const q = req.query as Record<string, unknown>;
      for (const key of Object.keys(q)) {
        if (typeof q[key] === "string") {
          q[key] = sanitizeString(q[key] as string);
        }
      }
    }
    if (req.params && typeof req.params === "object") {
      const p = req.params as Record<string, string>;
      for (const key of Object.keys(p)) {
        if (typeof p[key] === "string") {
          p[key] = sanitizeString(p[key]);
        }
      }
    }
  } catch {
    // Sanitization errors must never block the request
  }
  next();
}

// ── Domain-specific validators ─────────────────────────────────────────────────

/**
 * Validate email address (RFC 5322).
 */
export function validateEmail(email: string): boolean {
  return isEmail(email, { allow_utf8_local_part: false });
}

/**
 * Validate a URL (http/https only).
 */
export function validateUrl(url: string): boolean {
  return isURL(url, {
    protocols: ["http", "https"],
    require_protocol: true,
    require_tld: true,
  });
}

/**
 * Validate WCO Harmonized System code (6–10 digits, optionally with dots).
 * Examples: "0101.21", "010121", "0101210000"
 */
export function validateHsCode(code: string): boolean {
  const cleaned = code.replace(/\./g, "");
  return /^\d{6,10}$/.test(cleaned);
}

/**
 * Validate ISO 3166-1 alpha-2 country code.
 */
const ISO3166_ALPHA2 = new Set([
  "AD","AE","AF","AG","AI","AL","AM","AO","AQ","AR","AS","AT","AU","AW","AX","AZ",
  "BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS",
  "BT","BV","BW","BY","BZ","CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN",
  "CO","CR","CU","CV","CW","CX","CY","CZ","DE","DJ","DK","DM","DO","DZ","EC","EE",
  "EG","EH","ER","ES","ET","FI","FJ","FK","FM","FO","FR","GA","GB","GD","GE","GF",
  "GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY","HK","HM",
  "HN","HR","HT","HU","ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT","JE","JM",
  "JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC",
  "LI","LK","LR","LS","LT","LU","LV","LY","MA","MC","MD","ME","MF","MG","MH","MK",
  "ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ","NA",
  "NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ","OM","PA","PE","PF","PG",
  "PH","PK","PL","PM","PN","PR","PS","PT","PW","PY","QA","RE","RO","RS","RU","RW",
  "SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS",
  "ST","SV","SX","SY","SZ","TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO",
  "TR","TT","TV","TW","TZ","UA","UG","UM","US","UY","UZ","VA","VC","VE","VG","VI",
  "VN","VU","WF","WS","YE","YT","ZA","ZM","ZW",
]);

export function validateIso3166(code: string): boolean {
  return ISO3166_ALPHA2.has(code.toUpperCase());
}

/**
 * Validate a declaration number format: TG-YYYY-XXXXXXXX
 */
export function validateDeclarationNumber(num: string): boolean {
  return /^TG-\d{4}-[A-Z0-9]{6,12}$/.test(num);
}

/**
 * Validate a UCR (Unique Consignment Reference) — WCO format.
 * Format: 2-char country + 2-char year + up to 31 chars
 */
export function validateUcr(ucr: string): boolean {
  return /^[A-Z]{2}\d{2}[A-Z0-9]{1,31}$/.test(ucr.toUpperCase());
}

/**
 * Validate a SWIFT/BIC code.
 */
export function validateSwiftCode(swift: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swift.toUpperCase());
}

/**
 * Validate an IBAN.
 */
export function validateIban(iban: string): boolean {
  const cleaned = iban.replace(/\s/g, "").toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(cleaned);
}

/**
 * Sanitize a free-text field to max length, stripping XSS.
 */
export function sanitizeText(value: string, maxLength = 2000): string {
  return sanitizeString(value).substring(0, maxLength);
}

/**
 * Sanitize a short name/title field.
 */
export function sanitizeName(value: string, maxLength = 255): string {
  return sanitizeString(value).substring(0, maxLength);
}
