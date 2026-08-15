import { schedules } from "@trigger.dev/sdk";
// Relative imports rather than the "@/" alias used elsewhere in the app.
// This file is bundled by trigger.dev, not by Next.js, and a path alias
// that fails to resolve would only show up at deploy time — the exact
// dev/prod drift LESSONS_LEARNED.md warns about. Relative paths cannot
// drift.
import { runDailyAssessment } from "../lib/jobs/daily-assessment";

/**
 * Runs the daily pipeline at noon Eastern: sync Hevy + LoseIt, generate
 * yesterday's assessment, email it to the trainer.
 *
 * Scoped to a single user on purpose. The Hevy API key and Gmail mailbox
 * are process-wide credentials, not per-user, so this job can only serve
 * the one account they belong to. `runDailyAssessment` takes a user id so
 * that a future multi-user version is a loop here, not a rewrite.
 */
export const dailyAssessment = schedules.task({
  id: "daily-assessment",

  // `timezone` must be nested inside `cron` — on schedules.task it is not a
  // sibling field (it is on the imperative schedules.create, which is where
  // the confusion comes from).
  //
  // America/New_York, not a fixed UTC offset: this fires at noon on the New
  // York clock year-round, and matches lib/dates.ts, which uses the same
  // DST-aware zone to decide which day counts as "yesterday". The job is
  // unaffected by where anyone is physically located.
  cron: {
    pattern: "0 12 * * *",
    timezone: "America/New_York",
  },

  maxDuration: 300,

  run: async () => {
    const userId = process.env.ONLY_ALLOWED_USER_ID;
    if (!userId) {
      throw new Error("ONLY_ALLOWED_USER_ID is not set.");
    }

    // No client is passed in any more. The job opens its own connections
    // as the `app_job` database login, which — unlike the service-role
    // key this replaced — cannot bypass row-level security.
    const result = await runDailyAssessment(userId);

    console.log(`Daily assessment: ${result.status} for ${result.assessmentDate}`);

    return result;
  },
});
