"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type Goals = {
  weight_lbs_start: number | null;
  weight_lbs_goal: number | null;
  daily_calories_goal: number | null;
  daily_protein_g_goal: number | null;
  weekly_workout_goal: number | null;
  updated_at: string;
};

export type GoalsInput = Omit<Goals, "updated_at">;

const GOALS_COLUMNS =
  "weight_lbs_start, weight_lbs_goal, daily_calories_goal, daily_protein_g_goal, weekly_workout_goal, updated_at";

/**
 * Loads the signed-in user's goals, or null if they haven't set any yet.
 * Relies entirely on Row-Level Security to scope to the caller — no
 * user_id filter here. `maybeSingle` (not `single`) because a brand-new
 * user having zero rows is a valid state, not an error.
 */
export async function getGoals(): Promise<Goals | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("goals")
    .select(GOALS_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

const POSITIVE_NUMBER_FIELDS: Array<{ key: keyof GoalsInput; label: string }> = [
  { key: "weight_lbs_start", label: "starting weight" },
  { key: "weight_lbs_goal", label: "goal weight" },
  { key: "daily_calories_goal", label: "daily calorie target" },
  { key: "daily_protein_g_goal", label: "daily protein target" },
  { key: "weekly_workout_goal", label: "weekly workout target" },
];

/**
 * Every goal field is optional (null allowed), but if present must be a
 * positive number. Never rely on the form's `type="number"` alone —
 * validate server-side too.
 */
function validateGoalsInput(input: GoalsInput): string | null {
  for (const { key, label } of POSITIVE_NUMBER_FIELDS) {
    const value = input[key];
    if (value === null) {
      continue;
    }
    if (!Number.isFinite(value) || value <= 0) {
      return `Enter a valid ${label}, or leave it blank.`;
    }
  }
  return null;
}

/**
 * Saves the signed-in user's goals — one row per user, upserted on
 * `user_id` so repeated saves update in place instead of stacking rows.
 * `user_id` is stamped here from the verified session (never trusted from
 * the caller); RLS's WITH CHECK policy denies the write if it were wrong.
 */
export async function upsertGoals(
  input: GoalsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const validationError = validateGoalsInput(input);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not authenticated" };
  }

  const { error } = await supabase.from("goals").upsert(
    { ...input, user_id: user.id, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/goals");
  return { ok: true };
}
