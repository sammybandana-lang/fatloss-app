"use client";

import { useState } from "react";
import { generateTodaysAssessment } from "./actions";
import type { AssessmentGrade, AssessmentInput } from "@/lib/ai/llm-client";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "success";
      input: AssessmentInput;
      yesterdayDate: string;
      yesterdayWorkoutNames: string[];
      shortAssessment: string;
      grade: AssessmentGrade;
    }
  | { status: "error"; error: string };

function formatWeight(value: number | null): string {
  return value === null ? "Not set" : `${value} lbs`;
}

/** Calories/protein are logged together (one LoseIt import) — if either is missing, treat the day as not logged. */
function formatNutrition(input: AssessmentInput): string {
  if (input.yesterday_calories === null || input.yesterday_protein_g === null) {
    return "Not logged";
  }
  return `${input.yesterday_calories} cal / ${input.yesterday_protein_g} g protein`;
}

/** e.g. "2026-08-07" -> "Aug 7". Parsed/formatted in UTC so the date-only string can't shift a day. */
function formatDateShort(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(isoDate));
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

export function AssessmentClient() {
  const [state, setState] = useState<State>({ status: "idle" });

  async function handleGenerate() {
    setState({ status: "loading" });

    const result = await generateTodaysAssessment();

    if (!result.ok) {
      setState({ status: "error", error: result.error });
      return;
    }

    setState({
      status: "success",
      input: result.input,
      yesterdayDate: result.yesterday_date,
      yesterdayWorkoutNames: result.yesterday_workout_names,
      shortAssessment: result.short_assessment,
      grade: result.grade,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={handleGenerate}
        disabled={state.status === "loading"}
        className="self-start rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {state.status === "loading" ? "Generating…" : "Generate assessment"}
      </button>

      {state.status === "error" && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}

      {state.status === "success" && (
        <div className="flex flex-col gap-4 rounded border border-zinc-200 p-4 text-sm">
          <p className="text-xs font-medium text-zinc-500">
            Assessment for {formatDateShort(state.yesterdayDate)}
          </p>

          <div className="grid grid-cols-3 gap-3">
            <Fact label="Goal weight" value={formatWeight(state.input.weight_lbs_goal)} />
            <Fact
              label="Starting weight"
              value={formatWeight(state.input.weight_lbs_start)}
            />
            <Fact
              label="Current weight"
              value={formatWeight(state.input.weight_lbs_current)}
            />
          </div>

          <Fact label="Yesterday's nutrition" value={formatNutrition(state.input)} />

          <div className="flex flex-col">
            <span className="text-xs font-medium text-zinc-500">
              Yesterday&apos;s workouts
            </span>
            {state.input.yesterday_workout_present === 1 ? (
              <>
                <span className="text-sm">{state.yesterdayWorkoutNames.join(" · ")}</span>
                <span className="text-sm text-zinc-600">
                  Volume: {state.input.yesterday_workout_volume_lbs?.toLocaleString()} lbs
                </span>
              </>
            ) : (
              <span className="text-sm">None logged</span>
            )}
          </div>

          <div className="flex flex-col gap-1 border-t border-zinc-200 pt-3">
            <span className="text-xs font-medium text-zinc-500">Short assessment</span>
            <p>{state.shortAssessment}</p>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-xs font-medium text-zinc-500">Overall grade</span>
            <span className="text-2xl font-bold">{state.grade}</span>
          </div>
        </div>
      )}
    </div>
  );
}
