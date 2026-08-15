"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import { withUser } from "@/lib/db";
import { syncHevyWorkoutsFor } from "@/lib/hevy/sync";

/**
 * Pulls the most recent page of workouts from Hevy for the signed-in user.
 * Resolves who is asking from the verified session — never from anything
 * the screen sends — and hands that user id to the shared sync function in
 * `lib/hevy/sync.ts`, which the noon background job also uses.
 *
 * The whole sync runs in one transaction: a Hevy page that fails halfway
 * leaves no half-imported workout behind.
 */
export async function syncHevyWorkouts(): Promise<{ workoutCount: number }> {
  const userId = await requireCurrentUserId();

  const result = await withUser(userId, (tx) => syncHevyWorkoutsFor(tx, userId));

  revalidatePath("/");

  return result;
}
