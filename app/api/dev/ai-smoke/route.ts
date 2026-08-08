import { NextResponse } from "next/server";
import { generateAssessment, type AssessmentInput } from "@/lib/ai/llm-client";

/**
 * Dev-only route to prove the Azure OpenAI adapter plumbing end-to-end.
 * Uses a hardcoded fixture — no real user data flows through this slice.
 *
 * The `NODE_ENV === "production"` 404 gate below is the sole security
 * boundary for this route: no auth check, no user gate. In dev only Sam
 * runs the server; in prod the route does not exist.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }

  const fixture: AssessmentInput = {
    weight_lbs_current: 210,
    weight_lbs_goal: 195,
    days_tracked: 30,
    avg_calories_last_7d: 2100,
    avg_protein_g_last_7d: 165,
    workout_count_last_7d: 4,
  };

  try {
    const result = await generateAssessment(fixture);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
