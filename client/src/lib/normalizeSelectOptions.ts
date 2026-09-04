/**
 * normalizeSelectOptions — sanitize option lists for radix-style Select components.
 *
 * Radix `Select.Item` throws when given an empty-string value, and duplicate
 * values produce broken selection behaviour. This helper filters out options
 * with empty/whitespace values and dedupes by value so callers can safely map
 * DB/API rows straight into `<SelectItem>`s.
 */

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * @param items    raw items (e.g. rows from an API)
 * @param getValue extractor for the option value
 * @param getLabel extractor for the option label (defaults to the value)
 * @returns deduped options with non-empty values
 */
export function normalizeSelectOptions<T>(
  items: readonly T[],
  getValue: (item: T) => string | null | undefined,
  getLabel?: (item: T) => string,
): SelectOption[] {
  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const item of items) {
    const raw = getValue(item);
    const value = (raw ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label: getLabel ? getLabel(item) : value });
  }
  return out;
}

/** Sentinel value for the "no filter / all" SelectItem (radix rejects ""). */
export const SELECT_ALL_VALUE = "all";

/** Map a Select value back to the filter value ("" for the all-sentinel). */
export function fromSelectValue(v: string): string {
  return v === SELECT_ALL_VALUE ? "" : v;
}

/** Map a filter value to a Select value (all-sentinel for ""). */
export function toSelectValue(v: string | null | undefined): string {
  return v && v.trim() ? v : SELECT_ALL_VALUE;
}
