"use server";

import { getCurrentUserId } from "@/lib/auth/current-user";
import { withUser } from "@/lib/db";
import { assembleAssessmentInput } from "@/lib/ai/assessment-input";
import {
  generateAssessment,
  type AssessmentInput,
  type AssessmentGrade,
} from "@/lib/ai/llm-client";

type AssessmentResult =
  | {
      ok: true;
      input: AssessmentInput;
      yesterday_date: string;
      yesterday_workout_names: string[];
      short_assessment: string;
      grade: AssessmentGrade;
      model: string;
      usage: { input_tokens: number; output_tokens: number };
    }
  | { ok: false; error: string };

/**
 * Assembles yesterday's data for the signed-in user (goals, latest weight,
 * yesterday's diet, yesterday's workout) and asks the LLM adapter for a
 * plain-English assessment. Never throws — every outcome, including
 * unexpected errors, comes back as a result value (matches
 * `importLoseItToday`'s convention).
 */
export async function generateTodaysAssessment(): Promise<AssessmentResult> {
  try {
    const userId = await getCurrentUserId();

    if (!userId) {
      return { ok: false, error: "Not authenticated" };
    }

    // `yesterday_date` and `yesterday_workout_names` are UI-only labeling
    // data — they must never reach the LLM, so both are stripped out of
    // `input` before calling generateAssessment.
    //
    // The database work is done and the transaction closed before the LLM
    // call, which is a network round trip to Azure OpenAI — holding a
    // connection open across it would tie up the pool for seconds at a
    // time.
    const { yesterday_date, yesterday_workout_names, ...input } = await withUser(
      userId,
      (tx) => assembleAssessmentInput(tx, userId),
    );
    const { short_assessment, grade, model, usage } = await generateAssessment(input);

    return {
      ok: true,
      input,
      yesterday_date,
      yesterday_workout_names,
      short_assessment,
      grade,
      model,
      usage,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
