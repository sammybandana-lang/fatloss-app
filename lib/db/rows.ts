/**
 * Converting values that come back from PostgreSQL.
 *
 * Azure migration, Phase 3.
 *
 * WHY THIS EXISTS
 *
 * `numeric` columns arrive from node-postgres as STRINGS, not numbers.
 * That is deliberate on the driver's part: `numeric` is arbitrary
 * precision, and JavaScript's number type cannot represent every value
 * one can hold, so handing back a string refuses to lose precision
 * silently.
 *
 * It is also a behaviour change from the Supabase client, and a quiet
 * one. `"171.2"` renders on a page exactly like `171.2`, so a converted
 * screen looks correct while any arithmetic behind it has started doing
 * string concatenation — `"171.2" + 5` is `"171.25"`. Every weight,
 * percentage and macro column in this schema is `numeric`.
 *
 * So conversion is explicit and in one place, rather than left to
 * whatever each call site happens to do.
 */

/**
 * A `numeric` column as a number, preserving null.
 *
 * Null must survive as null. `Number(null)` is 0, which would turn "no
 * body fat reading was taken" into "0% body fat" — a real measurement,
 * displayed and averaged as though someone had recorded it.
 */
export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    // Not silently swallowed: a numeric column that will not parse means
    // the query or the schema is not what this code thinks it is.
    throw new Error(`Expected a numeric value from the database, got: ${String(value)}`);
  }

  return parsed;
}

/** A `numeric` column that the schema guarantees is never null. */
export function requiredNumber(value: unknown): number {
  const parsed = numberOrNull(value);

  if (parsed === null) {
    throw new Error("Expected a non-null numeric value from the database, got null.");
  }

  return parsed;
}
