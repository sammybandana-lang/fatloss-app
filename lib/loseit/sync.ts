import type { PoolClient } from "pg";
import { getMostRecentLoseItCsv } from "@/lib/gmail/client";
import { parseLoseItCsv } from "@/lib/loseit/parser";

export type ImportResult =
  | { ok: true; inserted: number; skipped_dupes: number }
  | { ok: true; no_email: true }
  | { ok: false; error: string };

/**
 * Pulls today's LoseIt daily-report email (if any) and inserts its rows into
 * `diet_entries` for `userId`. Idempotent: re-running against the same email
 * inserts nothing new — duplicates are skipped, not re-inserted, via the
 * `unique (user_id, entry_date, name, food_type, calories)` constraint in
 * 20260803192711_create_diet_entries.sql.
 *
 * The whole batch is rejected on any parsing problem (bad header, a
 * malformed row) rather than inserting whatever happened to parse — a
 * partially-imported daily report is worse than none at all. Never throws;
 * every outcome, including unexpected errors, comes back as a result value.
 */
export async function importLoseItFor(
  tx: PoolClient,
  userId: string,
): Promise<ImportResult> {
  try {
    const csvText = await getMostRecentLoseItCsv();
    if (csvText === null) {
      return { ok: true, no_email: true };
    }

    const parsedRows = parseLoseItCsv(csvText);
    if (parsedRows.length === 0) {
      return { ok: true, inserted: 0, skipped_dupes: 0 };
    }

    // All rows in one statement rather than one round trip each. A daily
    // report is dozens of rows, and `jsonb_to_recordset` turns the whole
    // batch into something the insert can select from — the parsed rows
    // still travel as a single bound parameter, never as SQL text.
    //
    // `on conflict do nothing ... returning id` yields a row only for
    // entries that were genuinely new, which is what the counts below
    // report.
    const { rows: insertedRows } = await tx.query(
      `insert into diet_entries (
         user_id, entry_date, name, food_type, quantity, units, calories,
         fat_g, protein_g, carbs_g, saturated_fat_g, sugars_g, fiber_g,
         cholesterol_mg, sodium_mg
       )
       select $1, e.entry_date, e.name, e.food_type, e.quantity, e.units,
              e.calories, e.fat_g, e.protein_g, e.carbs_g,
              e.saturated_fat_g, e.sugars_g, e.fiber_g, e.cholesterol_mg,
              e.sodium_mg
         from jsonb_to_recordset($2::jsonb) as e(
           entry_date      date,
           name            text,
           food_type       text,
           quantity        numeric,
           units           text,
           calories        numeric,
           fat_g           numeric,
           protein_g       numeric,
           carbs_g         numeric,
           saturated_fat_g numeric,
           sugars_g        numeric,
           fiber_g         numeric,
           cholesterol_mg  numeric,
           sodium_mg       numeric
         )
       on conflict (user_id, entry_date, name, food_type, calories) do nothing
       returning id`,
      [userId, JSON.stringify(parsedRows)],
    );

    const inserted = insertedRows.length;
    const skipped_dupes = parsedRows.length - inserted;

    console.log(`LoseIt import: ${inserted} inserted, ${skipped_dupes} skipped as duplicates`);

    return { ok: true, inserted, skipped_dupes };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
