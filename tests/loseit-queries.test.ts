import { describe, it, expect } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { getLatestDayDietTotals } from "../lib/loseit/queries";

// Load Supabase credentials from .env.local (no secrets hardcoded).
config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// These tests hit the real (dev) Supabase project directly, the same way
// tests/isolation.test.ts does. A fully-mocked Supabase client would just
// hand back whatever data we told it to — it can't catch a real query bug
// like ordering/filtering on the wrong column. Exercising the query against
// a real DB is the point.

// Make a brand-new signed-in user, return their own client.
async function newUser(): Promise<SupabaseClient> {
  const client = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { error } = await client.auth.signUp({ email, password: "test-password-123456" });
  if (error) throw new Error(`signUp failed: ${error.message}`);
  return client;
}

function dietEntry(overrides: {
  entry_date: string;
  name: string;
  calories: number;
  fat_g: number;
  protein_g: number;
  carbs_g: number;
}) {
  return { food_type: "Meal 1", ...overrides };
}

describe("getLatestDayDietTotals (against a real test DB)", () => {
  it("returns null when the user has no diet entries at all", async () => {
    const user = await newUser();

    const result = await getLatestDayDietTotals(user);

    expect(result).toBeNull();
  }, 30000);

  it("returns totals for only the most recent entry_date, ignoring an older day", async () => {
    const user = await newUser();

    const { error } = await user.from("diet_entries").insert([
      dietEntry({
        entry_date: "2026-08-05",
        name: "Yesterday Food",
        calories: 500,
        fat_g: 10,
        protein_g: 20,
        carbs_g: 30,
      }),
      dietEntry({
        entry_date: "2026-08-06",
        name: "Latest Food A",
        calories: 100,
        fat_g: 1,
        protein_g: 2,
        carbs_g: 3,
      }),
      dietEntry({
        entry_date: "2026-08-06",
        name: "Latest Food B",
        calories: 200,
        fat_g: 4,
        protein_g: 5,
        carbs_g: 6,
      }),
    ]);
    expect(error).toBeNull();

    const result = await getLatestDayDietTotals(user);

    expect(result).toEqual({
      entryDate: "2026-08-06",
      calories: 300,
      fat_g: 5,
      protein_g: 7,
      carbs_g: 9,
    });

    await user.from("diet_entries").delete().in("entry_date", ["2026-08-05", "2026-08-06"]);
  }, 30000);

  it("returns totals for today's date when that's the only day with entries", async () => {
    const user = await newUser();
    const today = new Date().toISOString().slice(0, 10);

    const { error } = await user.from("diet_entries").insert([
      dietEntry({
        entry_date: today,
        name: "Today Food",
        calories: 150,
        fat_g: 2,
        protein_g: 3,
        carbs_g: 4,
      }),
    ]);
    expect(error).toBeNull();

    const result = await getLatestDayDietTotals(user);

    expect(result).toEqual({
      entryDate: today,
      calories: 150,
      fat_g: 2,
      protein_g: 3,
      carbs_g: 4,
    });

    await user.from("diet_entries").delete().eq("entry_date", today);
  }, 30000);
});
