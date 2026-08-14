import { createClient } from "@/lib/supabase/server";

/**
 * Who is making this request.
 *
 * Azure migration, Phase 3. See ARCHITECTURE.md §10.2.
 *
 * THE BRIDGE THIS FILE REPRESENTS
 *
 * Two jobs used to be done by one library call. Supabase both worked out
 * who the caller was AND attached that identity to every query. Phase 3
 * splits them:
 *
 *   * WHO you are still comes from Supabase Auth, reading the verified
 *     session cookie. That does not move until Phase 5.
 *   * WHAT you can reach is now decided by lib/db's withUser(), which
 *     stamps the identity onto the database transaction.
 *
 * This file is the join between the two, and exists so that "read the
 * verified session" is written once rather than at each of the twelve
 * call sites that need it.
 *
 * The identity is always read from the session cookie the server
 * verified — never from a form field, a URL, or anything else the browser
 * chose. That is CLAUDE.md's rule that the backend works out the user
 * "from their verified login only", unchanged by the move; only the
 * consumer of the answer is different.
 */

/** The signed-in user's id, or null if nobody is signed in. */
export async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

/**
 * The signed-in user's id, or throws.
 *
 * For Server Actions, where there is no page to redirect and a request
 * from nobody is a bug or an attack rather than a browsing accident.
 * Pages should call getCurrentUserId() and redirect to /login instead.
 */
export async function requireCurrentUserId(): Promise<string> {
  const userId = await getCurrentUserId();

  if (!userId) {
    throw new Error("Not signed in.");
  }

  return userId;
}
