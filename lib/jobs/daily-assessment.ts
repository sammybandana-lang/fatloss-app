import { withJob } from "@/lib/db";
import { numberOrNull } from "@/lib/db/rows";
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
 * The job connects as `app_job`, a database login with NO power to
 * bypass Row-Level Security, and `withJob` stamps the user being
 * processed onto each transaction. So the database scopes these rows the
 * same way it scopes a logged-in person's — a change from the
 * service-role client this replaced, where hand-written `user_id` filters
 * were the only thing separating users. Those filters remain as a second
 * line of defence.
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
  userId: string,
  assessmentDate: string,
  emailData: TrainerEmailData,
): Promise<void> {
  const email = buildTrainerEmail(emailData);
  await sendEmail({ ...email, to: resolveRecipient(email.to) });

  try {
    await withJob(userId, (tx) =>
      tx.query(
        `update daily_assessments
            set sent_at = now()
          where user_id = $1
            and assessment_date = $2`,
        [userId, assessmentDate],
      ),
    );
  } catch (error) {
    throw new Error(
      `Email sent but recording it failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function runDailyAssessment(
  userId: string,
): Promise<DailyAssessmentResult> {
  const assessmentDate = yesterdayInEasternTime();

  // Idempotency guard. trigger.dev retries a failed task, and the schedule
  // can also be fired by hand from the dashboard — neither may produce a
  // second email for a day already sent.
  const existing = await withJob(userId, async (tx) => {
    const { rows } = await tx.query(
      `select ${STORED_COLUMNS}
         from daily_assessments
        where user_id = $1
          and assessment_date = $2`,
      [userId, assessmentDate],
    );

    if (rows.length === 0) {
      return null;
    }

    // The weight and macro columns are `numeric` and arrive as strings.
    // These feed the email that goes to the trainer, so a string here
    // would render as a plausible-looking but unformatted number.
    const row = rows[0];
    return {
      short_assessment: row.short_assessment as string,
      grade: row.grade as AssessmentGrade,
      weight_lbs_start: numberOrNull(row.weight_lbs_start),
      weight_lbs_goal: numberOrNull(row.weight_lbs_goal),
      weight_lbs_current: numberOrNull(row.weight_lbs_current),
      calories: numberOrNull(row.calories),
      protein_g: numberOrNull(row.protein_g),
      workout_present: row.workout_present as boolean,
      workout_volume_lbs: numberOrNull(row.workout_volume_lbs),
      workout_names: (row.workout_names ?? []) as string[],
      sent_at: row.sent_at as Date | null,
    };
  });

  if (existing?.sent_at) {
    console.log(`Assessment for ${assessmentDate} already sent; nothing to do.`);
    return { status: "already_sent", assessmentDate };
  }

  // A row with no `sent_at` means a previous attempt generated the
  // assessment but failed before or during the send. Reuse it rather than
  // paying for the LLM again.
  if (existing) {
    console.log(`Reusing stored assessment for ${assessmentDate}; retrying send.`);
    await sendAndRecord(userId, assessmentDate, toEmailData(existing, assessmentDate));
    return { status: "resent", assessmentDate, grade: existing.grade };
  }

  // Each phase gets its own short transaction rather than one spanning
  // the whole run. The Hevy, Gmail and Azure OpenAI calls in between are
  // network round trips, and a transaction held open across all of them
  // would occupy a connection for the length of the job.
  await withJob(userId, (tx) => syncHevyWorkoutsFor(tx, userId));

  const loseItResult = await withJob(userId, (tx) => importLoseItFor(tx, userId));
  if (!loseItResult.ok) {
    // Don't fail the whole day over a nutrition import problem — the
    // assessment still goes out, honestly reporting the gap.
    console.warn(`LoseIt import failed: ${loseItResult.error}`);
  }

  // `yesterday_date` and `yesterday_workout_names` are labeling data only —
  // they must never reach the LLM (F-004: numeric fields only), so both are
  // stripped before generateAssessment, exactly as the UI path does.
  const { yesterday_date, yesterday_workout_names, ...input } = await withJob(
    userId,
    (tx) => assembleAssessmentInput(tx, userId),
  );

  const { short_assessment, grade, model } = await generateAssessment(input);

  try {
    await withJob(userId, (tx) =>
      tx.query(
        `insert into daily_assessments (
           user_id, assessment_date, weight_lbs_start, weight_lbs_goal,
           weight_lbs_current, calories, protein_g, workout_present,
           workout_volume_lbs, workout_names, short_assessment, grade,
           model, sent_at
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, null)
         on conflict (user_id, assessment_date) do update set
           weight_lbs_start   = excluded.weight_lbs_start,
           weight_lbs_goal    = excluded.weight_lbs_goal,
           weight_lbs_current = excluded.weight_lbs_current,
           calories           = excluded.calories,
           protein_g          = excluded.protein_g,
           workout_present    = excluded.workout_present,
           workout_volume_lbs = excluded.workout_volume_lbs,
           workout_names      = excluded.workout_names,
           short_assessment   = excluded.short_assessment,
           grade              = excluded.grade,
           model              = excluded.model,
           sent_at            = null`,
        [
          userId,
          yesterday_date,
          input.weight_lbs_start,
          input.weight_lbs_goal,
          input.weight_lbs_current,
          input.yesterday_calories,
          input.yesterday_protein_g,
          input.yesterday_workout_present === 1,
          input.yesterday_workout_volume_lbs,
          yesterday_workout_names,
          short_assessment,
          grade,
          model,
        ],
      ),
    );
  } catch (error) {
    throw new Error(
      `Could not save assessment: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Written before sending, on purpose. If the process dies between the
  // send and the `sent_at` stamp, the next run sends a duplicate — which is
  // the better failure than silently skipping a day.
  await sendAndRecord(userId, yesterday_date, {
    yesterdayDate: yesterday_date,
    input,
    yesterdayWorkoutNames: yesterday_workout_names,
    shortAssessment: short_assessment,
    grade,
  });

  return { status: "sent", assessmentDate: yesterday_date, grade };
}
