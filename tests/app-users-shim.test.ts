import { describe, it, expect, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { newTestUser, deleteTestUsers } from "./helpers/test-users";

/**
 * Azure migration, Phase 2 step 1 — see ARCHITECTURE.md §10.4 and
 * supabase/migrations/20260814120000_phase2_app_users_and_shim.sql.
 *
 * These tests cover the two pieces that will replace Supabase's auth.users
 * table and auth.uid() function once this app runs on Azure. They are
 * written now, against Supabase, on purpose: the whole point of doing the
 * swap here first is that the replacement gets proven somewhere the old
 * mechanism is still around to check it against.
 *
 * The load-bearing test is the last one. A shim that returns the wrong id
 * would break loudly and get noticed. A shim that returns NULL where it
 * should return an id fails CLOSED — the user sees nothing — which is
 * safe. The dangerous direction is the reverse: a caller with no identity
 * that somehow matches rows. That is what "unidentified sees zero rows"
 * exists to rule out.
 */

config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

afterAll(deleteTestUsers);

describe("app_users — the replacement for auth.users", () => {
  it("gets a row automatically when a user signs up", async () => {
    const user = await newTestUser();

    const { data, error } = await user.client
      .from("app_users")
      .select("id, email")
      .eq("id", user.id)
      .single();

    expect(error).toBeNull();
    // Same uuid as Supabase issued — this is what lets step 3 repoint the
    // foreign keys without rewriting a single user_id value.
    expect(data?.id).toBe(user.id);
  }, 30000);

  it("a user cannot see another user's app_users row", async () => {
    const userA = await newTestUser();
    const userB = await newTestUser();

    // B asks for A's row by its exact id — the strongest form of the
    // question, since there is no guessing involved.
    const { data } = await userB.client
      .from("app_users")
      .select("id, email")
      .eq("id", userA.id);

    expect(data ?? []).toHaveLength(0);
  }, 30000);

  it("is not writable by a logged-in user", async () => {
    const user = await newTestUser();

    // No insert policy exists for any role, so this must fail no matter
    // what grants are in place now or added later.
    const { error } = await user.client
      .from("app_users")
      .insert({ id: crypto.randomUUID(), email: "attacker@example.com" });

    expect(error).not.toBeNull();
  }, 30000);
});

describe("app_current_user_id() — the replacement for auth.uid()", () => {
  it("returns the calling user's own id", async () => {
    const user = await newTestUser();

    const { data, error } = await user.client.rpc("app_current_user_id");

    expect(error).toBeNull();
    expect(data).toBe(user.id);
  }, 30000);

  it("agrees with auth.uid() for two different users", async () => {
    const userA = await newTestUser();
    const userB = await newTestUser();

    const { data: aSaw } = await userA.client.rpc("app_current_user_id");
    const { data: bSaw } = await userB.client.rpc("app_current_user_id");

    // The shim must be per-caller, not a single value the database
    // resolves once and reuses — the failure mode that would silently
    // merge two people's data on Azure's pooled connections.
    expect(aSaw).toBe(userA.id);
    expect(bSaw).toBe(userB.id);
    expect(aSaw).not.toBe(bSaw);
  }, 30000);

  it("returns null for a caller with no identity — fails closed", async () => {
    // A signed-out client. On Azure this is the equivalent of a pooled
    // connection that nobody has stamped with a user yet.
    const anon = createClient(URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await anon.rpc("app_current_user_id");

    expect(error).toBeNull();
    // NULL never equals a user_id, so every policy written against this
    // function yields zero rows for an unidentified caller. If this ever
    // returns a real id, every wall in this database is open.
    expect(data).toBeNull();
  }, 30000);

  it("an unidentified caller sees no data through it", async () => {
    const user = await newTestUser();
    const secret = 163.7;

    const { error: insErr } = await user.client
      .from("measurements")
      .insert({ weight_lbs: secret });
    expect(insErr).toBeNull();

    const anon = createClient(URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data } = await anon.from("measurements").select("weight_lbs");

    // The end-to-end version of the test above: null identity, zero rows.
    expect(data ?? []).toHaveLength(0);
  }, 30000);
});
