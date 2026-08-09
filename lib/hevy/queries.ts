import type { SupabaseClient } from "@supabase/supabase-js";
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

async function getSetsByExercise(
  supabase: SupabaseClient,
  exerciseIds: string[],
): Promise<Map<string, LatestWorkoutSet[]>> {
  const setsByExercise = new Map<string, LatestWorkoutSet[]>();
  if (exerciseIds.length === 0) {
    return setsByExercise;
  }

  const { data: sets, error } = await supabase
    .from("workout_sets")
    .select("exercise_id, set_index, reps, weight_kg")
    .in("exercise_id", exerciseIds)
    .order("set_index", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  for (const set of sets ?? []) {
    const existing = setsByExercise.get(set.exercise_id) ?? [];
    existing.push(set);
    setsByExercise.set(set.exercise_id, existing);
  }

  return setsByExercise;
}

/**
 * Loads the signed-in user's most recently started workout, with its
 * exercises and sets nested underneath in performed order. Relies entirely
 * on Row-Level Security to scope rows to the caller — no user_id filter here.
 */
export async function getLatestWorkout(
  supabase: SupabaseClient,
): Promise<LatestWorkout | null> {
  const { data: workout, error: workoutError } = await supabase
    .from("workouts")
    .select("id, title, start_time")
    .order("start_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (workoutError) {
    throw new Error(workoutError.message);
  }
  if (!workout) {
    return null;
  }

  const { data: exercises, error: exercisesError } = await supabase
    .from("workout_exercises")
    .select("id, title, order_index")
    .eq("workout_id", workout.id)
    .order("order_index", { ascending: true });

  if (exercisesError) {
    throw new Error(exercisesError.message);
  }

  const setsByExercise = await getSetsByExercise(
    supabase,
    (exercises ?? []).map((exercise) => exercise.id),
  );

  return {
    ...workout,
    exercises: (exercises ?? []).map((exercise) => ({
      ...exercise,
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
  supabase: SupabaseClient,
  date: string,
): Promise<LatestWorkout[]> {
  const { start, end } = wideUtcWindowAroundEasternDate(date);

  const { data: workouts, error: workoutsError } = await supabase
    .from("workouts")
    .select("id, title, start_time")
    .gte("start_time", start)
    .lt("start_time", end)
    .order("start_time", { ascending: true });

  if (workoutsError) {
    throw new Error(workoutsError.message);
  }

  const matchingWorkouts = (workouts ?? []).filter(
    (workout) =>
      workout.start_time !== null && easternDateString(new Date(workout.start_time)) === date,
  );

  if (matchingWorkouts.length === 0) {
    return [];
  }

  const workoutIds = matchingWorkouts.map((workout) => workout.id);

  const { data: exercises, error: exercisesError } = await supabase
    .from("workout_exercises")
    .select("id, title, order_index, workout_id")
    .in("workout_id", workoutIds)
    .order("order_index", { ascending: true });

  if (exercisesError) {
    throw new Error(exercisesError.message);
  }

  const setsByExercise = await getSetsByExercise(
    supabase,
    (exercises ?? []).map((exercise) => exercise.id),
  );

  const exercisesByWorkout = new Map<string, LatestWorkoutExercise[]>();
  for (const exercise of exercises ?? []) {
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
