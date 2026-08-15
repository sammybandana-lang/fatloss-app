import { Pool, type PoolClient } from "pg";

/**
 * Direct PostgreSQL access — the replacement for the Supabase client.
 * Azure migration, Phase 3. See ARCHITECTURE.md §10.2 and §10.4.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE
 *
 * Supabase attached the logged-in user to every request automatically.
 * Nothing does that for us here, so the app has to tell the database who
 * is asking — and it has to be impossible to forget.
 *
 * `withUser()` is therefore the ONLY exported way to run a query against
 * user data. There is no "get me a connection" helper for feature code to
 * reach for, because a connection with nobody set on it is precisely the
 * dangerous object.
 *
 * WHY IT MUST BE PER-TRANSACTION
 *
 * Connections are pooled and reused between requests. If one person's
 * identity outlived their request, the next request to borrow that
 * connection would inherit it — one user reading another's health data,
 * with no error and nothing in a log. That is the single worst failure
 * this project can have (CLAUDE.md).
 *
 * The defence is that the identity is set with `is_local => true`, which
 * scopes it to the surrounding transaction. When the transaction ends —
 * committed, rolled back, or abandoned because the process crashed — the
 * setting is discarded by PostgreSQL itself. It is not cleaned up by our
 * code, so our code cannot forget to.
 *
 * `set_config(...)` rather than `SET LOCAL ...` because SET does not
 * accept bind parameters; its argument would have to be glued into the
 * SQL text. set_config is a normal function, so the user id travels as a
 * parameter like any other value and can never be read as SQL.
 *
 * ON `server-only`
 *
 * Deliberately not imported. That package resolves to a module which
 * throws unless the bundler sets the `react-server` condition, which the
 * background job's bundler does not — the import would crash the job at
 * startup. The `typeof window` guard below gives the same protection —
 * fail loudly if this is ever reached from a browser bundle — in both
 * runtimes, with no extra dependency.
 */

let pool: Pool | null = null;
let jobPool: Pool | null = null;

/**
 * The shared connection pool, created on first use.
 *
 * Exported for tests, which need to inspect a raw connection to prove
 * nothing leaks between users. Feature code should never call this — use
 * `withUser()`.
 */
export function getPool(): Pool {
  if (typeof window !== "undefined") {
    throw new Error(
      "lib/db was loaded in a browser context. Database credentials must never reach the client.",
    );
  }

  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }

  pool = new Pool({
    // SSL parameters are stripped from the URL and set below instead, so
    // there is exactly one place that decides how this connection is
    // encrypted. See sslConfig().
    connectionString: withoutSslParams(connectionString),
    ssl: sslConfig(),
    // Small on purpose. Serverless platforms scale out processes, and
    // every process holds its own pool — a generous per-process pool is
    // how a database runs out of connections under load. See
    // ARCHITECTURE.md §10.6 #3.
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  return pool;
}

/**
 * Removes every SSL-related query parameter from the connection URL.
 *
 * Encryption is decided by `sslConfig()` and nowhere else. Leaving
 * `sslmode=` in the URL as well would mean two settings competing to
 * control the same thing, and whichever won would depend on the version
 * of `pg` installed — which is how this went wrong the first time.
 */
function withoutSslParams(url: string): string {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (k.includes("ssl") || k.includes("libpq")) {
      parsed.searchParams.delete(key);
    }
  }
  return parsed.toString();
}

/**
 * How the connection is encrypted.
 *
 * The connection is ALWAYS encrypted. The only question is whether we
 * also verify that the server is who it claims to be, which protects
 * against someone impersonating the database.
 *
 * Verification is ON by default, and turning it off requires setting
 * DATABASE_SSL_NO_VERIFY=true deliberately. That default matters: Azure
 * Database for PostgreSQL presents a certificate that chains to a root
 * Node already trusts, so the destination platform gets full verification
 * simply by nobody setting this variable.
 *
 * Supabase's connection pooler presents a certificate Node does not
 * trust, so reaching it requires the opt-out. That is accepted for the
 * migration bridge only — see .env.example — and the shape of this
 * function means the weaker setting has to be asked for in an environment
 * file where it is visible, rather than being the silent default
 * everywhere.
 */
function sslConfig(): { rejectUnauthorized: boolean } {
  return {
    rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== "true",
  };
}

/** Rejects anything that is not a UUID before it reaches the database. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` inside a transaction stamped with `userId`, so every RLS
 * policy in the database resolves to that user and nothing else.
 *
 * The callback receives the transaction's own client. Do not hold on to
 * it: once this function returns, the identity is gone and any query made
 * on a stale reference would run as nobody.
 *
 * Throws rather than returning an error object — a failure to establish
 * who is asking must stop the request, never quietly continue as nobody.
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  return runStamped(getPool(), userId, fn);
}

/**
 * Opens a transaction, stamps it with `userId`, and runs `fn` inside it.
 *
 * Shared by withUser and withJob so there is exactly one implementation
 * of the rule this whole file exists to enforce. Two copies would be two
 * places for the identity handling to drift apart, and the one that
 * drifted would be the one nobody was looking at.
 */
async function runStamped<T>(
  targetPool: Pool,
  userId: string,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(userId)) {
    // Caught here rather than left to the database's own cast error,
    // which arrives as an opaque "invalid input syntax for type uuid"
    // from somewhere deep inside a policy.
    throw new Error("withUser: userId is not a valid UUID.");
  }

  const client = await targetPool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.current_user_id', $1, true)", [
      userId,
    ]);

    const result = await fn(client);

    await client.query("commit");
    return result;
  } catch (error) {
    // Roll back on any failure. Wrapped because a rollback that itself
    // fails (a dead connection, say) must not replace the real error
    // with a less useful one.
    try {
      await client.query("rollback");
    } catch {
      // The original error below is the one worth surfacing.
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The background job's pool, created on first use.
 *
 * A separate login from the website's, because the job writes
 * `daily_assessments` and the website must not — those rows hold
 * LLM-authored text that gets emailed to a trainer, and "the job is the
 * only writer" is a deliberate property of the design.
 *
 * Falls back to DATABASE_URL when DATABASE_URL_JOB is unset, so a
 * single-connection setup still runs. That fallback is a convenience for
 * local work, not the intended production shape — see .env.example.
 */
function getJobPool(): Pool {
  if (typeof window !== "undefined") {
    throw new Error(
      "lib/db was loaded in a browser context. Database credentials must never reach the client.",
    );
  }

  if (jobPool) return jobPool;

  const connectionString =
    process.env.DATABASE_URL_JOB ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Missing required environment variable: DATABASE_URL_JOB (or DATABASE_URL)",
    );
  }

  jobPool = new Pool({
    connectionString: withoutSslParams(connectionString),
    ssl: sslConfig(),
    // The job runs one user at a time on a schedule; it has no reason to
    // hold more than a couple of connections.
    max: Number(process.env.DATABASE_JOB_POOL_MAX ?? 2),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  return jobPool;
}

/**
 * Runs `fn` as the background job, stamped with the user being processed.
 *
 * The identity is applied exactly as it is for a web request, so the
 * database scopes the job's rows the same way it scopes a person's. This
 * is the difference from the service-role client it replaces, which
 * ignored row-level security and left hand-written `user_id` filters as
 * the only thing keeping users apart.
 *
 * A job that looped over the wrong list of users would now read and write
 * nothing it had not explicitly stamped — the mistake becomes empty
 * results instead of somebody else's health data.
 */
export async function withJob<T>(
  userId: string,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  return runStamped(getJobPool(), userId, fn);
}

/**
 * Closes both pools. For test teardown and graceful shutdown; a
 * long-lived server should not call this.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (jobPool) {
    await jobPool.end();
    jobPool = null;
  }
}
