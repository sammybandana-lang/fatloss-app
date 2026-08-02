/**
 * Parsing rules for the "add measurement" form. Kept separate from the
 * Server Action so the validation logic can be unit tested without a real
 * Supabase connection.
 */

export function parseRequiredPositiveNumber(
  value: FormDataEntryValue | null,
  label: string,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Enter a valid ${label}.`);
  }
  return parsed;
}

/** Blank input becomes `null` (stored as NULL); anything else must be a positive number. */
export function parseOptionalPositiveNumber(
  value: FormDataEntryValue | null,
  label: string,
): number | null {
  if (value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Enter a valid ${label}, or leave it blank.`);
  }
  return parsed;
}
