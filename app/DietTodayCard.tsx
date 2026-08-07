"use client";

import { useState } from "react";
import { importLoseItToday, getTodaysDietTotalsAction } from "@/app/loseit-actions";
import type { TodayTotals } from "@/lib/loseit/queries";

interface DietTodayCardProps {
  initialTotals: TodayTotals | null;
}

export function DietTodayCard({ initialTotals }: DietTodayCardProps) {
  const [totals, setTotals] = useState<TodayTotals | null>(initialTotals);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleImport() {
    setImporting(true);
    setMessage(null);

    const result = await importLoseItToday();

    if (!result.ok) {
      setMessage(`Import failed: ${result.error}`);
    } else if ("no_email" in result) {
      setMessage("No LoseIt email today.");
    } else {
      setMessage(
        `Imported ${result.inserted} foods (${result.skipped_dupes} already existed).`,
      );
      setTotals(await getTodaysDietTotalsAction());
    }

    setImporting(false);
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Today&apos;s food (LoseIt)</h2>
      <div className="flex flex-col gap-3 rounded border border-zinc-200 px-3 py-2 text-sm">
        {totals ? (
          <div className="flex flex-col gap-1">
            <span>Calories: {Math.round(totals.calories)}</span>
            <span>Fat: {Math.round(totals.fat_g)}g</span>
            <span>Protein: {Math.round(totals.protein_g)}g</span>
            <span>Carbs: {Math.round(totals.carbs_g)}g</span>
          </div>
        ) : (
          <p className="text-zinc-500">No LoseIt data imported today.</p>
        )}

        <button
          type="button"
          onClick={handleImport}
          disabled={importing}
          className="self-start rounded border border-black px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {importing ? "Importing..." : "Import LoseIt"}
        </button>

        {message && (
          <p
            className={`text-xs ${message.startsWith("Import failed") ? "text-red-600" : "text-zinc-500"}`}
          >
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
