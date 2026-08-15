import type { PoolClient } from "pg";
import { numberOrNull } from "@/lib/db/rows";

export interface LatestDayTotals {
  entryDate: string;
  calories: number;
  fat_g: number;
  protein_g: number;
  carbs_g: number;
}

interface DietEntryMacros {
  calories: number | null;
  fat_g: number | null;
  protein_g: number | null;
  carbs_g: number | null;
}

/** Sums calorie/macro fields across a set of `diet_entries` rows, treating nulls as 0. */
function sumDietMacros(entries: DietEntryMacros[]): Omit<LatestDayTotals, "entryDate"> {
  return entries.reduce<Omit<LatestDayTotals, "entryDate">>(
    (totals, entry) => ({
      calories: totals.calories + (entry.calories ?? 0),
      fat_g: totals.fat_g + (entry.fat_g ?? 0),
      protein_g: totals.protein_g + (entry.protein_g ?? 0),
      carbs_g: totals.carbs_g + (entry.carbs_g ?? 0),
    }),
    { calories: 0, fat_g: 0, protein_g: 0, carbs_g: 0 },
  );
}

/**
 * Sums the caller's `diet_entries` for their most recently logged day.
 * LoseIt's daily email arrives the morning after, so "today" almost never
 * has any rows yet — the most recent `entry_date` is the day that actually
 * has data. Relies entirely on Row-Level Security to scope rows to the
 * caller — no user_id filter here. Returns `null` when there are no diet
 * entries at all.
 *
 * `entry_date::text` is not decoration. node-postgres parses a `date`
 * column into a JavaScript Date at LOCAL midnight, so on a machine west
 * of UTC "2026-08-13" comes back as the evening of the 12th and every
 * downstream comparison is a day out. Casting in SQL keeps it the exact
 * "YYYY-MM-DD" string the rest of this codebase passes around, and this
 * app's dates are already Eastern-time sensitive (see lib/dates.ts).
 */
export async function getLatestDayDietTotals(
  tx: PoolClient,
): Promise<LatestDayTotals | null> {
  const { rows } = await tx.query(
    `select entry_date::text as entry_date
       from diet_entries
      order by entry_date desc
      limit 1`,
  );

  if (rows.length === 0) {
    return null;
  }

  return getDietTotalsForDate(tx, rows[0].entry_date as string);
}

/**
 * Sums the caller's `diet_entries` for one specific `entry_date` (as
 * opposed to `getLatestDayDietTotals`, which finds the most recent day on
 * its own). Used by the dashboard to show yesterday's nutrition. Relies
 * entirely on Row-Level Security to scope rows to the caller. Returns
 * `null` when there are no entries for that date.
 */
export async function getDietTotalsForDate(
  tx: PoolClient,
  date: string,
): Promise<LatestDayTotals | null> {
  const { rows } = await tx.query(
    `select calories, fat_g, protein_g, carbs_g
       from diet_entries
      where entry_date = $1`,
    [date],
  );

  if (rows.length === 0) {
    return null;
  }

  // The macro columns are `numeric`, so they arrive as strings. Summing
  // them without converting would concatenate rather than add — "120" +
  // "80" is "12080", a plausible-looking calorie total.
  const entries: DietEntryMacros[] = rows.map((row) => ({
    calories: numberOrNull(row.calories),
    fat_g: numberOrNull(row.fat_g),
    protein_g: numberOrNull(row.protein_g),
    carbs_g: numberOrNull(row.carbs_g),
  }));

  return { entryDate: date, ...sumDietMacros(entries) };
}
