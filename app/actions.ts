"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import { withUser } from "@/lib/db";
import {
  parseOptionalPositiveNumber,
  parseRequiredPositiveNumber,
} from "@/lib/measurements";

/**
 * Adds one measurement for the signed-in user.
 *
 * `user_id` is still not sent: the column's default fills it in, and
 * Row-Level Security independently rejects a row belonging to anyone
 * else. What changed in the Azure migration (Phase 3) is where the
 * database gets the answer from — `app_current_user_id()` reads the
 * identity that `withUser` stamped onto this transaction, rather than
 * Supabase reading it from the request. The guarantee is the same; the
 * plumbing is ours now.
 *
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

  // Read from the verified session, never from the form — a form can
  // claim to be anyone.
  const userId = await requireCurrentUserId();

  await withUser(userId, (tx) =>
    tx.query(
      `insert into measurements (weight_lbs, body_fat_pct, waist_in, hips_in, neck_in)
       values ($1, $2, $3, $4, $5)`,
      [weightLbs, bodyFatPct, waistIn, hipsIn, neckIn],
    ),
  );

  // Refresh both the measurements page (where this form lives) and the
  // dashboard (which shows the latest measurement in its Current Stats tile).
  revalidatePath("/measurements");
  revalidatePath("/");
}
