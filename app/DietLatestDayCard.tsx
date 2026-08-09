"use client";

import { useState } from "react";
import { importLoseItToday, getLatestDayDietTotalsAction } from "@/app/loseit-actions";
import type { LatestDayTotals } from "@/lib/loseit/queries";
import { Card } from "@/app/_components/design/Card";
import { StatBlock } from "@/app/_components/design/StatBlock";

interface DietLatestDayCardProps {
  initialTotals: LatestDayTotals | null;
}

/**
 * Formats a "YYYY-MM-DD" `entry_date` as e.g. "Aug 6". Parsed and formatted
 * in UTC on purpose — the string has no time component, so treating it as
 * a plain calendar date (rather than letting the browser/server's local
 * timezone shift it) avoids an off-by-one-day display bug.
 */
function formatEntryDate(entryDate: string): string {
  const date = new Date(`${entryDate}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function DietLatestDayCard({ initialTotals }: DietLatestDayCardProps) {
  const [totals, setTotals] = useState<LatestDayTotals | null>(initialTotals);
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
      setTotals(await getLatestDayDietTotalsAction());
    }

    setImporting(false);
  }

  const heading = totals
    ? `Food for ${formatEntryDate(totals.entryDate)} (LoseIt)`
    : "Latest food (LoseIt)";

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-2xl font-normal text-primary">{heading}</h2>
      <Card>
        <div className="flex flex-col gap-6">
          {totals ? (
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <StatBlock label="Calories" value={String(Math.round(totals.calories))} />
              <StatBlock label="Fat" value={String(Math.round(totals.fat_g))} unit="g" />
              <StatBlock
                label="Protein"
                value={String(Math.round(totals.protein_g))}
                unit="g"
              />
              <StatBlock label="Carbs" value={String(Math.round(totals.carbs_g))} unit="g" />
            </div>
          ) : (
            <p className="text-sm text-secondary">No LoseIt data imported yet.</p>
          )}

          <button
            type="button"
            onClick={handleImport}
            disabled={importing}
            className="self-start rounded-inner border-[0.5px] border-hairline px-4 py-2 text-sm font-medium text-primary hover:bg-bg disabled:opacity-50"
          >
            {importing ? "Importing..." : "Import LoseIt"}
          </button>

          {message && (
            <p
              className={`text-xs ${message.startsWith("Import failed") ? "text-off-track" : "text-secondary"}`}
            >
              {message}
            </p>
          )}
        </div>
      </Card>
    </section>
  );
}
