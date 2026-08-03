"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { fetchAllHevyWorkouts } from "@/lib/hevy/client";
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
  workoutId: string,
  exercise: WorkoutExerciseRow,
  sets: WorkoutSetRow[],
) {
  const { data: exerciseRow, error: exerciseError } = await supabase
    .from("workout_exercises")
    .upsert(
      { ...exercise, workout_id: workoutId },
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
    sets.map((set) => ({ ...set, exercise_id: exerciseRow.id })),
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
async function upsertWorkout(supabase: SupabaseClient, mapped: MappedWorkout) {
  const { data: workoutRow, error: workoutError } = await supabase
    .from("workouts")
    .upsert(mapped.workout, { onConflict: "user_id,hevy_id" })
    .select("id")
    .single();

  if (workoutError) {
    throw new Error(workoutError.message);
  }

  for (const { exercise, sets } of mapped.exercises) {
    await upsertExercise(supabase, workoutRow.id, exercise, sets);
  }
}

/**
 * Pulls every workout from Hevy for the signed-in user and upserts it into
 * Supabase. `user_id` is never sent — the database fills it in (default
 * `auth.uid()`) and Row-Level Security ensures a user can only ever write
 * their own rows. Safe to run repeatedly: re-syncing updates existing rows
 * instead of duplicating them.
 */
export async function syncHevyWorkouts() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("You must be signed in to sync workouts.");
  }

  const rawWorkouts = await fetchAllHevyWorkouts();

  for (const raw of rawWorkouts) {
    await upsertWorkout(supabase, mapHevyWorkout(raw));
  }

  revalidatePath("/");
}
