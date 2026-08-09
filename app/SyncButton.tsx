"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { syncHevyWorkouts } from "./hevy-actions";
import { importLoseItToday } from "./loseit-actions";

/** Describes the Hevy half of a sync run, independent of how it resolved. */
function describeHevyResult(result: PromiseSettledResult<{ workoutCount: number }>): string {
  if (result.status === "rejected") {
    const message = result.reason instanceof Error ? result.reason.message : "Sync failed.";
    return `Hevy failed: ${message}`;
  }
  return `Synced ${result.value.workoutCount} workouts`;
}

/** Describes the LoseIt half of a sync run, independent of how it resolved. */
function describeLoseItResult(
  result: PromiseSettledResult<Awaited<ReturnType<typeof importLoseItToday>>>,
): string {
  if (result.status === "rejected") {
    const message = result.reason instanceof Error ? result.reason.message : "Import failed.";
    return `LoseIt failed: ${message}`;
  }
  const value = result.value;
  if (!value.ok) {
    return `LoseIt failed: ${value.error}`;
  }
  if ("no_email" in value) {
    return "LoseIt: No email today";
  }
  return `Imported ${value.inserted} foods`;
}

export function SyncButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setMessage(null);

    const [hevyResult, loseitResult] = await Promise.allSettled([
      syncHevyWorkouts(),
      importLoseItToday(),
    ]);

    setMessage(
      `${describeHevyResult(hevyResult)} · ${describeLoseItResult(loseitResult)}`,
    );
    setSyncing(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleSync}
        disabled={syncing}
        className="rounded-inner bg-gold px-4 py-2 text-sm font-medium text-bg hover:opacity-85 disabled:opacity-50"
      >
        {syncing ? "Syncing…" : "Sync Data"}
      </button>
      {message && <p className="text-xs text-secondary">{message}</p>}
    </div>
  );
}
