import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLatestWorkout } from "@/lib/hevy/queries";
import { getTodaysDietTotals } from "@/lib/loseit/queries";
import { kgToLbs } from "@/lib/units";
import { addMeasurement } from "./actions";
import { logout } from "./login/actions";
import { HevySyncButton } from "./hevy-sync-button";
import { DietTodayCard } from "@/app/DietTodayCard";

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
  const initialTotals = await getTodaysDietTotals();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-8 px-6 py-12">
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <div className="flex flex-col items-end gap-2">
          <Link href="/goals" className="text-sm text-zinc-500 underline">
            Goals
          </Link>
          <HevySyncButton />
          <form action={logout}>
            <button type="submit" className="text-sm text-zinc-500 underline">
              Log out
            </button>
          </form>
        </div>
      </div>

      <form
        action={addMeasurement}
        className="flex flex-col gap-3 rounded border border-zinc-200 p-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          Weight (lbs)
          <input
            name="weight_lbs"
            type="number"
            step="0.1"
            min="0"
            required
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Body fat %
            <input
              name="body_fat_pct"
              type="number"
              step="0.1"
              min="0"
              className="rounded border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Waist (in)
            <input
              name="waist_in"
              type="number"
              step="0.1"
              min="0"
              className="rounded border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Hips (in)
            <input
              name="hips_in"
              type="number"
              step="0.1"
              min="0"
              className="rounded border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Neck (in)
            <input
              name="neck_in"
              type="number"
              step="0.1"
              min="0"
              className="rounded border border-zinc-300 px-3 py-2"
            />
          </label>
        </div>

        <button
          type="submit"
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white"
        >
          Add
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {measurements && measurements.length > 0 ? (
          measurements.map((measurement) => (
            <li
              key={measurement.id}
              className="flex flex-col gap-1 rounded border border-zinc-200 px-3 py-2 text-sm"
            >
              <div className="flex justify-between">
                <span className="font-medium">
                  {measurement.weight_lbs} lbs
                </span>
                <span className="text-zinc-500">
                  {new Date(measurement.created_at).toLocaleDateString()}
                </span>
              </div>
              {(measurement.body_fat_pct !== null ||
                measurement.waist_in !== null ||
                measurement.hips_in !== null ||
                measurement.neck_in !== null) && (
                <div className="flex flex-wrap gap-x-3 text-xs text-zinc-500">
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
            </li>
          ))
        ) : (
          <p className="text-sm text-zinc-500">No measurements yet.</p>
        )}
      </ul>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Latest Hevy workout</h2>
        {latestWorkout ? (
          <div className="flex flex-col gap-3 rounded border border-zinc-200 px-3 py-2 text-sm">
            <div className="flex justify-between">
              <span className="font-medium">{latestWorkout.title}</span>
              <span className="text-zinc-500">
                {latestWorkout.start_time
                  ? new Date(latestWorkout.start_time).toLocaleDateString()
                  : "—"}
              </span>
            </div>
            {latestWorkout.exercises.map((exercise) => (
              <div key={exercise.id} className="flex flex-col gap-1">
                <span className="font-medium">{exercise.title}</span>
                <ul className="flex flex-col gap-0.5 pl-3 text-xs text-zinc-500">
                  {exercise.sets.map((set) => (
                    <li key={set.set_index}>{formatSet(set)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No workouts synced yet.</p>
        )}
      </section>

      <DietTodayCard initialTotals={initialTotals} />
    </main>
  );
}
