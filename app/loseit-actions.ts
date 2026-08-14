"use server";

import { createClient } from "@/lib/supabase/server";
import { importLoseItFor, type ImportResult } from "@/lib/loseit/sync";
import { getLatestDayDietTotals, type LatestDayTotals } from "@/lib/loseit/queries";

/**
 * Imports today's LoseIt daily report for the signed-in user. Resolves who
 * is asking from the verified session, then delegates to the shared import
 * in `lib/loseit/sync.ts`, which the daily background job also uses.
 */
export async function importLoseItToday(): Promise<ImportResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not authenticated" };
  }

  return importLoseItFor(supabase, user.id);
}

/**
 * Thin server action wrapper so the client component can re-fetch the
 * latest day's totals after an import — client components can't call
 * server-only query functions directly, only server actions.
 */
export async function getLatestDayDietTotalsAction(): Promise<LatestDayTotals | null> {
  const supabase = await createClient();
  return getLatestDayDietTotals(supabase);
}
