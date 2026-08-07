import { createClient } from "@/lib/supabase/server";

export interface TodayTotals {
  calories: number;
  fat_g: number;
  protein_g: number;
  carbs_g: number;
  entry_count: number;
}

/** Matches the date format the LoseIt parser writes into `entry_date`. */
function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Sums the signed-in user's `diet_entries` logged today. Relies entirely on
 * Row-Level Security to scope rows to the caller — no user_id filter here.
 * Returns `null` when there's no signed-in user, or when today has no
 * entries yet — distinct from "you ate zero calories today", which never
 * happens.
 */
export async function getTodaysDietTotals(): Promise<TodayTotals | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: entries, error } = await supabase
    .from("diet_entries")
    .select("calories, fat_g, protein_g, carbs_g")
    .eq("entry_date", todayDateString());

  if (error) {
    throw new Error(error.message);
  }

  if (!entries || entries.length === 0) {
    return null;
  }

  return entries.reduce<TodayTotals>(
    (totals, entry) => ({
      calories: totals.calories + (entry.calories ?? 0),
      fat_g: totals.fat_g + (entry.fat_g ?? 0),
      protein_g: totals.protein_g + (entry.protein_g ?? 0),
      carbs_g: totals.carbs_g + (entry.carbs_g ?? 0),
      entry_count: totals.entry_count + 1,
    }),
    { calories: 0, fat_g: 0, protein_g: 0, carbs_g: 0, entry_count: 0 },
  );
}
