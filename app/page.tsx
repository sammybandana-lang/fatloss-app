import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkoutsForDate, type LatestWorkoutExercise } from "@/lib/hevy/queries";
import { getDietTotalsForDate } from "@/lib/loseit/queries";
import { yesterdayInEasternTime, formatDateShort } from "@/lib/dates";
import { kgToLbs } from "@/lib/units";
import { getGoals } from "@/app/goals/actions";
import { logout } from "./login/actions";
import { SyncButton } from "./SyncButton";
import { PageShell } from "@/app/_components/design/PageShell";
import { Card } from "@/app/_components/design/Card";
import { Eyebrow } from "@/app/_components/design/Eyebrow";
import { StatBlock } from "@/app/_components/design/StatBlock";

/** Renders a nullable goal field as its bare value, or a dash when unset. */
function formatGoalValue(value: number | null, unit = ""): string {
  return value === null ? "—" : `${value}${unit}`;
}

/** Renders a nullable measurement field with its unit, or a dash when unset. */
function formatMetric(value: number | null, unit: string): string {
  return value === null ? "—" : `${value}${unit}`;
}

/** e.g. "Bench Press · 10×225 · 8×235" — a bodyweight set with no weight shows just the reps. */
function formatExerciseLine(exercise: LatestWorkoutExercise): string {
  const setStrings = exercise.sets.map((set) => {
    if (set.weight_kg === null) {
      return set.reps === null ? "—" : `${set.reps}`;
    }
    const weightLbs = kgToLbs(set.weight_kg);
    return set.reps === null ? `${weightLbs}` : `${set.reps}×${weightLbs}`;
  });
  return [exercise.title, ...setStrings].join(" · ");
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

  const { data: latestMeasurements, error } = await supabase
    .from("measurements")
    .select("id, weight_lbs, body_fat_pct, waist_in, hips_in, neck_in, created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  const latestMeasurement = latestMeasurements?.[0] ?? null;

  const yesterday = yesterdayInEasternTime();
  const yesterdayLabel = formatDateShort(yesterday);

  const [goals, dietTotals, workouts] = await Promise.all([
    getGoals(),
    getDietTotalsForDate(supabase, yesterday),
    getWorkoutsForDate(supabase, yesterday),
  ]);

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
              <Link href="/measurements" className="text-secondary hover:text-primary">
                Measurements
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

          <div className="flex justify-end gap-3">
            <SyncButton />
            <Link
              href="/measurements"
              className="self-start rounded-inner border-[0.5px] border-hairline px-4 py-2 text-sm font-medium text-primary hover:bg-surface"
            >
              Enter Measurements
            </Link>
          </div>
        </div>

        <section>
          <Eyebrow>Goals</Eyebrow>
          {goals ? (
            <p className="text-sm text-primary">
              Starting Weight: {formatGoalValue(goals.weight_lbs_start)} · Goal Weight:{" "}
              {formatGoalValue(goals.weight_lbs_goal)} · Daily Calorie Target:{" "}
              {formatGoalValue(goals.daily_calories_goal)} · Daily Protein Target:{" "}
              {formatGoalValue(goals.daily_protein_g_goal, "g")}
            </p>
          ) : (
            <p className="text-sm text-secondary">
              No goals set —{" "}
              <Link href="/goals" className="text-secondary underline hover:text-primary">
                set goals
              </Link>
            </p>
          )}
        </section>

        <section>
          <Eyebrow>Current Stats</Eyebrow>
          {latestMeasurement ? (
            <Card>
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-2xl font-normal text-primary">
                    {latestMeasurement.weight_lbs} lbs
                  </span>
                  <span className="text-xs text-secondary">
                    {new Date(latestMeasurement.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="font-mono flex flex-wrap gap-x-4 text-xs text-muted">
                  <span>Body fat: {formatMetric(latestMeasurement.body_fat_pct, "%")}</span>
                  <span>Waist: {formatMetric(latestMeasurement.waist_in, " in")}</span>
                  <span>Hips: {formatMetric(latestMeasurement.hips_in, " in")}</span>
                  <span>Neck: {formatMetric(latestMeasurement.neck_in, " in")}</span>
                </div>
              </div>
            </Card>
          ) : (
            <p className="text-sm text-secondary">
              No measurements yet.{" "}
              <Link href="/measurements" className="underline hover:text-primary">
                Add one
              </Link>
            </p>
          )}
        </section>

        <section>
          <Eyebrow>{`Nutrition for ${yesterdayLabel} (LoseIt)`}</Eyebrow>
          {dietTotals ? (
            <Card>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                <StatBlock label="Calories" value={String(Math.round(dietTotals.calories))} />
                <StatBlock label="Fat" value={String(Math.round(dietTotals.fat_g))} unit="g" />
                <StatBlock
                  label="Protein"
                  value={String(Math.round(dietTotals.protein_g))}
                  unit="g"
                />
                <StatBlock label="Carbs" value={String(Math.round(dietTotals.carbs_g))} unit="g" />
              </div>
            </Card>
          ) : (
            <p className="text-sm text-secondary">No nutrition data for yesterday.</p>
          )}
        </section>

        <section>
          <Eyebrow>{`Workouts for ${yesterdayLabel} (Hevy)`}</Eyebrow>
          {workouts.length > 0 ? (
            <div className="flex flex-col gap-6">
              {workouts.map((workout) => (
                <div key={workout.id} className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-medium text-primary">{workout.title}</span>
                    <span className="text-xs text-secondary">
                      {workout.start_time
                        ? new Date(workout.start_time).toLocaleDateString()
                        : "—"}
                    </span>
                  </div>
                  <div className="font-mono flex flex-col gap-1 text-[13px] text-secondary">
                    {workout.exercises.map((exercise) => (
                      <p key={exercise.id}>{formatExerciseLine(exercise)}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-secondary">No workouts logged yesterday.</p>
          )}
        </section>
      </div>
    </PageShell>
  );
}
