/**
 * externalAdapters/index.ts — registry + honest status surface for the
 * Phase 9 WP-D OGA external adapter layer.
 *
 * Every adapter is disabled + gap-registered until counterpart credentials
 * exist (FG must-bring list). externalAdapterStatuses() exposes the truthful
 * operator state — adapter id, authority, registered gap, and whether the
 * env-only endpoint/signing material is configured — without ever leaking
 * secret values.
 */

import { PLATFORM_GAPS, type PlatformGap } from "../gapRegistry";
import type { ExternalAdapter, ExternalAdapterStatus } from "./base";
import { cbnTmsAdapter } from "./cbnTms";
import { ncsBodogwuAdapter } from "./ncsBodogwu";
import { nepcAdapter } from "./nepc";
import { nisAdapter } from "./nis";
import { npaEsenAdapter } from "./npaEsen";
import { portHealthAdapter } from "./portHealth";

export * from "./base";
export { cbnTmsAdapter, ncsBodogwuAdapter, nepcAdapter, nisAdapter, npaEsenAdapter, portHealthAdapter };

/** All registered OGA external adapters (fail-closed until configured). */
export const EXTERNAL_ADAPTERS: readonly ExternalAdapter[] = [
  ncsBodogwuAdapter,
  cbnTmsAdapter,
  nepcAdapter,
  nisAdapter,
  portHealthAdapter,
  npaEsenAdapter,
] as const;

export interface ExternalAdapterStatusReport extends ExternalAdapterStatus {
  /** The registered platform gap disclosed while the adapter is disabled. */
  gap: PlatformGap | null;
}

function gapById(id: string): PlatformGap | null {
  for (const gap of Object.values(PLATFORM_GAPS)) {
    if (gap.id === id) return gap;
  }
  return null;
}

/**
 * Truthful per-adapter status for operator/honesty surfaces: every adapter
 * is either "configured" (endpoint + signing material set) or
 * "disabled_gap_registered" with its gap object attached.
 */
export function externalAdapterStatuses(): ExternalAdapterStatusReport[] {
  return EXTERNAL_ADAPTERS.map((adapter) => ({ ...adapter.status(), gap: gapById(adapter.gapId) }));
}
