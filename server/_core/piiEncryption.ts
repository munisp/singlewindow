/**
 * PII Field-Level Encryption — R5 FIX
 *
 * Uses AES-256-GCM for authenticated encryption of sensitive PII fields:
 *   - KYC document numbers (passport, national ID)
 *   - Bank account numbers in payment accounts
 *   - Trader contact details (phone, address)
 *
 * Encrypted format: base64(iv:12bytes || authTag:16bytes || ciphertext)
 * All encrypted values are prefixed with "enc:" to distinguish from plaintext.
 *
 * Key derivation: PBKDF2-SHA256 from PII_ENCRYPTION_KEY env var.
 * If PII_ENCRYPTION_KEY is not set, encryption is a no-op (dev mode).
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ENC_PREFIX = "enc:";

let _derivedKey: Buffer | null = null;

function getDerivedKey(): Buffer | null {
  if (_derivedKey) return _derivedKey;
  const secret = process.env.PII_ENCRYPTION_KEY;
  if (!secret) return null; // Graceful degradation in dev
  _derivedKey = pbkdf2Sync(secret, "tradegateway-pii-salt-v1", 100_000, 32, "sha256");
  return _derivedKey;
}

/**
 * Encrypt a plaintext PII value.
 * Returns the original value unchanged if PII_ENCRYPTION_KEY is not set.
 */
export function encryptPii(plaintext: string | null | undefined): string | null {
  if (plaintext == null) return null;
  const key = getDerivedKey();
  if (!key) return plaintext; // Dev mode — no encryption

  // Already encrypted
  if (plaintext.startsWith(ENC_PREFIX)) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Encode as: "enc:" + base64(iv || authTag || ciphertext)
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return ENC_PREFIX + combined.toString("base64");
}

/**
 * Decrypt an encrypted PII value.
 * Returns the original value unchanged if it is not encrypted or key is not set.
 */
export function decryptPii(ciphertext: string | null | undefined): string | null {
  if (ciphertext == null) return null;
  if (!ciphertext.startsWith(ENC_PREFIX)) return ciphertext; // Not encrypted

  const key = getDerivedKey();
  if (!key) return ciphertext; // Dev mode — return as-is

  try {
    const combined = Buffer.from(ciphertext.slice(ENC_PREFIX.length), "base64");
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (err) {
    console.error("[PII] Decryption failed:", err);
    return null;
  }
}

/**
 * Encrypt multiple PII fields in an object.
 * Only encrypts fields listed in `fields`.
 */
export function encryptPiiFields<T extends Record<string, any>>(
  obj: T,
  fields: (keyof T)[]
): T {
  const result = { ...obj };
  for (const field of fields) {
    if (typeof result[field] === "string") {
      (result as any)[field] = encryptPii(result[field] as string);
    }
  }
  return result;
}

/**
 * Decrypt multiple PII fields in an object.
 * Only decrypts fields listed in `fields`.
 */
export function decryptPiiFields<T extends Record<string, any>>(
  obj: T,
  fields: (keyof T)[]
): T {
  const result = { ...obj };
  for (const field of fields) {
    if (typeof result[field] === "string") {
      (result as any)[field] = decryptPii(result[field] as string);
    }
  }
  return result;
}

// ─── PII FIELD LISTS ─────────────────────────────────────────────────────────
// These are the fields that must be encrypted at rest.

/** KYC verification PII fields */
export const KYC_PII_FIELDS = [
  "documentNumber",
  "dateOfBirth",
  "address",
  "phoneNumber",
] as const;

/** Payment account PII fields */
export const PAYMENT_ACCOUNT_PII_FIELDS = [
  "bankAccountNumber",
  "bankRoutingNumber",
  "iban",
] as const;

/** Trader profile PII fields */
export const TRADER_PROFILE_PII_FIELDS = [
  "taxId",
  "nationalId",
  "phoneNumber",
  "address",
] as const;
