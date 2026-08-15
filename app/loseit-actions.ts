"use server";

import { getCurrentUserId } from "@/lib/auth/current-user";
import { withUser } from "@/lib/db";
import { importLoseItFor, type ImportResult } from "@/lib/loseit/sync";
import { getLatestDayDietTotals, type LatestDayTotals } from "@/lib/loseit/queries";

/**
 * Imports today's LoseIt daily report for the signed-in user. Resolves who
 * is asking from the verified session, then delegates to the shared import
 * in `lib/loseit/sync.ts`, which the daily background job also uses.
 */
export async function importLoseItToday(): Promise<ImportResult> {
  const userId = await getCurrentUserId();

  if (!userId) {
    return { ok: false, error: "Not authenticated" };
  }

  // One transaction for the whole daily report: a batch that fails
  // partway leaves nothing behind, which is the same reasoning the
  // parser already applies to malformed rows.
  return withUser(userId, (tx) => importLoseItFor(tx, userId));
}

/**
 * Thin server action wrapper so the client component can re-fetch the
 * latest day's totals after an import — client components can't call
 * server-only query functions directly, only server actions.
 */
export async function getLatestDayDietTotalsAction(): Promise<LatestDayTotals | null> {
  const userId = await getCurrentUserId();

  if (!userId) {
    return null;
  }

  return withUser(userId, (tx) => getLatestDayDietTotals(tx));
}
