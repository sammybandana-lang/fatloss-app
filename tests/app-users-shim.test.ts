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
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

/**
 * Phase 2 step 2 — see
 * supabase/migrations/20260814150000_phase2_policies_onto_shim.sql.
 *
 * Six tables stamp new rows with their owner using a column DEFAULT, which
 * that migration switches from auth.uid() to app_current_user_id(). The
 * app relies on this: nothing in app/ passes user_id explicitly on insert.
 *
 * A broken default is the quietest possible failure here. It would not
 * throw — the insert policy would simply reject the row, or worse, stamp
 * it with the wrong id. These assert the value that actually landed,
 * rather than just that the insert returned no error.
 */
describe("owner stamping — the column defaults on the shim", () => {
  it("stamps a new measurement with the caller's own id", async () => {
    const user = await newTestUser();

    // No user_id supplied — exactly how app/ inserts.
    const { data, error } = await user.client
      .from("measurements")
      .insert({ weight_lbs: 171.2 })
      .select("user_id")
      .single();

    expect(error).toBeNull();
    expect(data?.user_id).toBe(user.id);
  }, 30000);

  it("stamps a new goals row, where user_id is also the primary key", async () => {
    const user = await newTestUser();

    // goals is the one table where a wrong default breaks the primary key
    // rather than just the ownership stamp.
    const { data, error } = await user.client
      .from("goals")
      .insert({ weight_lbs_goal: 180 })
      .select("user_id")
      .single();

    expect(error).toBeNull();
    expect(data?.user_id).toBe(user.id);
  }, 30000);
});

/**
 * Phase 2 step 3 — see
 * supabase/migrations/20260814170000_phase2_repoint_fks_to_app_users.sql.
 *
 * That migration moves every table's owner reference from auth.users to
 * app_users, which lengthens the delete chain by one hop:
 *
 *     auth.users -> app_users -> measurements
 *
 * If the middle link were ever created without "on delete cascade",
 * deleting an account would stop removing that person's health data. It
 * would not error — the rows would simply stay behind, owned by an
 * account that no longer exists. A real "delete my account" request
 * would silently leave the data in place.
 *
 * Needs the service-role key to delete a user and then to look for rows
 * that RLS would otherwise hide.
 */
describe.skipIf(!SERVICE_KEY)("deleting an account still removes the data", () => {
  it("cascades through app_users to the data tables", async () => {
    const user = await newTestUser();
    const admin = createClient(URL, SERVICE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: insErr } = await user.client
      .from("measurements")
      .insert({ weight_lbs: 149.9 });
    expect(insErr).toBeNull();

    // Confirm the row is really there before deleting, so a false pass
    // cannot come from having inserted nothing in the first place.
    const { data: before } = await admin
      .from("measurements")
      .select("id")
      .eq("user_id", user.id);
    expect((before ?? []).length).toBeGreaterThan(0);

    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    expect(delErr).toBeNull();

    // Both hops of the chain: the account row, and the data behind it.
    const { data: appUserRows } = await admin
      .from("app_users")
      .select("id")
      .eq("id", user.id);
    expect(appUserRows ?? []).toHaveLength(0);

    const { data: after } = await admin
      .from("measurements")
      .select("id")
      .eq("user_id", user.id);
    expect(after ?? []).toHaveLength(0);

    // Note: afterAll will try to delete this user again and print a
    // harmless "could not delete user" warning. Expected — the helper
    // warns rather than throws for exactly this kind of case.
  }, 30000);
});
