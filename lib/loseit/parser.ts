/**
 * Pure parsing for LoseIt's daily-report CSV export. No DB or network calls
 * here on purpose — this is the part that's worth unit testing directly.
 *
 * Header validation doubles as a security gate: if the CSV doesn't look
 * exactly like a LoseIt export, we refuse to parse any of it rather than
 * guess at a column mapping.
 */

import Papa from "papaparse";

export const LOSEIT_CSV_HEADERS = [
  "Date",
  "Name",
  "Icon",
  "Type",
  "Quantity",
  "Units",
  "Calories",
  "Deleted",
  "Fat (g)",
  "Protein (g)",
  "Carbohydrates (g)",
  "Saturated Fat (g)",
  "Sugars (g)",
  "Fiber (g)",
  "Cholesterol (mg)",
  "Sodium (mg)",
] as const;

export interface DietEntryRow {
  entry_date: string; // YYYY-MM-DD
  name: string;
  food_type: string | null;
  quantity: number | null;
  units: string | null;
  calories: number | null;
  fat_g: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  saturated_fat_g: number | null;
  sugars_g: number | null;
  fiber_g: number | null;
  cholesterol_mg: number | null;
  sodium_mg: number | null;
}

type LoseItRow = Record<string, string>;

function assertValidHeaders(fields: string[] | undefined): void {
  const expected: readonly string[] = LOSEIT_CSV_HEADERS;
  const matches =
    !!fields &&
    fields.length === expected.length &&
    fields.every((field, i) => field === expected[i]);

  if (!matches) {
    throw new Error(
      `This doesn't look like a LoseIt daily report. Expected headers:\n${expected.join(",")}\nGot:\n${(fields ?? []).join(",")}`,
    );
  }
}

/** Blank/missing text becomes `null` instead of an empty string. */
function nullIfEmpty(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function requireText(value: string | undefined, field: string, rowNumber: number): string {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") {
    throw new Error(`Row ${rowNumber}: missing required "${field}".`);
  }
  return trimmed;
}

/** LoseIt reports "n/a" (any case) for nutrients it doesn't track for an item. */
function parseNullableNumber(
  value: string | undefined,
  field: string,
  rowNumber: number,
): number | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "" || trimmed.toLowerCase() === "n/a") {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Row ${rowNumber}: invalid number "${value}" for "${field}".`);
  }
  return parsed;
}

const LOSEIT_DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** Converts LoseIt's "MM/DD/YYYY" into the "YYYY-MM-DD" our date column expects. */
function parseEntryDate(value: string | undefined, rowNumber: number): string {
  const trimmed = (value ?? "").trim();
  const match = LOSEIT_DATE_PATTERN.exec(trimmed);
  if (!match) {
    throw new Error(`Row ${rowNumber}: invalid date "${value}", expected MM/DD/YYYY.`);
  }
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function isDeleted(value: string | undefined): boolean {
  return (value ?? "").trim() !== "0";
}

function mapRow(raw: LoseItRow, rowNumber: number): DietEntryRow {
  return {
    entry_date: parseEntryDate(raw.Date, rowNumber),
    name: requireText(raw.Name, "Name", rowNumber),
    food_type: nullIfEmpty(raw.Type),
    quantity: parseNullableNumber(raw.Quantity, "Quantity", rowNumber),
    units: nullIfEmpty(raw.Units),
    calories: parseNullableNumber(raw.Calories, "Calories", rowNumber),
    fat_g: parseNullableNumber(raw["Fat (g)"], "Fat (g)", rowNumber),
    protein_g: parseNullableNumber(raw["Protein (g)"], "Protein (g)", rowNumber),
    carbs_g: parseNullableNumber(raw["Carbohydrates (g)"], "Carbohydrates (g)", rowNumber),
    saturated_fat_g: parseNullableNumber(
      raw["Saturated Fat (g)"],
      "Saturated Fat (g)",
      rowNumber,
    ),
    sugars_g: parseNullableNumber(raw["Sugars (g)"], "Sugars (g)", rowNumber),
    fiber_g: parseNullableNumber(raw["Fiber (g)"], "Fiber (g)", rowNumber),
    cholesterol_mg: parseNullableNumber(raw["Cholesterol (mg)"], "Cholesterol (mg)", rowNumber),
    sodium_mg: parseNullableNumber(raw["Sodium (mg)"], "Sodium (mg)", rowNumber),
  };
}

/**
 * Parses raw LoseIt daily-report CSV text into rows ready to insert into
 * `diet_entries`. Rows marked `Deleted != 0` are skipped. `user_id` is
 * never set here — the database fills it in and Row-Level Security scopes
 * it, same as every other table in this app.
 */
export function parseLoseItCsv(csvText: string): DietEntryRow[] {
  const result = Papa.parse<LoseItRow>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (result.errors.length > 0) {
    const [first] = result.errors;
    throw new Error(`Failed to parse CSV: ${first.message} (row ${first.row ?? "?"}).`);
  }

  assertValidHeaders(result.meta.fields);

  const rows: DietEntryRow[] = [];
  result.data.forEach((raw, index) => {
    const rowNumber = index + 2; // +1 for the header row, +1 for 1-indexing
    if (isDeleted(raw.Deleted)) {
      return;
    }
    rows.push(mapRow(raw, rowNumber));
  });

  return rows;
}
