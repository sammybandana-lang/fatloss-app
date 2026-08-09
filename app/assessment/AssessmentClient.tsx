"use client";

import { useState } from "react";
import { generateTodaysAssessment } from "./actions";
import type { AssessmentGrade, AssessmentInput } from "@/lib/ai/llm-client";
import { Eyebrow } from "@/app/_components/design/Eyebrow";
import { StatBlock } from "@/app/_components/design/StatBlock";
import { DataRow } from "@/app/_components/design/DataRow";
import { GradeDisplay } from "@/app/_components/design/GradeDisplay";

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
  return value === null ? "Not set" : String(value);
}

/** e.g. "2026-08-07" -> "Aug 7". Parsed/formatted in UTC so the date-only string can't shift a day. */
function formatDateShort(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(isoDate));
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
    <div className="mt-11">
      <button
        type="button"
        onClick={handleGenerate}
        disabled={state.status === "loading"}
        className="rounded-inner border-[0.5px] border-hairline px-4 py-2 text-sm font-medium text-primary hover:bg-surface disabled:opacity-50"
      >
        {state.status === "loading"
          ? "Generating…"
          : state.status === "success"
            ? "Regenerate assessment"
            : "Generate assessment"}
      </button>

      {state.status === "error" && (
        <p className="mt-4 text-sm text-off-track">{state.error}</p>
      )}

      {state.status === "success" && (
        <div className="mt-9 flex flex-col sm:mt-10">
          <p className="mb-9 text-[13px] text-secondary sm:mb-10">
            {formatDateShort(state.yesterdayDate)}
          </p>

          <div className="mb-9 sm:mb-10">
            <Eyebrow>Weight</Eyebrow>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <StatBlock
                label="Starting"
                value={formatWeight(state.input.weight_lbs_start)}
                unit={state.input.weight_lbs_start !== null ? "lbs" : undefined}
              />
              <StatBlock
                label="Current"
                value={formatWeight(state.input.weight_lbs_current)}
                unit={state.input.weight_lbs_current !== null ? "lbs" : undefined}
              />
              <StatBlock
                label="Goal"
                value={formatWeight(state.input.weight_lbs_goal)}
                unit={state.input.weight_lbs_goal !== null ? "lbs" : undefined}
              />
            </div>
          </div>

          <DataRow label="Nutrition">
            {state.input.yesterday_calories === null ||
            state.input.yesterday_protein_g === null ? (
              <p className="font-display text-[30px] font-normal text-secondary">
                Not logged
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                <p className="font-display text-[30px] font-normal text-primary">
                  {state.input.yesterday_calories} cal
                </p>
                <p className="font-mono text-[13px] text-secondary">
                  {state.input.yesterday_protein_g} g protein
                </p>
              </div>
            )}
          </DataRow>

          <DataRow label="Workout">
            {state.input.yesterday_workout_present === 1 ? (
              <div className="flex flex-col gap-1">
                <p className="text-base text-primary">
                  {state.yesterdayWorkoutNames.join(" · ")}
                </p>
                <p className="font-mono text-[13px] text-secondary">
                  {state.input.yesterday_workout_volume_lbs?.toLocaleString()} lbs total
                  volume
                </p>
              </div>
            ) : (
              <p className="text-base text-secondary">None logged</p>
            )}
          </DataRow>

          <GradeDisplay grade={state.grade} assessment={state.shortAssessment} />
        </div>
      )}
    </div>
  );
}
