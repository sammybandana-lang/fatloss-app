"use server";

import { createClient } from "@/lib/supabase/server";
import { getMostRecentLoseItCsv } from "@/lib/gmail/client";
import { parseLoseItCsv } from "@/lib/loseit/parser";

// Matches the `unique (user_id, entry_date, name, food_type, calories)`
// constraint in supabase/migrations/20260803192711_create_diet_entries.sql.
const DIET_ENTRIES_CONFLICT_COLUMNS = "user_id,entry_date,name,food_type,calories";

type ImportResult =
  | { ok: true; inserted: number; skipped_dupes: number }
  | { ok: true; no_email: true }
  | { ok: false; error: string };

/**
 * Pulls today's LoseIt daily-report email (if any) and upserts its rows into
 * `diet_entries` for the signed-in user. Idempotent: re-running against the
 * same email updates nothing new — duplicates are skipped, not re-inserted.
 *
 * The whole batch is rejected on any parsing problem (bad header, a
 * malformed row) rather than inserting whatever happened to parse — a
 * partially-imported daily report is worse than none at all. Never throws;
 * every outcome, including unexpected errors, comes back as a result value.
 */
export async function importLoseItToday(): Promise<ImportResult> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { ok: false, error: "Not authenticated" };
    }

    const csvText = await getMostRecentLoseItCsv();
    if (csvText === null) {
      return { ok: true, no_email: true };
    }

    const parsedRows = parseLoseItCsv(csvText);
    if (parsedRows.length === 0) {
      return { ok: true, inserted: 0, skipped_dupes: 0 };
    }

    const rows = parsedRows.map((row) => ({ ...row, user_id: user.id }));

    const { data: insertedRows, error } = await supabase
      .from("diet_entries")
      .upsert(rows, {
        onConflict: DIET_ENTRIES_CONFLICT_COLUMNS,
        ignoreDuplicates: true,
      })
      .select("id");

    if (error) {
      return { ok: false, error: error.message };
    }

    const inserted = insertedRows?.length ?? 0;
    const skipped_dupes = parsedRows.length - inserted;

    console.log(`LoseIt import: ${inserted} inserted, ${skipped_dupes} skipped as duplicates`);

    return { ok: true, inserted, skipped_dupes };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
