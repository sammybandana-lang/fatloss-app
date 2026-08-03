/**
 * Pure functions that turn raw Hevy workout JSON into rows shaped for our
 * `workouts` / `workout_exercises` / `workout_sets` tables. No DB or network
 * calls here on purpose — this is the part that's easy (and worth it) to
 * unit test.
 */

export interface HevyRawSet {
  index: number;
  type?: string | null;
  weight_kg?: number | null;
  reps?: number | null;
  distance_meters?: number | null;
  duration_seconds?: number | null;
  rpe?: number | null;
  custom_metric?: number | null;
}

export interface HevyRawExercise {
  index: number;
  title: string;
  notes?: string | null;
  exercise_template_id?: string | null;
  // Hevy's GET /v1/workouts response uses "supersets_id" (plural), while
  // their write endpoints document "superset_id" — read whichever shows up.
  supersets_id?: number | null;
  superset_id?: number | null;
  sets: HevyRawSet[];
}

export interface HevyRawWorkout {
  id: string;
  routine_id?: string | null;
  title: string;
  description?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  exercises: HevyRawExercise[];
}

export interface WorkoutRow {
  hevy_id: string;
  routine_id: string | null;
  title: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
}

export interface WorkoutExerciseRow {
  order_index: number;
  title: string;
  notes: string | null;
  exercise_template_id: string | null;
  superset_id: number | null;
}

export interface WorkoutSetRow {
  set_index: number;
  set_type: string | null;
  weight_kg: number | null;
  reps: number | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  rpe: number | null;
  custom_metric: number | null;
}

export interface MappedExercise {
  exercise: WorkoutExerciseRow;
  sets: WorkoutSetRow[];
}

export interface MappedWorkout {
  workout: WorkoutRow;
  exercises: MappedExercise[];
}

/** Blank/missing text becomes `null` instead of an empty string. */
function nullIfEmpty(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }
  return value;
}

export function mapWorkout(raw: HevyRawWorkout): WorkoutRow {
  return {
    hevy_id: raw.id,
    routine_id: raw.routine_id ?? null,
    title: raw.title,
    description: nullIfEmpty(raw.description),
    start_time: raw.start_time ?? null,
    end_time: raw.end_time ?? null,
  };
}

export function mapExercise(raw: HevyRawExercise): WorkoutExerciseRow {
  return {
    order_index: raw.index,
    title: raw.title,
    notes: nullIfEmpty(raw.notes),
    exercise_template_id: raw.exercise_template_id ?? null,
    superset_id: raw.supersets_id ?? raw.superset_id ?? null,
  };
}

export function mapSet(raw: HevyRawSet): WorkoutSetRow {
  return {
    set_index: raw.index,
    set_type: raw.type ?? null,
    weight_kg: raw.weight_kg ?? null,
    reps: raw.reps ?? null,
    distance_meters: raw.distance_meters ?? null,
    duration_seconds: raw.duration_seconds ?? null,
    rpe: raw.rpe ?? null,
    custom_metric: raw.custom_metric ?? null,
  };
}

export function mapHevyWorkout(raw: HevyRawWorkout): MappedWorkout {
  return {
    workout: mapWorkout(raw),
    exercises: (raw.exercises ?? []).map((exercise) => ({
      exercise: mapExercise(exercise),
      sets: (exercise.sets ?? []).map(mapSet),
    })),
  };
}
