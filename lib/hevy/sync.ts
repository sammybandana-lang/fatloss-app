import type { PoolClient } from "pg";
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
  tx: PoolClient,
  userId: string,
  workoutId: string,
  exercise: WorkoutExerciseRow,
  sets: WorkoutSetRow[],
) {
  const { rows } = await tx.query(
    `insert into workout_exercises (
       user_id, workout_id, order_index, title, notes,
       exercise_template_id, superset_id
     )
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (workout_id, order_index) do update set
       title                = excluded.title,
       notes                = excluded.notes,
       exercise_template_id = excluded.exercise_template_id,
       superset_id          = excluded.superset_id
     returning id`,
    [
      userId,
      workoutId,
      exercise.order_index,
      exercise.title,
      exercise.notes,
      exercise.exercise_template_id,
      // The column is text; Hevy sends a number. Stringified here rather
      // than relying on an implicit cast.
      exercise.superset_id === null ? null : String(exercise.superset_id),
    ],
  );

  const exerciseId = rows[0].id as string;

  if (sets.length === 0) {
    return;
  }

  // All sets for this exercise in one statement — see the same idiom in
  // lib/loseit/sync.ts. The rows travel as a bound parameter, not as SQL.
  await tx.query(
    `insert into workout_sets (
       user_id, exercise_id, set_index, set_type, weight_kg, reps,
       distance_meters, duration_seconds, rpe, custom_metric
     )
     select $1, $2, s.set_index, s.set_type, s.weight_kg, s.reps,
            s.distance_meters, s.duration_seconds, s.rpe, s.custom_metric
       from jsonb_to_recordset($3::jsonb) as s(
         set_index        int,
         set_type         text,
         weight_kg        numeric,
         reps             int,
         distance_meters  numeric,
         duration_seconds int,
         rpe              numeric,
         custom_metric    numeric
       )
     on conflict (exercise_id, set_index) do update set
       set_type         = excluded.set_type,
       weight_kg        = excluded.weight_kg,
       reps             = excluded.reps,
       distance_meters  = excluded.distance_meters,
       duration_seconds = excluded.duration_seconds,
       rpe              = excluded.rpe,
       custom_metric    = excluded.custom_metric`,
    [userId, exerciseId, JSON.stringify(sets)],
  );
}

/**
 * Upserts one workout (idempotent on the (user_id, hevy_id) unique
 * constraint), then its exercises and sets underneath it.
 */
async function upsertWorkout(
  tx: PoolClient,
  userId: string,
  mapped: MappedWorkout,
) {
  const { rows } = await tx.query(
    `insert into workouts (
       user_id, hevy_id, routine_id, title, description, start_time, end_time
     )
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (user_id, hevy_id) do update set
       routine_id  = excluded.routine_id,
       title       = excluded.title,
       description = excluded.description,
       start_time  = excluded.start_time,
       end_time    = excluded.end_time
     returning id`,
    [
      userId,
      mapped.workout.hevy_id,
      mapped.workout.routine_id,
      mapped.workout.title,
      mapped.workout.description,
      mapped.workout.start_time,
      mapped.workout.end_time,
    ],
  );

  const workoutId = rows[0].id as string;

  for (const { exercise, sets } of mapped.exercises) {
    await upsertExercise(tx, userId, workoutId, exercise, sets);
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
 * the column default. The default resolves the caller's identity, which is
 * correct here — but stating it makes the row's owner visible at the point
 * the row is built, and the database's WITH CHECK policy rejects the write
 * if the two ever disagreed.
 *
 * Contains no Next.js request-scope calls (no `revalidatePath`) so it can
 * run inside a background job — the server action wrapper handles
 * revalidation for the UI path.
 */
export async function syncHevyWorkoutsFor(
  tx: PoolClient,
  userId: string,
): Promise<{ workoutCount: number }> {
  const rawWorkouts = await fetchRecentHevyWorkouts();

  for (const raw of rawWorkouts) {
    await upsertWorkout(tx, userId, mapHevyWorkout(raw));
  }

  return { workoutCount: rawWorkouts.length };
}
