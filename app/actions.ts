"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  parseOptionalPositiveNumber,
  parseRequiredPositiveNumber,
} from "@/lib/measurements";

/**
 * Adds one measurement for the signed-in user. `user_id` is not sent here —
 * the database fills it in automatically (default `auth.uid()`), and
 * Row-Level Security ensures a user can only ever insert their own row.
 * Weight is required; the rest are optional and stored as NULL when blank.
 */
export async function addMeasurement(formData: FormData) {
  const weightLbs = parseRequiredPositiveNumber(
    formData.get("weight_lbs"),
    "weight in lbs",
  );
  const bodyFatPct = parseOptionalPositiveNumber(
    formData.get("body_fat_pct"),
    "body fat %",
  );
  const waistIn = parseOptionalPositiveNumber(
    formData.get("waist_in"),
    "waist measurement",
  );
  const hipsIn = parseOptionalPositiveNumber(
    formData.get("hips_in"),
    "hips measurement",
  );
  const neckIn = parseOptionalPositiveNumber(
    formData.get("neck_in"),
    "neck measurement",
  );

  const supabase = await createClient();
  const { error } = await supabase.from("measurements").insert({
    weight_lbs: weightLbs,
    body_fat_pct: bodyFatPct,
    waist_in: waistIn,
    hips_in: hipsIn,
    neck_in: neckIn,
  });

  if (error) {
    throw new Error(error.message);
  }

  // Refresh both the measurements page (where this form lives) and the
  // dashboard (which shows the latest measurement in its Current Stats tile).
  revalidatePath("/measurements");
  revalidatePath("/");
}