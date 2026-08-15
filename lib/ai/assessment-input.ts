import type { PoolClient } from "pg";
import type { AssessmentInput } from "@/lib/ai/llm-client";
import { numberOrNull } from "@/lib/db/rows";
import { kgToLbs } from "@/lib/units";
import {
  easternDateString,
  yesterdayInEasternTime,
  wideUtcWindowAroundEasternDate,
} from "@/lib/dates";

async function getGoalWeights(
  tx: PoolClient,
  userId: string,
): Promise<{ start: number | null; goal: number | null }> {
  const { rows } = await tx.query(
    `select weight_lbs_start, weight_lbs_goal
       from goals
      where user_id = $1`,
    [userId],
  );

  if (rows.length === 0) {
    return { start: null, goal: null };
  }

  return {
    start: numberOrNull(rows[0].weight_lbs_start),
    goal: numberOrNull(rows[0].weight_lbs_goal),
  };
}

/** Most recent measurement by observed date (not upload date), tie-broken by insert order. */
async function getCurrentWeight(
  tx: PoolClient,
  userId: string,
): Promise<number | null> {
  const { rows } = await tx.query(
    `select weight_lbs
       from measurements
      where user_id = $1
      order by measured_at desc, created_at desc
      limit 1`,
    [userId],
  );

  return rows.length === 0 ? null : numberOrNull(rows[0].weight_lbs);
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
  tx: PoolClient,
  userId: string,
  easternDateStr: string,
): Promise<{ calories: number | null; protein_g: number | null }> {
  const { rows } = await tx.query(
    `select calories, protein_g
       from diet_entries
      where user_id = $1
        and entry_date = $2`,
    [userId, easternDateStr],
  );

  if (rows.length === 0) {
    return { calories: null, protein_g: null };
  }

  // Both columns are `numeric` and arrive as strings; adding them without
  // converting would concatenate rather than sum.
  return rows.reduce(
    (totals, entry) => ({
      calories: totals.calories + (numberOrNull(entry.calories) ?? 0),
      protein_g: totals.protein_g + (numberOrNull(entry.protein_g) ?? 0),
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
  tx: PoolClient,
  userId: string,
  easternDateStr: string,
): Promise<{ present: 0 | 1; volume_lbs: number | null; names: string[] }> {
  const { start, end } = wideUtcWindowAroundEasternDate(easternDateStr);

  const { rows: workouts } = await tx.query(
    `select id, title, start_time
       from workouts
      where user_id = $1
        and start_time >= $2
        and start_time < $3
      order by start_time asc`,
    [userId, start, end],
  );

  // The window above is a superset; keep only workouts whose start_time
  // actually converts to the target Eastern calendar date.
  const yesterdaysWorkouts = workouts.filter(
    (workout) =>
      workout.start_time !== null &&
      easternDateString(new Date(workout.start_time)) === easternDateStr,
  );

  if (yesterdaysWorkouts.length === 0) {
    return { present: 0, volume_lbs: null, names: [] };
  }

  const workoutIds = yesterdaysWorkouts.map((workout) => workout.id as string);
  const names = yesterdaysWorkouts.map((workout) => workout.title as string);

  const { rows: exercises } = await tx.query(
    `select id
       from workout_exercises
      where user_id = $1
        and workout_id = any($2::uuid[])`,
    [userId, workoutIds],
  );

  if (exercises.length === 0) {
    return { present: 1, volume_lbs: kgToLbs(0), names };
  }

  const { rows: sets } = await tx.query(
    `select weight_kg, reps
       from workout_sets
      where user_id = $1
        and exercise_id = any($2::uuid[])`,
    [userId, exercises.map((exercise) => exercise.id as string)],
  );

  const volumeKg = sets.reduce(
    (total, set) => total + (numberOrNull(set.weight_kg) ?? 0) * (set.reps ?? 0),
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
 * Assembles yesterday's (Eastern time) `AssessmentInput` for `userId`:
 * goals, most recent measurement, yesterday's diet totals, and yesterday's
 * workout stats.
 *
 * Every query still filters on `user_id` explicitly. That used to be the
 * *only* thing keeping users apart in the job path, because the job held
 * a service-role client that bypassed Row-Level Security entirely. It no
 * longer is: the job connects as `app_job`, which has no bypass, and
 * `withJob` stamps the user onto the transaction so the database scopes
 * the rows exactly as it does for a logged-in person. The filters stay as
 * belt-and-suspenders, which is what CLAUDE.md asks for — but they are
 * now the second line of defence rather than the only one.
 *
 * The four fetches run in sequence, not in parallel. A single database
 * connection cannot serve concurrent queries, and this whole function
 * runs inside one transaction so that every number it returns describes
 * the same instant.
 *
 * Takes an explicit transaction rather than opening its own, so it can be
 * exercised directly in tests and so the caller decides whether it runs
 * as the website or as the job.
 */
export async function assembleAssessmentInput(
  tx: PoolClient,
  userId: string,
): Promise<AssembledAssessmentInput> {
  const easternDateStr = yesterdayInEasternTime();

  const { start, goal } = await getGoalWeights(tx, userId);
  const currentWeight = await getCurrentWeight(tx, userId);
  const diet = await getYesterdaysDiet(tx, userId, easternDateStr);
  const workoutStats = await getYesterdaysWorkoutStats(tx, userId, easternDateStr);

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
