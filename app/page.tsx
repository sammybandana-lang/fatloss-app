import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLatestWorkout } from "@/lib/hevy/queries";
import { getLatestDayDietTotals } from "@/lib/loseit/queries";
import { kgToLbs } from "@/lib/units";
import { addMeasurement } from "./actions";
import { logout } from "./login/actions";
import { HevySyncButton } from "./hevy-sync-button";
import { DietLatestDayCard } from "@/app/DietLatestDayCard";
import { PageShell } from "@/app/_components/design/PageShell";
import { Card } from "@/app/_components/design/Card";
import { Eyebrow } from "@/app/_components/design/Eyebrow";

const inputClass =
  "rounded-inner border-[0.5px] border-hairline bg-transparent px-4 py-3 text-sm text-primary focus:border-gold focus:outline-none";

function formatSet(set: { reps: number | null; weight_kg: number | null }): string {
  const parts: string[] = [];
  if (set.reps !== null) {
    parts.push(`${set.reps} reps`);
  }
  if (set.weight_kg !== null) {
    parts.push(`${kgToLbs(set.weight_kg)} lbs`);
  }
  return parts.length > 0 ? parts.join(" · ") : "No data logged";
}

export default async function HomePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // This is the real "must be signed in" check — it runs on the server and
  // trusts only the verified session, never the screen.
  if (!user) {
    redirect("/login");
  }

  const { data: measurements, error } = await supabase
    .from("measurements")
    .select(
      "id, weight_lbs, body_fat_pct, waist_in, hips_in, neck_in, created_at",
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const latestWorkout = await getLatestWorkout(supabase);
  const initialTotals = await getLatestDayDietTotals(supabase);

  return (
    <PageShell>
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <h1 className="font-display text-2xl font-normal text-primary sm:text-[32px]">
              Dashboard
            </h1>
            <nav className="flex gap-4 text-sm">
              <Link href="/goals" className="text-secondary hover:text-primary">
                Goals
              </Link>
              <Link href="/assessment" className="text-secondary hover:text-primary">
                Assessment
              </Link>
              <form action={logout}>
                <button type="submit" className="text-secondary hover:text-primary">
                  Log out
                </button>
              </form>
            </nav>
          </div>

          <div className="flex justify-end">
            <HevySyncButton />
          </div>
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
                <input
                  name="hips_in"
                  type="number"
                  step="0.1"
                  min="0"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-secondary">
                Neck (in)
                <input
                  name="neck_in"
                  type="number"
                  step="0.1"
                  min="0"
                  className={inputClass}
                />
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

        <section className="flex flex-col gap-4">
          <Eyebrow>Latest Hevy workout</Eyebrow>
          {latestWorkout ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-medium text-primary">
                  {latestWorkout.title}
                </span>
                <span className="text-xs text-secondary">
                  {latestWorkout.start_time
                    ? new Date(latestWorkout.start_time).toLocaleDateString()
                    : "—"}
                </span>
              </div>
              {latestWorkout.exercises.map((exercise) => (
                <div key={exercise.id} className="flex flex-col gap-1 pl-3">
                  <span className="text-sm font-medium text-primary">
                    {exercise.title}
                  </span>
                  <ul className="font-mono flex flex-col gap-0.5 pl-3 text-[13px] text-secondary">
                    {exercise.sets.map((set) => (
                      <li key={set.set_index}>{formatSet(set)}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-secondary">No workouts synced yet.</p>
          )}
        </section>

        <DietLatestDayCard initialTotals={initialTotals} />
      </div>
    </PageShell>
  );
}
