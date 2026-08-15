import { describe, it, expect, afterAll } from "vitest";
import { config } from "dotenv";
import { getLatestDayDietTotals } from "../lib/loseit/queries";
import { newTestUser, deleteTestUsers, type TestUser } from "./helpers/test-users";
import { withUser, closePool } from "../lib/db";

config({ path: ".env.local" });

// These tests hit the real (dev) Supabase project directly, the same way
// tests/isolation.test.ts does. A fully-mocked Supabase client would just
// hand back whatever data we told it to — it can't catch a real query bug
// like ordering/filtering on the wrong column. Exercising the query against
// a real DB is the point.

// Every user signed up here is deleted again afterwards, so repeated runs
// don't accumulate accounts and exhaust Supabase's hourly signup limit.
afterAll(async () => {
  await closePool();
  await deleteTestUsers();
});

// Make a brand-new signed-in user. Rows are still seeded through their
// Supabase client — that path is unchanged and is not what these tests
// are checking. The query under test now runs on the direct connection,
// so both halves need to agree about who the user is.
async function newUser(): Promise<TestUser> {
  return newTestUser();
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

    const result = await withUser(user.id, (tx) => getLatestDayDietTotals(tx));

    expect(result).toBeNull();
  }, 30000);

  it("returns totals for only the most recent entry_date, ignoring an older day", async () => {
    const user = await newUser();

    const { error } = await user.client.from("diet_entries").insert([
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

    const result = await withUser(user.id, (tx) => getLatestDayDietTotals(tx));

    expect(result).toEqual({
      entryDate: "2026-08-06",
      calories: 300,
      fat_g: 5,
      protein_g: 7,
      carbs_g: 9,
    });

    await user.client.from("diet_entries").delete().in("entry_date", ["2026-08-05", "2026-08-06"]);
  }, 30000);

  it("returns totals for today's date when that's the only day with entries", async () => {
    const user = await newUser();
    const today = new Date().toISOString().slice(0, 10);

    const { error } = await user.client.from("diet_entries").insert([
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

    const result = await withUser(user.id, (tx) => getLatestDayDietTotals(tx));

    expect(result).toEqual({
      entryDate: today,
      calories: 150,
      fat_g: 2,
      protein_g: 3,
      carbs_g: 4,
    });

    await user.client.from("diet_entries").delete().eq("entry_date", today);
  }, 30000);
});
