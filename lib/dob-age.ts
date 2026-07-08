/**
 * Latest yyyy-mm-dd birth date such that the person has turned 18 by end of today
 * (same rule as `<input type="date" max="…">`).
 */
export function getMaximumBirthDateForAge18(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** `dobIso` must be yyyy-mm-dd from `<input type="date" />`. */
export function isDobAtLeast18YearsOld(dobIso: string): boolean {
  const trimmed = dobIso.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
  return trimmed <= getMaximumBirthDateForAge18();
}
