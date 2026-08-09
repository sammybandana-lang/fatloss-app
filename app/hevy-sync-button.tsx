"use client";

import { useActionState } from "react";
import { syncHevyWorkouts } from "./hevy-actions";

type SyncState = { error: string | null };

async function runSync(): Promise<SyncState> {
  try {
    await syncHevyWorkouts();
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Sync failed." };
  }
}

export function HevySyncButton() {
  const [state, formAction, isPending] = useActionState(runSync, {
    error: null,
  });

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={isPending}
        className="rounded-inner border-[0.5px] border-hairline px-4 py-2 text-sm font-medium text-primary hover:bg-surface disabled:opacity-50"
      >
        {isPending ? "Syncing…" : "Sync Hevy"}
      </button>
      {state.error && <p className="text-xs text-off-track">{state.error}</p>}
    </form>
  );
}
