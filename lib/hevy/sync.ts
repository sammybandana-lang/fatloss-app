import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchRecentHevyWorkouts } from "@/lib/hevy/client";
import {
  mapHevyWorkout,
  type MappedWorkout,
  type WorkoutExerciseRow,
  type WorkoutSetRow,
} from "@/lib/hevy/mapper";

/**
 * Upserts one exercise (linked to its workout) and its sets (linked to the
 * exercise). Idempotent on (workout_id, order_index) and (exercise_id,
 * set_index), so re-syncing the same workout updates rather than duplicates.
 */
async function upsertExercise(
  supabase: SupabaseClient,
  userId: string,
  workoutId: string,
  exercise: WorkoutExerciseRow,
  sets: WorkoutSetRow[],
) {
  const { data: exerciseRow, error: exerciseError } = await supabase
    .from("workout_exercises")
    .upsert(
      { ...exercise, workout_id: workoutId, user_id: userId },
      { onConflict: "workout_id,order_index" },
    )
    .select("id")
    .single();

  if (exerciseError) {
    throw new Error(exerciseError.message);
  }
  if (sets.length === 0) {
    return;
  }

  const { error: setsError } = await supabase.from("workout_sets").upsert(
    sets.map((set) => ({ ...set, exercise_id: exerciseRow.id, user_id: userId })),
    { onConflict: "exercise_id,set_index" },
  );

  if (setsError) {
    throw new Error(setsError.message);
  }
}

/**
 * Upserts one workout (idempotent on the (user_id, hevy_id) unique
 * constraint), then its exercises and sets underneath it.
 */
async function upsertWorkout(
  supabase: SupabaseClient,
  userId: string,
  mapped: MappedWorkout,
) {
  const { data: workoutRow, error: workoutError } = await supabase
    .from("workouts")
    .upsert(
      { ...mapped.workout, user_id: userId },
      { onConflict: "user_id,hevy_id" },
    )
    .select("id")
    .single();

  if (workoutError) {
    throw new Error(workoutError.message);
  }

  for (const { exercise, sets } of mapped.exercises) {
    await upsertExercise(supabase, userId, workoutRow.id, exercise, sets);
  }
}

/**
 * Pulls the most recent page of workouts from Hevy and upserts them for
 * `userId`. Safe to run repeatedly: re-syncing updates existing rows
 * instead of duplicating them. Only the most recent page is fetched (not a
 * full resync) since this runs on every routine sync and older workouts are
 * already in the database. Returns the count synced so callers can show a
 * status message.
 *
 * `user_id` is stamped explicitly on all three tables rather than left to
 * the `default auth.uid()` in the schema. The default only works for a
 * session client; the daily job uses a service-role client where
 * `auth.uid()` is NULL, which would fail the NOT NULL constraint. Passing
 * it explicitly makes the same code correct in both callers.
 *
 * Contains no Next.js request-scope calls (no `revalidatePath`) so it can
 * run inside a background job — the server action wrapper handles
 * revalidation for the UI path.
 */
export async function syncHevyWorkoutsFor(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ workoutCount: number }> {
  const rawWorkouts = await fetchRecentHevyWorkouts();

  for (const raw of rawWorkouts) {
    await upsertWorkout(supabase, userId, mapHevyWorkout(raw));
  }

  return { workoutCount: rawWorkouts.length };
}
