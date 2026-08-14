import type { SupabaseClient } from "@supabase/supabase-js";
import { yesterdayInEasternTime } from "@/lib/dates";
import { syncHevyWorkoutsFor } from "@/lib/hevy/sync";
import { importLoseItFor } from "@/lib/loseit/sync";
import { assembleAssessmentInput } from "@/lib/ai/assessment-input";
import { generateAssessment, type AssessmentGrade } from "@/lib/ai/llm-client";
import { buildTrainerEmail, type TrainerEmailData } from "@/lib/email/trainer-email";
import { sendEmail } from "@/lib/gmail/send";

/**
 * The daily pipeline: sync both data sources, generate yesterday's
 * assessment, email it to the trainer, and record that it went out.
 *
 * Lives here rather than in `trigger/` so it can be tested with plain
 * vitest — nothing in this file imports trigger.dev.
 *
 * IMPORTANT: `supabase` is a service-role client, which bypasses
 * Row-Level Security. Every query below scopes to `userId` explicitly, and
 * that is the only thing separating users in this code path. See
 * `lib/supabase/service.ts`.
 */

export type DailyAssessmentResult =
  | { status: "sent"; assessmentDate: string; grade: AssessmentGrade }
  | { status: "already_sent"; assessmentDate: string }
  | { status: "resent"; assessmentDate: string; grade: AssessmentGrade };

/** The stored columns needed to rebuild the email without re-calling the LLM. */
interface StoredAssessment {
  short_assessment: string;
  grade: AssessmentGrade;
  weight_lbs_start: number | null;
  weight_lbs_goal: number | null;
  weight_lbs_current: number | null;
  calories: number | null;
  protein_g: number | null;
  workout_present: boolean;
  workout_volume_lbs: number | null;
  workout_names: string[];
}

const STORED_COLUMNS =
  "short_assessment, grade, weight_lbs_start, weight_lbs_goal, weight_lbs_current, " +
  "calories, protein_g, workout_present, workout_volume_lbs, workout_names, sent_at";

/** Rebuilds the email payload from a stored row, so a retry doesn't re-bill the LLM. */
function toEmailData(
  stored: StoredAssessment,
  assessmentDate: string,
): TrainerEmailData {
  return {
    yesterdayDate: assessmentDate,
    input: {
      weight_lbs_start: stored.weight_lbs_start,
      weight_lbs_goal: stored.weight_lbs_goal,
      weight_lbs_current: stored.weight_lbs_current,
      yesterday_calories: stored.calories,
      yesterday_protein_g: stored.protein_g,
      yesterday_workout_present: stored.workout_present ? 1 : 0,
      yesterday_workout_volume_lbs: stored.workout_volume_lbs,
    },
    yesterdayWorkoutNames: stored.workout_names,
    shortAssessment: stored.short_assessment,
    grade: stored.grade,
  };
}

/**
 * Where the email actually goes. Normally the trainer; when
 * TRAINER_EMAIL_OVERRIDE is set it goes there instead, so a dev run can be
 * checked without mailing the trainer.
 *
 * Read here in the job rather than in `lib/email/trainer-email.ts` on
 * purpose: that module is imported by a client component, where
 * non-NEXT_PUBLIC_ env vars don't exist. Keeping the override server-side
 * means there is exactly one place it can apply, and it can never leak the
 * address into the browser bundle.
 *
 * The redirect is logged, because silently mailing somewhere other than
 * where the code says is exactly the kind of surprise that wastes an
 * afternoon.
 */
function resolveRecipient(intended: string): string {
  const override = process.env.TRAINER_EMAIL_OVERRIDE;
  if (!override) {
    return intended;
  }
  console.log(`TRAINER_EMAIL_OVERRIDE set: sending to ${override} instead of ${intended}`);
  return override;
}

/** Sends the email, then stamps `sent_at`. */
async function sendAndRecord(
  supabase: SupabaseClient,
  userId: string,
  assessmentDate: string,
  emailData: TrainerEmailData,
): Promise<void> {
  const email = buildTrainerEmail(emailData);
  await sendEmail({ ...email, to: resolveRecipient(email.to) });

  const { error } = await supabase
    .from("daily_assessments")
    .update({ sent_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("assessment_date", assessmentDate);

  if (error) {
    throw new Error(`Email sent but recording it failed: ${error.message}`);
  }
}

export async function runDailyAssessment(
  supabase: SupabaseClient,
  userId: string,
): Promise<DailyAssessmentResult> {
  const assessmentDate = yesterdayInEasternTime();

  // Idempotency guard. trigger.dev retries a failed task, and the schedule
  // can also be fired by hand from the dashboard — neither may produce a
  // second email for a day already sent.
  const { data: existing, error: existingError } = await supabase
    .from("daily_assessments")
    .select(STORED_COLUMNS)
    .eq("user_id", userId)
    .eq("assessment_date", assessmentDate)
    .maybeSingle<StoredAssessment & { sent_at: string | null }>();

  if (existingError) {
    throw new Error(`Could not read existing assessment: ${existingError.message}`);
  }

  if (existing?.sent_at) {
    console.log(`Assessment for ${assessmentDate} already sent; nothing to do.`);
    return { status: "already_sent", assessmentDate };
  }

  // A row with no `sent_at` means a previous attempt generated the
  // assessment but failed before or during the send. Reuse it rather than
  // paying for the LLM again.
  if (existing) {
    console.log(`Reusing stored assessment for ${assessmentDate}; retrying send.`);
    await sendAndRecord(supabase, userId, assessmentDate, toEmailData(existing, assessmentDate));
    return { status: "resent", assessmentDate, grade: existing.grade };
  }

  await syncHevyWorkoutsFor(supabase, userId);

  const loseItResult = await importLoseItFor(supabase, userId);
  if (!loseItResult.ok) {
    // Don't fail the whole day over a nutrition import problem — the
    // assessment still goes out, honestly reporting the gap.
    console.warn(`LoseIt import failed: ${loseItResult.error}`);
  }

  // `yesterday_date` and `yesterday_workout_names` are labeling data only —
  // they must never reach the LLM (F-004: numeric fields only), so both are
  // stripped before generateAssessment, exactly as the UI path does.
  const { yesterday_date, yesterday_workout_names, ...input } =
    await assembleAssessmentInput(supabase, userId);

  const { short_assessment, grade, model } = await generateAssessment(input);

  const { error: writeError } = await supabase.from("daily_assessments").upsert(
    {
      user_id: userId,
      assessment_date: yesterday_date,
      weight_lbs_start: input.weight_lbs_start,
      weight_lbs_goal: input.weight_lbs_goal,
      weight_lbs_current: input.weight_lbs_current,
      calories: input.yesterday_calories,
      protein_g: input.yesterday_protein_g,
      workout_present: input.yesterday_workout_present === 1,
      workout_volume_lbs: input.yesterday_workout_volume_lbs,
      workout_names: yesterday_workout_names,
      short_assessment,
      grade,
      model,
      sent_at: null,
    },
    { onConflict: "user_id,assessment_date" },
  );

  if (writeError) {
    throw new Error(`Could not save assessment: ${writeError.message}`);
  }

  // Written before sending, on purpose. If the process dies between the
  // send and the `sent_at` stamp, the next run sends a duplicate — which is
  // the better failure than silently skipping a day.
  await sendAndRecord(supabase, userId, yesterday_date, {
    yesterdayDate: yesterday_date,
    input,
    yesterdayWorkoutNames: yesterday_workout_names,
    shortAssessment: short_assessment,
    grade,
  });

  return { status: "sent", assessmentDate: yesterday_date, grade };
}
