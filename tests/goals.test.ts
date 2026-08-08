import { describe, it, expect } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

// Load Supabase credentials from .env.local (no secrets hardcoded)
config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

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

describe("goals table", () => {
  it("upsert then readback returns the saved values", async () => {
    const user = await newUser();

    const { error: upsertErr } = await user.from("goals").upsert(
      {
        weight_lbs_start: 210,
        weight_lbs_goal: 195,
        daily_calories_goal: 2100,
        daily_protein_g_goal: 165,
        weekly_workout_goal: 4,
      },
      { onConflict: "user_id" },
    );
    expect(upsertErr).toBeNull();

    const { data, error: selectErr } = await user
      .from("goals")
      .select(
        "weight_lbs_start, weight_lbs_goal, daily_calories_goal, daily_protein_g_goal, weekly_workout_goal",
      )
      .maybeSingle();

    expect(selectErr).toBeNull();
    expect(data).toEqual({
      weight_lbs_start: 210,
      weight_lbs_goal: 195,
      daily_calories_goal: 2100,
      daily_protein_g_goal: 165,
      weekly_workout_goal: 4,
    });
  }, 30000);

  it("a second upsert overwrites the row instead of inserting a new one", async () => {
    const user = await newUser();

    await user.from("goals").upsert(
      { weight_lbs_start: 210, weight_lbs_goal: 195 },
      { onConflict: "user_id" },
    );
    await user.from("goals").upsert(
      { weight_lbs_start: 200, weight_lbs_goal: 180 },
      { onConflict: "user_id" },
    );

    const { data, error } = await user
      .from("goals")
      .select("weight_lbs_start, weight_lbs_goal");

    expect(error).toBeNull();
    // Exactly one row — proves upsert overwrote rather than stacking a
    // second insert on the same user_id.
    expect(data).toHaveLength(1);
    expect(data?.[0]).toEqual({ weight_lbs_start: 200, weight_lbs_goal: 180 });
  }, 30000);

  it("a user cannot see another user's goals", async () => {
    const userA = await newUser();
    const userB = await newUser();

    const secretCalorieTarget = 1837; // distinctive value we can hunt for

    const { error: insErr } = await userA.from("goals").upsert(
      { daily_calories_goal: secretCalorieTarget },
      { onConflict: "user_id" },
    );
    expect(insErr).toBeNull();

    // Sanity: User A CAN see their own row
    const { data: aRows } = await userA.from("goals").select("daily_calories_goal");
    expect(aRows?.some((r) => r.daily_calories_goal === secretCalorieTarget)).toBe(true);

    // THE WALL: User B must NOT see User A's row
    const { data: bRows } = await userB.from("goals").select("daily_calories_goal");
    expect(bRows?.some((r) => r.daily_calories_goal === secretCalorieTarget)).toBe(false);
  }, 30000);
});
