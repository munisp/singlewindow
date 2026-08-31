#!/usr/bin/env node
/**
 * agencySandboxKeygen.mjs — generates a TEST-ONLY Ed25519 keypair for the
 * agency-sandbox e2e run (platform egress key, sandbox signing keys, rogue
 * keys, conformance-report key). Prints JSON:
 *   { "seed": "<base64url 32-byte seed>", "public": "<base64url 32-byte raw public key>" }
 * Never writes to disk; callers keep material in memory/env only.
 */
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const privJwk = privateKey.export({ format: "jwk" });
const pubJwk = publicKey.export({ format: "jwk" });
process.stdout.write(JSON.stringify({ seed: privJwk.d, public: pubJwk.x }));
