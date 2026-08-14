import { describe, it, expect, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { newTestUser, deleteTestUsers } from "./helpers/test-users";

// Load Supabase credentials from .env.local (no secrets hardcoded)
config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Every user this file signs up is removed again, so runs don't pile up
// accounts and exhaust Supabase's hourly signup limit.
afterAll(deleteTestUsers);

describe("tenant isolation (RLS)", () => {
  it("a user cannot see another user's measurements", async () => {
    const userA = await newTestUser();
    const userB = await newTestUser();

    const secret = 187.3; // distinctive value we can hunt for

    // User A saves a weight
    const { error: insErr } = await userA.client
      .from("measurements")
      .insert({ weight_lbs: secret });
    expect(insErr).toBeNull();

    // Sanity: User A CAN see their own row
    const { data: aRows } = await userA.client.from("measurements").select("weight_lbs");
    expect(aRows?.some((r) => Number(r.weight_lbs) === secret)).toBe(true);

    // THE WALL: User B must NOT see User A's row
    const { data: bRows } = await userB.client.from("measurements").select("weight_lbs");
    expect(bRows?.some((r) => Number(r.weight_lbs) === secret)).toBe(false);

    // No row cleanup needed: deleting the user in afterAll takes their
    // measurements with it (on delete cascade).
  }, 30000); // 30s timeout — real network calls
});

/**
 * `daily_assessments` holds the trainer-facing text about someone's body
 * and eating, so the same wall applies. It is written only by the
 * background job (service role), and granted SELECT only to logged-in
 * users — hence the service-role client here to seed a row.
 */
describe.skipIf(!SERVICE_KEY)("tenant isolation (RLS) — daily_assessments", () => {
  it("a user cannot see another user's daily assessment", async () => {
    const userA = await newTestUser();
    const userB = await newTestUser();

    const service = createClient(URL, SERVICE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const secret = "SENTINEL-do-not-leak-this-assessment";

    const { error: insErr } = await service.from("daily_assessments").insert({
      user_id: userA.id,
      assessment_date: "2026-08-07",
      workout_present: false,
      short_assessment: secret,
      grade: "C",
      model: "test-model",
    });
    expect(insErr).toBeNull();

    // Sanity: User A CAN see their own assessment
    const { data: aRows } = await userA.client
      .from("daily_assessments")
      .select("short_assessment");
    expect(aRows?.some((r) => r.short_assessment === secret)).toBe(true);

    // THE WALL: User B must NOT see User A's assessment
    const { data: bRows } = await userB.client
      .from("daily_assessments")
      .select("short_assessment");
    expect(bRows?.some((r) => r.short_assessment === secret)).toBe(false);

    // A logged-in user must not be able to write this table at all — only
    // the background job may, and it uses the service role.
    const { error: writeErr } = await userA.client.from("daily_assessments").insert({
      user_id: userA.id,
      assessment_date: "2026-08-06",
      workout_present: false,
      short_assessment: "should not be allowed",
      grade: "D",
      model: "test-model",
    });
    expect(writeErr).not.toBeNull();

    // No row cleanup here either — service_role is deliberately granted no
    // DELETE (see 20260810153000_grant_service_role_for_daily_job.sql) and
    // an authenticated user only has SELECT. Deleting the user in afterAll
    // removes the row via on delete cascade.
  }, 30000);
});