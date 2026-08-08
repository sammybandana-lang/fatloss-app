import type { SupabaseClient } from "@supabase/supabase-js";

export interface LatestDayTotals {
  entryDate: string;
  calories: number;
  fat_g: number;
  protein_g: number;
  carbs_g: number;
}

/**
 * Sums the caller's `diet_entries` for their most recently logged day.
 * LoseIt's daily email arrives the morning after, so "today" almost never
 * has any rows yet — the most recent `entry_date` is the day that actually
 * has data. Relies entirely on Row-Level Security to scope rows to the
 * caller — no user_id filter here. Returns `null` when there are no diet
 * entries at all.
 */
export async function getLatestDayDietTotals(
  supabase: SupabaseClient,
): Promise<LatestDayTotals | null> {
  const { data: latest, error: latestError } = await supabase
    .from("diet_entries")
    .select("entry_date")
    .order("entry_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    throw new Error(latestError.message);
  }
  if (!latest) {
    return null;
  }

  const { data: entries, error } = await supabase
    .from("diet_entries")
    .select("calories, fat_g, protein_g, carbs_g")
    .eq("entry_date", latest.entry_date);

  if (error) {
    throw new Error(error.message);
  }

  const sums = (entries ?? []).reduce(
    (totals, entry) => ({
      calories: totals.calories + (entry.calories ?? 0),
      fat_g: totals.fat_g + (entry.fat_g ?? 0),
      protein_g: totals.protein_g + (entry.protein_g ?? 0),
      carbs_g: totals.carbs_g + (entry.carbs_g ?? 0),
    }),
    { calories: 0, fat_g: 0, protein_g: 0, carbs_g: 0 },
  );

  return { entryDate: latest.entry_date, ...sums };
}
