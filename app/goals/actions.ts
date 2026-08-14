"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { withUser } from "@/lib/db";
import { numberOrNull } from "@/lib/db/rows";

export type Goals = {
  weight_lbs_start: number | null;
  weight_lbs_goal: number | null;
  daily_calories_goal: number | null;
  daily_protein_g_goal: number | null;
  weekly_workout_goal: number | null;
  updated_at: string;
};

export type GoalsInput = Omit<Goals, "updated_at">;

/**
 * Loads the signed-in user's goals, or null if they haven't set any yet.
 *
 * No user_id filter in the query — the database scopes the rows. Zero
 * rows is a valid state for a brand-new user, not an error.
 */
export async function getGoals(): Promise<Goals | null> {
  const userId = await getCurrentUserId();

  if (!userId) {
    return null;
  }

  return withUser(userId, async (tx) => {
    const { rows } = await tx.query(
      `select weight_lbs_start, weight_lbs_goal, daily_calories_goal,
              daily_protein_g_goal, weekly_workout_goal, updated_at
         from goals`,
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];

    return {
      // weight columns are `numeric`, so they arrive as strings; the
      // three targets are `integer` and arrive as numbers. Both go
      // through the same conversion so a future column-type change
      // cannot quietly turn one into the other.
      weight_lbs_start: numberOrNull(row.weight_lbs_start),
      weight_lbs_goal: numberOrNull(row.weight_lbs_goal),
      daily_calories_goal: numberOrNull(row.daily_calories_goal),
      daily_protein_g_goal: numberOrNull(row.daily_protein_g_goal),
      weekly_workout_goal: numberOrNull(row.weekly_workout_goal),
      // timestamptz arrives as a Date object, where the Supabase client
      // returned an ISO string. The form reads this, so it is converted
      // back rather than changing the shape callers expect.
      updated_at: (row.updated_at as Date).toISOString(),
    };
  });
}

const POSITIVE_NUMBER_FIELDS: Array<{ key: keyof GoalsInput; label: string }> = [
  { key: "weight_lbs_start", label: "starting weight" },
  { key: "weight_lbs_goal", label: "goal weight" },
  { key: "daily_calories_goal", label: "daily calorie target" },
  { key: "daily_protein_g_goal", label: "daily protein target" },
  { key: "weekly_workout_goal", label: "weekly workout target" },
];

/**
 * Every goal field is optional (null allowed), but if present must be a
 * positive number. Never rely on the form's `type="number"` alone —
 * validate server-side too.
 */
function validateGoalsInput(input: GoalsInput): string | null {
  for (const { key, label } of POSITIVE_NUMBER_FIELDS) {
    const value = input[key];
    if (value === null) {
      continue;
    }
    if (!Number.isFinite(value) || value <= 0) {
      return `Enter a valid ${label}, or leave it blank.`;
    }
  }
  return null;
}

/**
 * Saves the signed-in user's goals — one row per user, so a repeated save
 * updates in place instead of stacking rows.
 *
 * `user_id` is stamped from the verified session, never trusted from the
 * caller, and the database's WITH CHECK policy independently rejects the
 * write if it were ever wrong.
 *
 * Returns a result object rather than throwing, because the form renders
 * the message. Database errors are caught to preserve that contract:
 * node-postgres throws where the Supabase client returned an error field.
 */
export async function upsertGoals(
  input: GoalsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const validationError = validateGoalsInput(input);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const userId = await getCurrentUserId();

  if (!userId) {
    return { ok: false, error: "Not authenticated" };
  }

  try {
    await withUser(userId, (tx) =>
      tx.query(
        `insert into goals (
           user_id, weight_lbs_start, weight_lbs_goal, daily_calories_goal,
           daily_protein_g_goal, weekly_workout_goal, updated_at
         )
         values ($1, $2, $3, $4, $5, $6, now())
         on conflict (user_id) do update set
           weight_lbs_start     = excluded.weight_lbs_start,
           weight_lbs_goal      = excluded.weight_lbs_goal,
           daily_calories_goal  = excluded.daily_calories_goal,
           daily_protein_g_goal = excluded.daily_protein_g_goal,
           weekly_workout_goal  = excluded.weekly_workout_goal,
           updated_at           = now()`,
        [
          userId,
          input.weight_lbs_start,
          input.weight_lbs_goal,
          input.daily_calories_goal,
          input.daily_protein_g_goal,
          input.weekly_workout_goal,
        ],
      ),
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save goals.",
    };
  }

  revalidatePath("/goals");
  return { ok: true };
}
