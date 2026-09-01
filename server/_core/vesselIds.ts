/**
 * vesselIds.ts — shared vessel identifier validators (Phase-11 remediation).
 *
 * IMO ship identification number (IMO Res. A.1117(30)): exactly 7 decimal
 * digits where the 7th is a check digit — the sum of the first six digits
 * weighted 7,6,5,4,3,2, taken mod 10, must equal the 7th digit. Example of a
 * known-valid number: 9074729.
 *
 * MMSI (ITU-R M.585): exactly 9 decimal digits; the first three are the
 * Maritime Identification Digits (MID) identifying the administering
 * country. Assignable ship-station MIDs live in the 200–799 range, so
 * anything outside that range can never be a real vessel MMSI. Nigerian
 * vessels, for example, carry MID 657.
 *
 * Every server-side acceptance path for these identifiers MUST run through
 * these validators (reject invalid input with a 400 validation error)
 * rather than re-implementing ad-hoc regexes.
 */

export const IMO_NUMBER_MESSAGE =
  "IMO number must be 7 digits with a valid weighted mod-10 check digit (IMO Res. A.1117(30))";
export const MMSI_MESSAGE =
  "MMSI must be 9 digits with a leading MID in the assignable 200-799 range (ITU-R M.585)";

export function isValidImoNumber(imo: string): boolean {
  if (!/^[0-9]{7}$/.test(imo)) return false;
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += Number(imo[i]) * (7 - i);
  return sum % 10 === Number(imo[6]);
}

export function isValidMmsi(mmsi: string): boolean {
  if (!/^[0-9]{9}$/.test(mmsi)) return false;
  const mid = Number(mmsi.slice(0, 3));
  return mid >= 200 && mid <= 799;
}
