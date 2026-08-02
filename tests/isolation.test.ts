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

describe("tenant isolation (RLS)", () => {
  it("a user cannot see another user's measurements", async () => {
    const userA = await newUser();
    const userB = await newUser();

    const secret = 187.3; // distinctive value we can hunt for

    // User A saves a weight
    const { error: insErr } = await userA.from("measurements").insert({ weight_lbs: secret });
    expect(insErr).toBeNull();

    // Sanity: User A CAN see their own row
    const { data: aRows } = await userA.from("measurements").select("weight_lbs");
    expect(aRows?.some((r) => Number(r.weight_lbs) === secret)).toBe(true);

    // THE WALL: User B must NOT see User A's row
    const { data: bRows } = await userB.from("measurements").select("weight_lbs");
    expect(bRows?.some((r) => Number(r.weight_lbs) === secret)).toBe(false);

    // Cleanup: User A removes their own row
    await userA.from("measurements").delete().eq("weight_lbs", secret);
  }, 30000); // 30s timeout — real network calls
});