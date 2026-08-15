import type { PoolClient } from "pg";
import { numberOrNull } from "@/lib/db/rows";
import { easternDateString, wideUtcWindowAroundEasternDate } from "@/lib/dates";

export interface LatestWorkoutSet {
  set_index: number;
  reps: number | null;
  weight_kg: number | null;
}

export interface LatestWorkoutExercise {
  id: string;
  title: string;
  order_index: number;
  sets: LatestWorkoutSet[];
}

export interface LatestWorkout {
  id: string;
  title: string;
  start_time: string | null;
  exercises: LatestWorkoutExercise[];
}

/**
 * `timestamptz` arrives from node-postgres as a Date object, where the
 * Supabase client returned an ISO string. Callers compare and re-parse
 * these, so the string form is kept rather than changing what they
 * expect.
 */
function toIsoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : (value as Date).toISOString();
}

async function getSetsByExercise(
  tx: PoolClient,
  exerciseIds: string[],
): Promise<Map<string, LatestWorkoutSet[]>> {
  const setsByExercise = new Map<string, LatestWorkoutSet[]>();
  if (exerciseIds.length === 0) {
    return setsByExercise;
  }

  const { rows } = await tx.query(
    `select exercise_id, set_index, reps, weight_kg
       from workout_sets
      where exercise_id = any($1::uuid[])
      order by set_index asc`,
    [exerciseIds],
  );

  for (const row of rows) {
    const existing = setsByExercise.get(row.exercise_id) ?? [];
    existing.push({
      set_index: row.set_index,
      reps: row.reps,
      // `numeric`, so it arrives as a string; the dashboard converts it
      // to pounds, and kgToLbs on a string would not do arithmetic.
      weight_kg: numberOrNull(row.weight_kg),
    });
    setsByExercise.set(row.exercise_id, existing);
  }

  return setsByExercise;
}

/**
 * Loads the signed-in user's most recently started workout, with its
 * exercises and sets nested underneath in performed order. Relies entirely
 * on Row-Level Security to scope rows to the caller — no user_id filter here.
 */
export async function getLatestWorkout(
  tx: PoolClient,
): Promise<LatestWorkout | null> {
  const { rows: workouts } = await tx.query(
    `select id, title, start_time
       from workouts
      order by start_time desc
      limit 1`,
  );

  if (workouts.length === 0) {
    return null;
  }

  const workout = workouts[0];

  const { rows: exercises } = await tx.query(
    `select id, title, order_index
       from workout_exercises
      where workout_id = $1
      order by order_index asc`,
    [workout.id],
  );

  const setsByExercise = await getSetsByExercise(
    tx,
    exercises.map((exercise) => exercise.id as string),
  );

  return {
    id: workout.id,
    title: workout.title,
    start_time: toIsoOrNull(workout.start_time),
    exercises: exercises.map((exercise) => ({
      id: exercise.id,
      title: exercise.title,
      order_index: exercise.order_index,
      sets: setsByExercise.get(exercise.id) ?? [],
    })),
  };
}

/**
 * Loads every workout that started on the given Eastern-time calendar
 * date, each with its exercises and sets nested underneath in performed
 * order. `start_time` is stored as UTC, so matching an Eastern calendar
 * date means fetching a wider UTC window first and then filtering down
 * to the precise date in JS — see `lib/dates.ts` for why. Relies entirely
 * on Row-Level Security to scope rows to the caller — no user_id filter
 * here. Returns an empty array when nothing started that day.
 */
export async function getWorkoutsForDate(
  tx: PoolClient,
  date: string,
): Promise<LatestWorkout[]> {
  const { start, end } = wideUtcWindowAroundEasternDate(date);

  const { rows: workouts } = await tx.query(
    `select id, title, start_time
       from workouts
      where start_time >= $1
        and start_time < $2
      order by start_time asc`,
    [start, end],
  );

  const matchingWorkouts = workouts
    .map((workout) => ({
      id: workout.id as string,
      title: workout.title as string,
      start_time: toIsoOrNull(workout.start_time),
    }))
    .filter(
      (workout) =>
        workout.start_time !== null &&
        easternDateString(new Date(workout.start_time)) === date,
    );

  if (matchingWorkouts.length === 0) {
    return [];
  }

  const workoutIds = matchingWorkouts.map((workout) => workout.id);

  const { rows: exercises } = await tx.query(
    `select id, title, order_index, workout_id
       from workout_exercises
      where workout_id = any($1::uuid[])
      order by order_index asc`,
    [workoutIds],
  );

  const setsByExercise = await getSetsByExercise(
    tx,
    exercises.map((exercise) => exercise.id as string),
  );

  const exercisesByWorkout = new Map<string, LatestWorkoutExercise[]>();
  for (const exercise of exercises) {
    const existing = exercisesByWorkout.get(exercise.workout_id) ?? [];
    existing.push({
      id: exercise.id,
      title: exercise.title,
      order_index: exercise.order_index,
      sets: setsByExercise.get(exercise.id) ?? [],
    });
    exercisesByWorkout.set(exercise.workout_id, existing);
  }

  return matchingWorkouts.map((workout) => ({
    ...workout,
    exercises: exercisesByWorkout.get(workout.id) ?? [],
  }));
}
