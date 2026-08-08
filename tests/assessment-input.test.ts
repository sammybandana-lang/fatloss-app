import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { assembleAssessmentInput } from "@/lib/ai/assessment-input";
import { kgToLbs } from "@/lib/units";

// Load Supabase credentials from .env.local (no secrets hardcoded)
config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// Fixed "now" so "yesterday" is deterministically 2026-08-07, regardless of
// when the test actually runs. Only `Date` is faked (not setTimeout/etc.)
// so the real network calls to Supabase below aren't affected.
const FIXED_NOW = new Date("2026-08-08T12:00:00Z");
const YESTERDAY = "2026-08-07";
const TWO_DAYS_AGO = "2026-08-06";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// Make a brand-new signed-in user, return their own client
async function newUser(): Promise<SupabaseClient> {
  const client = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { error } = await client.auth.signUp({ email, password: "test-password-123456" });
  if (error) throw new Error(`signUp failed: ${error.message}`);
  return client;
}

async function insertDietEntry(user: SupabaseClient, entryDate: string, calories: number, proteinG: number) {
  const { error } = await user.from("diet_entries").insert({
    entry_date: entryDate,
    name: "Test food",
    calories,
    protein_g: proteinG,
  });
  if (error) throw new Error(`diet insert failed: ${error.message}`);
}

async function insertWorkout(
  user: SupabaseClient,
  startTime: string,
  weightKg: number,
  reps: number,
  title = "Test workout",
) {
  const { data: workout, error: workoutErr } = await user
    .from("workouts")
    .insert({
      hevy_id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      start_time: startTime,
    })
    .select("id")
    .single();
  if (workoutErr) throw new Error(`workout insert failed: ${workoutErr.message}`);

  const { data: exercise, error: exerciseErr } = await user
    .from("workout_exercises")
    .insert({ workout_id: workout.id, title: "Test exercise", order_index: 0 })
    .select("id")
    .single();
  if (exerciseErr) throw new Error(`exercise insert failed: ${exerciseErr.message}`);

  const { error: setErr } = await user
    .from("workout_sets")
    .insert({ exercise_id: exercise.id, set_index: 0, weight_kg: weightKg, reps });
  if (setErr) throw new Error(`set insert failed: ${setErr.message}`);
}

/** Seeds goals + a measurement, plus diet/workout rows for both yesterday and two days ago. */
async function seedTwoDaysOfData(user: SupabaseClient) {
  const { error: goalsErr } = await user
    .from("goals")
    .upsert({ weight_lbs_start: 210, weight_lbs_goal: 195 }, { onConflict: "user_id" });
  if (goalsErr) throw new Error(`goals upsert failed: ${goalsErr.message}`);

  const { error: measurementErr } = await user
    .from("measurements")
    .insert({ weight_lbs: 205 });
  if (measurementErr) throw new Error(`measurement insert failed: ${measurementErr.message}`);

  // Yesterday: the day the assessment should read from.
  await insertDietEntry(user, YESTERDAY, 500, 40);
  await insertWorkout(user, `${YESTERDAY}T18:00:00Z`, 100, 5, "Yesterday Workout");

  // Two days ago: must NOT be picked up — proves the query isn't summing
  // across days or falling back to "most recent logged day".
  await insertDietEntry(user, TWO_DAYS_AGO, 9999, 999);
  await insertWorkout(user, `${TWO_DAYS_AGO}T18:00:00Z`, 9999, 99, "Two Days Ago Workout");
}

describe("assembleAssessmentInput", () => {
  it("returns nulls for diet/workout and the correct yesterday_date when nothing was logged", async () => {
    const user = await newUser();

    const input = await assembleAssessmentInput(user);

    expect(input).toEqual({
      weight_lbs_start: null,
      weight_lbs_goal: null,
      weight_lbs_current: null,
      yesterday_calories: null,
      yesterday_protein_g: null,
      yesterday_workout_present: 0,
      yesterday_workout_volume_lbs: null,
      yesterday_date: YESTERDAY,
      yesterday_workout_names: [],
    });
  }, 30000);

  it("reads yesterday's diet and workout only, not two days ago's", async () => {
    const user = await newUser();
    await seedTwoDaysOfData(user);

    const input = await assembleAssessmentInput(user);

    expect(input).toEqual({
      weight_lbs_start: 210,
      weight_lbs_goal: 195,
      weight_lbs_current: 205,
      yesterday_calories: 500,
      yesterday_protein_g: 40,
      yesterday_workout_present: 1,
      yesterday_workout_volume_lbs: kgToLbs(100 * 5),
      yesterday_date: YESTERDAY,
      yesterday_workout_names: ["Yesterday Workout"],
    });
  }, 30000);

  it("returns all of yesterday's workout names, not two-days-ago's", async () => {
    const user = await newUser();

    await insertWorkout(user, `${YESTERDAY}T12:00:00Z`, 50, 10, "Morning Run");
    await insertWorkout(user, `${YESTERDAY}T20:00:00Z`, 80, 8, "Evening Lift");
    await insertWorkout(user, `${TWO_DAYS_AGO}T18:00:00Z`, 9999, 99, "Two Days Ago Workout");

    const input = await assembleAssessmentInput(user);

    expect(input.yesterday_workout_names).toEqual(["Morning Run", "Evening Lift"]);
  }, 30000);

  it("classifies an 8pm ET workout that crosses midnight UTC as yesterday's, not today's", async () => {
    const user = await newUser();

    // 2026-08-08T00:26:57Z is 8:26pm ET on Aug 7 (EDT, UTC-4 in August). A
    // naive UTC "yesterday" range would exclude this, since in UTC it's
    // already Aug 8 — the exact prod bug this slice fixes.
    await insertWorkout(user, "2026-08-08T00:26:57Z", 80, 10);

    const input = await assembleAssessmentInput(user);

    expect(input.yesterday_date).toBe(YESTERDAY);
    expect(input.yesterday_workout_present).toBe(1);
    expect(input.yesterday_workout_volume_lbs).toBe(kgToLbs(80 * 10));
  }, 30000);

  it("a user's data is not visible when assembling input as another user", async () => {
    const userA = await newUser();
    const userB = await newUser();

    await seedTwoDaysOfData(userA);

    // THE WALL: User B's assembled input must reflect User B's (empty)
    // data, not User A's, even though both queries ran within the same
    // test run around the same time.
    const inputB = await assembleAssessmentInput(userB);

    expect(inputB).toEqual({
      weight_lbs_start: null,
      weight_lbs_goal: null,
      weight_lbs_current: null,
      yesterday_calories: null,
      yesterday_protein_g: null,
      yesterday_workout_present: 0,
      yesterday_workout_volume_lbs: null,
      yesterday_date: YESTERDAY,
      yesterday_workout_names: [],
    });
  }, 30000);
});
