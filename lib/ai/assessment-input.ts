import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssessmentInput } from "@/lib/ai/llm-client";
import { kgToLbs } from "@/lib/units";
import {
  easternDateString,
  yesterdayInEasternTime,
  wideUtcWindowAroundEasternDate,
} from "@/lib/dates";

async function getGoalWeights(
  supabase: SupabaseClient,
): Promise<{ start: number | null; goal: number | null }> {
  const { data, error } = await supabase
    .from("goals")
    .select("weight_lbs_start, weight_lbs_goal")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return {
    start: data?.weight_lbs_start ?? null,
    goal: data?.weight_lbs_goal ?? null,
  };
}

/** Most recent measurement by observed date (not upload date), tie-broken by insert order. */
async function getCurrentWeight(supabase: SupabaseClient): Promise<number | null> {
  const { data, error } = await supabase
    .from("measurements")
    .select("weight_lbs")
    .order("measured_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.weight_lbs ?? null;
}

/**
 * Sums yesterday's (Eastern time) `diet_entries`. Returns `null` for both
 * fields when nothing was logged — distinct from "logged zero" (which
 * never happens for calories/protein) so the assessment can honestly
 * report a gap instead of silently treating a missing day as a
 * zero-calorie day. No timezone conversion needed here: `entry_date` is
 * already a plain date (not a timestamp), and LoseIt tags each row with
 * the day the food was consumed.
 */
async function getYesterdaysDiet(
  supabase: SupabaseClient,
  easternDateStr: string,
): Promise<{ calories: number | null; protein_g: number | null }> {
  const { data, error } = await supabase
    .from("diet_entries")
    .select("calories, protein_g")
    .eq("entry_date", easternDateStr);

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    return { calories: null, protein_g: null };
  }

  return data.reduce(
    (totals, entry) => ({
      calories: totals.calories + (entry.calories ?? 0),
      protein_g: totals.protein_g + (entry.protein_g ?? 0),
    }),
    { calories: 0, protein_g: 0 },
  );
}

/**
 * Whether yesterday (Eastern time) had a workout, its total volume (sum
 * of weight_kg * reps across every set, converted to pounds), and its
 * workout name(s) for UI display. `start_time` is a UTC timestamp, so
 * classifying "yesterday" requires converting each workout to its
 * Eastern calendar date rather than a simple UTC range check. The
 * `workouts` table has no volume column of its own, so volume is
 * computed from `workout_sets` — numeric fields only (weight, reps),
 * never exercise names or notes (F-004). Volume is `null` only when no
 * workout happened at all; a workout with no logged sets is a real 0,
 * not a missing value. `names` is UI-only — the caller must strip it
 * before building `AssessmentInput` for the LLM.
 */
async function getYesterdaysWorkoutStats(
  supabase: SupabaseClient,
  easternDateStr: string,
): Promise<{ present: 0 | 1; volume_lbs: number | null; names: string[] }> {
  const { start, end } = wideUtcWindowAroundEasternDate(easternDateStr);

  const { data: workouts, error: workoutsError } = await supabase
    .from("workouts")
    .select("id, title, start_time")
    .gte("start_time", start)
    .lt("start_time", end)
    .order("start_time", { ascending: true });

  if (workoutsError) {
    throw new Error(workoutsError.message);
  }

  // The window above is a superset; keep only workouts whose start_time
  // actually converts to the target Eastern calendar date.
  const yesterdaysWorkouts = (workouts ?? []).filter(
    (workout) =>
      workout.start_time !== null &&
      easternDateString(new Date(workout.start_time)) === easternDateStr,
  );

  if (yesterdaysWorkouts.length === 0) {
    return { present: 0, volume_lbs: null, names: [] };
  }

  const workoutIds = yesterdaysWorkouts.map((workout) => workout.id);
  const names = yesterdaysWorkouts.map((workout) => workout.title);

  const { data: exercises, error: exercisesError } = await supabase
    .from("workout_exercises")
    .select("id")
    .in("workout_id", workoutIds);

  if (exercisesError) {
    throw new Error(exercisesError.message);
  }

  const exerciseIds = (exercises ?? []).map((exercise) => exercise.id);
  if (exerciseIds.length === 0) {
    return { present: 1, volume_lbs: kgToLbs(0), names };
  }

  const { data: sets, error: setsError } = await supabase
    .from("workout_sets")
    .select("weight_kg, reps")
    .in("exercise_id", exerciseIds);

  if (setsError) {
    throw new Error(setsError.message);
  }

  const volumeKg = (sets ?? []).reduce(
    (total, set) => total + (set.weight_kg ?? 0) * (set.reps ?? 0),
    0,
  );

  return { present: 1, volume_lbs: kgToLbs(volumeKg), names };
}

/**
 * `AssessmentInput` plus UI-only labeling data — `yesterday_date` and
 * `yesterday_workout_names` never go to the LLM (F-004: numeric fields
 * only).
 */
export type AssembledAssessmentInput = AssessmentInput & {
  yesterday_date: string;
  yesterday_workout_names: string[];
};

/**
 * Assembles yesterday's (Eastern time) `AssessmentInput` for the caller's
 * session: goals, most recent measurement, yesterday's diet totals, and
 * yesterday's workout stats. Every query relies entirely on Row-Level
 * Security to scope to the caller — no manual user_id filter anywhere.
 *
 * Takes an explicit `SupabaseClient` rather than creating one internally
 * from `@/lib/supabase/server`, so it can be exercised directly against a
 * real per-user client in tests. `createClient()` there calls
 * `cookies()`, which throws outside a real Next.js request scope — the
 * same issue hit (and fixed the same way) for `getLatestWorkout` and the
 * LoseIt diet queries.
 */
export async function assembleAssessmentInput(
  supabase: SupabaseClient,
): Promise<AssembledAssessmentInput> {
  const easternDateStr = yesterdayInEasternTime();

  const [{ start, goal }, currentWeight, diet, workoutStats] = await Promise.all([
    getGoalWeights(supabase),
    getCurrentWeight(supabase),
    getYesterdaysDiet(supabase, easternDateStr),
    getYesterdaysWorkoutStats(supabase, easternDateStr),
  ]);

  return {
    weight_lbs_start: start,
    weight_lbs_goal: goal,
    weight_lbs_current: currentWeight,
    yesterday_calories: diet.calories,
    yesterday_protein_g: diet.protein_g,
    yesterday_workout_present: workoutStats.present,
    yesterday_workout_volume_lbs: workoutStats.volume_lbs,
    yesterday_date: easternDateStr,
    yesterday_workout_names: workoutStats.names,
  };
}
