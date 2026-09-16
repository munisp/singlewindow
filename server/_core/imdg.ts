/**
 * imdg.ts — Structural IMDG dangerous-goods validation (Phase 19, F5a / A5-B9).
 *
 * This module performs LOCAL, STRUCTURAL validation of dangerous-goods line
 * items only: UN number format/range, IMO class & division membership,
 * packing-group applicability per class, flashpoint/EmS formatting rules.
 *
 * It deliberately does NOT ship a substance database. Whether a given UN
 * number corresponds to a named substance, its correct proper shipping name,
 * segregation group, or special provisions requires the licensed IMDG Code
 * data, which is not configured in this deployment. The router exposes an
 * honest IMDG_CODE_LOOKUP_NOT_CONFIGURED state for that need — structural
 * validation here never fabricates substance-level facts.
 *
 * Structural rules encoded (IMDG Code part 2 / UN Model Regulations):
 *   - UN number: 4 digits, assigned range 0004–3550.
 *   - Classes/divisions: 1.1–1.6, 2.1–2.3, 3, 4.1–4.3, 5.1–5.2, 6.1–6.2, 7, 8, 9.
 *   - Packing group I/II/III applies only to classes 3, 4.x, 5.1, 6.1, 8, 9;
 *     it must be ABSENT for classes 1.x, 2.x, 5.2, 6.2 and 7.
 *   - Flashpoint (°C, closed cup) is REQUIRED for class 3 liquids and is
 *     structurally bounded (-100..300); optional otherwise.
 *   - EmS codes: one fire schedule (F-A..F-J) and/or one spillage schedule
 *     (S-A..S-Z), format "F-X" / "S-X".
 */

export const UN_NUMBER_MIN = 4;
export const UN_NUMBER_MAX = 3550;

/** All admitted IMDG class/division codes. */
export const IMDG_CLASS_CODES = [
  "1.1", "1.2", "1.3", "1.4", "1.5", "1.6",
  "2.1", "2.2", "2.3",
  "3",
  "4.1", "4.2", "4.3",
  "5.1", "5.2",
  "6.1", "6.2",
  "7",
  "8",
  "9",
] as const;
export type ImdgClassCode = (typeof IMDG_CLASS_CODES)[number];

export const PACKING_GROUPS = ["I", "II", "III"] as const;
export type PackingGroup = (typeof PACKING_GROUPS)[number];

/** Divisions for which a packing group is meaningful/required. */
const PACKING_GROUP_CLASSES = new Set(["3", "4.1", "4.2", "4.3", "5.1", "6.1", "8", "9"]);

const UN_NUMBER_RE = /^[0-9]{4}$/;
const EMS_FIRE_RE = /^F-[A-J]$/;
const EMS_SPILLAGE_RE = /^S-[A-Z]$/;

export function isImdgClassCode(value: string): value is ImdgClassCode {
  return (IMDG_CLASS_CODES as readonly string[]).includes(value);
}

export function packingGroupApplies(imoClass: string): boolean {
  return PACKING_GROUP_CLASSES.has(imoClass);
}

export interface ImdgItemInput {
  unNumber: string;
  imoClass: string;
  packingGroup?: string | null;
  properShippingName: string;
  flashpointCelsius?: number | null;
  emsCodes?: string[] | null;
  marinePollutant?: boolean | null;
}

export interface ImdgValidationResult {
  ok: boolean;
  errors: string[];
  /** Normalized fields (only meaningful when ok === true). */
  normalized?: {
    unNumber: string;
    imoClass: ImdgClassCode;
    packingGroup: PackingGroup | null;
    properShippingName: string;
    flashpointCelsius: number | null;
    emsCodes: string[];
    marinePollutant: boolean;
  };
}

/**
 * Structurally validate one dangerous-goods line item. Returns ALL detected
 * violations (never throws) so the caller can fail closed with a complete
 * BAD_REQUEST diagnostic.
 */
export function validateImdgItem(input: ImdgItemInput): ImdgValidationResult {
  const errors: string[] = [];

  // ── UN number ────────────────────────────────────────────────────────────
  const unNumber = (input.unNumber ?? "").trim();
  if (!UN_NUMBER_RE.test(unNumber)) {
    errors.push("unNumber must be exactly 4 digits (e.g. '1203')");
  } else {
    const n = Number.parseInt(unNumber, 10);
    if (n < UN_NUMBER_MIN || n > UN_NUMBER_MAX) {
      errors.push(`unNumber ${unNumber} is outside the assigned UN range 0004–3550`);
    }
  }

  // ── IMO class/division ───────────────────────────────────────────────────
  const imoClass = (input.imoClass ?? "").trim();
  if (!isImdgClassCode(imoClass)) {
    errors.push(
      `imoClass '${imoClass}' is not an admitted IMDG class/division (${IMDG_CLASS_CODES.join(", ")})`
    );
  }

  // ── Packing group rules per class ────────────────────────────────────────
  let packingGroup: PackingGroup | null = null;
  const rawPg = input.packingGroup == null ? null : String(input.packingGroup).trim().toUpperCase();
  if (isImdgClassCode(imoClass)) {
    if (rawPg) {
      if (!(PACKING_GROUPS as readonly string[]).includes(rawPg)) {
        errors.push("packingGroup must be I, II or III");
      } else if (!packingGroupApplies(imoClass)) {
        errors.push(
          `packingGroup is not applicable to class ${imoClass} (only classes 3, 4.x, 5.1, 6.1, 8, 9 carry packing groups)`
        );
      } else {
        packingGroup = rawPg as PackingGroup;
      }
    } else if (packingGroupApplies(imoClass)) {
      errors.push(`packingGroup is required for class ${imoClass}`);
    }
  }

  // ── Proper shipping name ─────────────────────────────────────────────────
  const psn = (input.properShippingName ?? "").trim();
  if (psn.length < 2 || psn.length > 256) {
    errors.push("properShippingName must be 2–256 characters");
  }

  // ── Flashpoint ───────────────────────────────────────────────────────────
  let flashpointCelsius: number | null = null;
  if (input.flashpointCelsius != null) {
    const fp = Number(input.flashpointCelsius);
    if (!Number.isFinite(fp) || fp < -100 || fp > 300) {
      errors.push("flashpointCelsius must be a finite value between -100 and 300");
    } else {
      flashpointCelsius = fp;
    }
  }
  if (imoClass === "3" && flashpointCelsius == null) {
    errors.push("flashpointCelsius is required for class 3 (flammable liquids)");
  }

  // ── EmS codes ────────────────────────────────────────────────────────────
  const emsCodes: string[] = [];
  if (input.emsCodes != null) {
    if (!Array.isArray(input.emsCodes) || input.emsCodes.length > 4) {
      errors.push("emsCodes must be an array of at most 4 codes");
    } else {
      let fire = 0;
      let spillage = 0;
      for (const raw of input.emsCodes) {
        const code = String(raw ?? "").trim().toUpperCase();
        if (EMS_FIRE_RE.test(code)) {
          fire += 1;
          emsCodes.push(code);
        } else if (EMS_SPILLAGE_RE.test(code)) {
          spillage += 1;
          emsCodes.push(code);
        } else {
          errors.push(`emsCode '${raw}' is not a valid EmS schedule (expected F-A..F-J or S-A..S-Z)`);
        }
      }
      if (fire > 1 || spillage > 1) {
        errors.push("at most one fire (F-x) and one spillage (S-x) EmS schedule per item");
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    errors: [],
    normalized: {
      unNumber,
      imoClass: imoClass as ImdgClassCode,
      packingGroup,
      properShippingName: psn,
      flashpointCelsius,
      emsCodes,
      marinePollutant: input.marinePollutant === true,
    },
  };
}
