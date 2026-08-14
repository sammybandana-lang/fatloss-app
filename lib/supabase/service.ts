import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The master key client. THIS BYPASSES ROW-LEVEL SECURITY COMPLETELY.
 *
 * Only the daily background job (`lib/jobs/daily-assessment.ts`) may use
 * this. Never use it to serve a user request — a logged-in user's request
 * must go through `@/lib/supabase/server`, which respects RLS and derives
 * the user from their verified session.
 *
 * Because RLS is off for this client, every query made with it must filter
 * on `user_id` explicitly. There is no database safety net here; the
 * filters in the calling code are the only thing keeping users apart.
 *
 * Note on `server-only`: this file deliberately does NOT import that
 * package. It resolves to a module that throws unless the bundler sets the
 * `react-server` condition, which trigger.dev's bundler does not — the
 * import would crash the job at startup. The `window` guard below gives the
 * same protection (fail loudly if this is ever reached from a browser
 * bundle) in both Next.js and the job runtime, with no extra dependency.
 */
export function createServiceClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "createServiceClient() was called in a browser context. The service " +
        "role key must never reach the client.",
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!serviceRoleKey) {
    throw new Error("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
