#!/usr/bin/env node
/** Minimal structural validation for the self-hosted runner Compose manifest. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as yaml from "js-yaml";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = join(here, "compose.yml");
const data = yaml.load(readFileSync(manifest, "utf8"));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(data && typeof data === "object", "Compose manifest must be a mapping");
const runner = data.services?.runner;
assert(runner && typeof runner === "object", "services.runner is required");
assert(runner.network_mode === "host", "Runner must use host networking to reach GitHub Actions service ports published on localhost");
assert(runner.restart === "unless-stopped", "Runner must restart after a host restart");
assert(runner.environment?.RUNNER_TOKEN_FILE === "/run/runner-secrets/registration-token", "Runner must read a mounted token file");
assert(runner.volumes?.includes("/var/run/docker.sock:/var/run/docker.sock"), "Docker socket mount is required by service-container CI");
assert(runner.volumes?.some((volume) => String(volume).endsWith(":/run/runner-secrets/registration-token:ro")), "Registration token must be mounted read-only");
assert(JSON.stringify(runner.cap_drop) === JSON.stringify(["ALL"]), "All Linux capabilities must be dropped before adding the minimal set");
assert(new Set(runner.cap_add ?? []).size === 3 && ["CHOWN", "SETGID", "SETUID"].every((capability) => runner.cap_add.includes(capability)), "Only capabilities needed for socket-group mapping are allowed");
assert(JSON.stringify(runner.security_opt) === JSON.stringify(["no-new-privileges:true"]), "no-new-privileges is required");
assert(Object.hasOwn(data.volumes ?? {}, "runner-work"), "Runner work volume is required");

console.log(`Validated ${manifest}: runner compose structure and security controls are present.`);
