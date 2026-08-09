"use client";

import { useActionState } from "react";
import { upsertGoals, type Goals, type GoalsInput } from "./actions";
import { Card } from "@/app/_components/design/Card";

type FormState = { message: string | null; isError: boolean };

const INITIAL_STATE: FormState = { message: null, isError: false };

const inputClass =
  "rounded-inner border-[0.5px] border-hairline bg-transparent px-4 py-3 text-sm text-primary focus:border-gold focus:outline-none";

function parseOptionalNumber(value: FormDataEntryValue | null): number | null {
  if (value === null || value === "") {
    return null;
  }
  return Number(value);
}

async function runUpsert(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const input: GoalsInput = {
    weight_lbs_start: parseOptionalNumber(formData.get("weight_lbs_start")),
    weight_lbs_goal: parseOptionalNumber(formData.get("weight_lbs_goal")),
    daily_calories_goal: parseOptionalNumber(formData.get("daily_calories_goal")),
    daily_protein_g_goal: parseOptionalNumber(
      formData.get("daily_protein_g_goal"),
    ),
    weekly_workout_goal: parseOptionalNumber(
      formData.get("weekly_workout_goal"),
    ),
  };

  const result = await upsertGoals(input);

  if (!result.ok) {
    return { message: result.error, isError: true };
  }
  return { message: "Goals saved.", isError: false };
}

export function GoalsForm({ initialGoals }: { initialGoals: Goals | null }) {
  const [state, formAction, isPending] = useActionState(
    runUpsert,
    INITIAL_STATE,
  );

  return (
    <Card>
      <form action={formAction} className="flex flex-col gap-6">
        <label className="flex flex-col gap-1.5 text-xs text-secondary">
          Starting weight (lbs)
          <input
            name="weight_lbs_start"
            type="number"
            step="0.1"
            min="0"
            defaultValue={initialGoals?.weight_lbs_start ?? ""}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-secondary">
          Goal weight (lbs)
          <input
            name="weight_lbs_goal"
            type="number"
            step="0.1"
            min="0"
            defaultValue={initialGoals?.weight_lbs_goal ?? ""}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-secondary">
          Daily calorie target
          <input
            name="daily_calories_goal"
            type="number"
            step="1"
            min="0"
            defaultValue={initialGoals?.daily_calories_goal ?? ""}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-secondary">
          Daily protein target (g)
          <input
            name="daily_protein_g_goal"
            type="number"
            step="1"
            min="0"
            defaultValue={initialGoals?.daily_protein_g_goal ?? ""}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-secondary">
          Weekly workout target
          <input
            name="weekly_workout_goal"
            type="number"
            step="1"
            min="0"
            defaultValue={initialGoals?.weekly_workout_goal ?? ""}
            className={inputClass}
          />
        </label>

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-inner bg-primary px-4 py-3 text-sm font-medium text-bg hover:opacity-85 disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save goals"}
        </button>

        {state.message && (
          <p className={`text-xs ${state.isError ? "text-off-track" : "text-secondary"}`}>
            {state.message}
          </p>
        )}
      </form>
    </Card>
  );
}
