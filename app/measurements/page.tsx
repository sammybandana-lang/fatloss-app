import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { withUser } from "@/lib/db";
import { numberOrNull, requiredNumber } from "@/lib/db/rows";
import { addMeasurement } from "@/app/actions";
import { PageShell } from "@/app/_components/design/PageShell";
import { Card } from "@/app/_components/design/Card";

const inputClass =
  "rounded-inner border-[0.5px] border-hairline bg-transparent px-4 py-3 text-sm text-primary focus:border-gold focus:outline-none";

interface MeasurementRow {
  id: string;
  weight_lbs: number;
  body_fat_pct: number | null;
  waist_in: number | null;
  hips_in: number | null;
  neck_in: number | null;
  created_at: Date;
}

export default async function MeasurementsPage() {
  // Real "must be signed in" check — runs on the server against the
  // verified session, never trusting the screen.
  const userId = await getCurrentUserId();

  if (!userId) {
    redirect("/login");
  }

  // Every row this returns is the caller's own, enforced by the database
  // rather than by the `where` clause of this query — which is why there
  // isn't one. See lib/db/index.ts.
  const measurements = await withUser(userId, async (tx) => {
    const { rows } = await tx.query(
      `select id, weight_lbs, body_fat_pct, waist_in, hips_in, neck_in, created_at
         from measurements
        order by created_at desc`,
    );

    // numeric columns arrive as strings from node-postgres — converted
    // here, once, rather than left to each place that displays them.
    return rows.map(
      (row): MeasurementRow => ({
        id: row.id,
        weight_lbs: requiredNumber(row.weight_lbs),
        body_fat_pct: numberOrNull(row.body_fat_pct),
        waist_in: numberOrNull(row.waist_in),
        hips_in: numberOrNull(row.hips_in),
        neck_in: numberOrNull(row.neck_in),
        created_at: row.created_at,
      }),
    );
  });

  return (
    <PageShell>
      <div className="flex flex-col gap-10">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-normal text-primary sm:text-[32px]">
            Measurements
          </h1>
          <Link href="/" className="text-sm text-secondary hover:text-primary">
            Back to dashboard
          </Link>
        </div>

        <Card>
          <form action={addMeasurement} className="flex flex-col gap-6">
            <label className="flex flex-col gap-1.5 text-xs text-secondary">
              Weight (lbs)
              <input
                name="weight_lbs"
                type="number"
                step="0.1"
                min="0"
                required
                className={inputClass}
              />
            </label>

            <div className="grid grid-cols-2 gap-6">
              <label className="flex flex-col gap-1.5 text-xs text-secondary">
                Body fat %
                <input
                  name="body_fat_pct"
                  type="number"
                  step="0.1"
                  min="0"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-secondary">
                Waist (in)
                <input
                  name="waist_in"
                  type="number"
                  step="0.1"
                  min="0"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-secondary">
                Hips (in)
                <input name="hips_in" type="number" step="0.1" min="0" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-secondary">
                Neck (in)
                <input name="neck_in" type="number" step="0.1" min="0" className={inputClass} />
              </label>
            </div>

            <button
              type="submit"
              className="w-full rounded-inner bg-primary px-4 py-3 text-sm font-medium text-bg hover:opacity-85"
            >
              Add
            </button>
          </form>
        </Card>

        <Card>
          {measurements && measurements.length > 0 ? (
            <div className="flex flex-col">
              {measurements.map((measurement) => (
                <div
                  key={measurement.id}
                  className="flex flex-col gap-1 border-b-[0.5px] border-hairline py-4 first:pt-0 last:border-0 last:pb-0"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-display text-2xl font-normal text-primary">
                      {measurement.weight_lbs} lbs
                    </span>
                    <span className="text-xs text-secondary">
                      {new Date(measurement.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {(measurement.body_fat_pct !== null ||
                    measurement.waist_in !== null ||
                    measurement.hips_in !== null ||
                    measurement.neck_in !== null) && (
                    <div className="font-mono flex flex-wrap gap-x-4 text-xs text-muted">
                      {measurement.body_fat_pct !== null && (
                        <span>Body fat: {measurement.body_fat_pct}%</span>
                      )}
                      {measurement.waist_in !== null && (
                        <span>Waist: {measurement.waist_in} in</span>
                      )}
                      {measurement.hips_in !== null && (
                        <span>Hips: {measurement.hips_in} in</span>
                      )}
                      {measurement.neck_in !== null && (
                        <span>Neck: {measurement.neck_in} in</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-secondary">No measurements yet.</p>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
