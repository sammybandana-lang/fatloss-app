"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Adds one weight measurement for the signed-in user. `user_id` is not sent
 * here — the database fills it in automatically (default `auth.uid()`), and
 * Row-Level Security ensures a user can only ever insert their own row.
 */
export async function addMeasurement(formData: FormData) {
  const weightLbs = Number(formData.get("weight_lbs"));

  if (!Number.isFinite(weightLbs) || weightLbs <= 0) {
    throw new Error("Enter a valid weight in lbs.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("measurements")
    .insert({ weight_lbs: weightLbs });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
}
