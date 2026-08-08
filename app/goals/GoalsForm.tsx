"use client";

import { useActionState } from "react";
import { upsertGoals, type Goals, type GoalsInput } from "./actions";

type FormState = { message: string | null; isError: boolean };

const INITIAL_STATE: FormState = { message: null, isError: false };

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
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded border border-zinc-200 p-4"
    >
      <label className="flex flex-col gap-1 text-sm">
        Starting weight (lbs)
        <input
          name="weight_lbs_start"
          type="number"
          step="0.1"
          min="0"
          defaultValue={initialGoals?.weight_lbs_start ?? ""}
          className="rounded border border-zinc-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Goal weight (lbs)
        <input
          name="weight_lbs_goal"
          type="number"
          step="0.1"
          min="0"
          defaultValue={initialGoals?.weight_lbs_goal ?? ""}
          className="rounded border border-zinc-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Daily calorie target
        <input
          name="daily_calories_goal"
          type="number"
          step="1"
          min="0"
          defaultValue={initialGoals?.daily_calories_goal ?? ""}
          className="rounded border border-zinc-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Daily protein target (g)
        <input
          name="daily_protein_g_goal"
          type="number"
          step="1"
          min="0"
          defaultValue={initialGoals?.daily_protein_g_goal ?? ""}
          className="rounded border border-zinc-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Weekly workout target
        <input
          name="weekly_workout_goal"
          type="number"
          step="1"
          min="0"
          defaultValue={initialGoals?.weekly_workout_goal ?? ""}
          className="rounded border border-zinc-300 px-3 py-2"
        />
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? "Saving..." : "Save goals"}
      </button>

      {state.message && (
        <p
          className={`text-xs ${state.isError ? "text-red-600" : "text-zinc-500"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
