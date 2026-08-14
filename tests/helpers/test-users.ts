import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

/**
 * Creates throwaway Supabase users for the isolation tests, and deletes
 * them afterwards.
 *
 * Proving one user cannot see another's data needs two genuinely separate
 * accounts, so these are real signups against the real project — there is
 * no honest way to fake it. What was missing was the other half: nothing
 * ever removed them, so 522 accumulated before this helper existed. That
 * matters for more than tidiness, because Supabase rate-limits signups per
 * hour and the suite was exhausting it after a couple of runs.
 *
 * Cleanup needs the service-role key (only an admin can delete a user). If
 * it isn't set, the tests that use these users are skipped anyway, so
 * there is nothing to clean up.
 */

config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface TestUser {
  client: SupabaseClient;
  id: string;
}

/** Ids minted by this module, awaiting cleanup. One list per test file. */
const created: string[] = [];

/** A brand-new signed-in user, with their own RLS-scoped client. */
export async function newTestUser(): Promise<TestUser> {
  const client = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Date.now() is faked in some suites, so the random suffix — not the
  // timestamp — is what actually keeps these unique.
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

  const { data, error } = await client.auth.signUp({
    email,
    password: "test-password-123456",
  });
  if (error) throw new Error(`signUp failed: ${error.message}`);
  if (!data.user) throw new Error("signUp returned no user");

  created.push(data.user.id);
  return { client, id: data.user.id };
}

/**
 * Deletes every user this file created. Call from `afterAll`.
 *
 * Their rows go too, via `on delete cascade` on each table's user_id.
 * `measurements` only gained that in
 * 20260810160000_measurements_cascade_on_user_delete.sql — before it, any
 * user with a logged weight could not be deleted at all.
 *
 * Failures are warned about rather than thrown: a cleanup problem should
 * not turn a passing test suite red, but it must not be silent either.
 */
export async function deleteTestUsers(): Promise<void> {
  const ids = created.splice(0);
  if (!SERVICE_KEY || ids.length === 0) {
    return;
  }

  const admin = createClient(URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      console.warn(`Test cleanup: could not delete user ${id}: ${error.message}`);
    }
  }
}
