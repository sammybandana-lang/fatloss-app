"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { syncHevyWorkoutsFor } from "@/lib/hevy/sync";

/**
 * Pulls the most recent page of workouts from Hevy for the signed-in user.
 * Resolves who is asking from the verified session — never from anything
 * the screen sends — and hands that user id to the shared sync function in
 * `lib/hevy/sync.ts`, which the daily background job also uses.
 */
export async function syncHevyWorkouts(): Promise<{ workoutCount: number }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("You must be signed in to sync workouts.");
  }

  const result = await syncHevyWorkoutsFor(supabase, user.id);

  revalidatePath("/");

  return result;
}
