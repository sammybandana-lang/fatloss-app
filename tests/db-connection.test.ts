import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { config } from "dotenv";
import { newTestUser, deleteTestUsers, type TestUser } from "./helpers/test-users";

/**
 * Azure migration, Phase 3 — the direct database connection.
 * See lib/db/index.ts and ARCHITECTURE.md §10.6 #2.
 *
 * WHY THIS FILE IS THE IMPORTANT ONE
 *
 * Until now, "can one user see another's data?" was answered by Supabase:
 * it attached the logged-in user to every request, and the database
 * checked it. Connecting directly moves half of that job into our code —
 * we now have to say who is asking, on every single request.
 *
 * That creates a failure mode this project has never had. Connections are
 * pooled and handed back out. If one person's identity survived their
 * request, whoever borrowed that connection next would inherit it, and
 * would read someone else's health data with no error raised and nothing
 * written to a log.
 *
 * Every test below runs against a pool of exactly ONE connection, so
 * reuse is guaranteed rather than occasional. A leak that would surface
 * once in a thousand requests in production surfaces on the second query
 * here.
 *
 * TWO ACCOUNTS, CREATED ONCE
 *
 * Signing up a fresh pair per test exhausts Supabase's hourly signup
 * limit and takes the whole suite down with it. These two are created
 * once and reused, so every assertion below is written in terms of
 * "contains this specific value" / "does not contain that one" rather
 * than exact row counts — which is the more honest assertion anyway,
 * since a leak is about a specific value arriving somewhere it should
 * not.
 *
 * Skipped entirely without DATABASE_URL, so the suite still runs for
 * anyone who has not set up direct access yet.
 */

config({ path: ".env.local" });

// Must be set before lib/db creates its pool on first use. One
// connection means the second query provably reuses the first's.
process.env.DATABASE_POOL_MAX = "1";

const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const { getPool, withUser, closePool } = await import("@/lib/db");

/** Reads the identity currently visible on a connection borrowed raw. */
async function identityOnAFreshConnection(): Promise<string> {
  const client = await getPool().connect();
  try {
    const { rows } = await client.query(
      "select coalesce(current_setting('app.current_user_id', true), '') as who",
    );
    return rows[0].who as string;
  } finally {
    client.release();
  }
}

/** Every weight this user can see, as plain numbers. */
async function weightsVisibleTo(user: TestUser): Promise<number[]> {
  return withUser(user.id, async (tx) => {
    const { rows } = await tx.query("select weight_lbs from measurements");
    return rows.map((r) => Number(r.weight_lbs));
  });
}

describe.skipIf(!HAS_DB_URL)("direct database connection", () => {
  let userA: TestUser;
  let userB: TestUser;

  beforeAll(async () => {
    userA = await newTestUser();
    userB = await newTestUser();
  }, 30000);

  afterAll(async () => {
    await closePool();
    await deleteTestUsers();
  });

  describe("the login the app uses is subject to the walls", () => {
    it("sees no rows at all when nobody is set", async () => {
      await withUser(userA.id, (tx) =>
        tx.query("insert into measurements (weight_lbs) values ($1)", [166.4]),
      );

      // A connection with no identity. If this role could bypass
      // row-level security, this would return every row in the table —
      // including data belonging to real accounts. It must return none.
      const client = await getPool().connect();
      try {
        const { rows } = await client.query("select id from measurements");
        expect(rows).toHaveLength(0);
      } finally {
        client.release();
      }
    }, 30000);
  });

  describe("identity is scoped to one request", () => {
    it("does not survive the transaction that set it", async () => {
      const inside = await withUser(userA.id, async (tx) => {
        const { rows } = await tx.query(
          "select app_current_user_id()::text as who",
        );
        return rows[0].who as string;
      });
      expect(inside).toBe(userA.id);

      // Same single connection, moments later. PostgreSQL discards a
      // transaction-scoped setting when the transaction ends, so this is
      // guaranteed by the database rather than by our cleanup code.
      expect(await identityOnAFreshConnection()).toBe("");
    }, 30000);

    it("is discarded even when the request fails partway", async () => {
      await expect(
        withUser(userA.id, async (tx) => {
          await tx.query("insert into measurements (weight_lbs) values ($1)", [
            150.1,
          ]);
          throw new Error("simulated failure mid-request");
        }),
      ).rejects.toThrow("simulated failure mid-request");

      // The rollback path must clean up as thoroughly as the happy path;
      // an error is exactly when cleanup tends to get skipped.
      expect(await identityOnAFreshConnection()).toBe("");

      // The rollback must also have undone the insert.
      expect(await weightsVisibleTo(userA)).not.toContain(150.1);
    }, 30000);
  });

  describe("one user's data never reaches another", () => {
    it("does not leak across a reused connection", async () => {
      const secret = 191.6;

      await withUser(userA.id, (tx) =>
        tx.query("insert into measurements (weight_lbs) values ($1)", [secret]),
      );

      // Pool size is 1, so B is provably running on the very connection
      // A just used — the exact circumstance a leak needs.
      expect(await weightsVisibleTo(userB)).not.toContain(secret);
    }, 30000);

    it("still lets each user read their own data back", async () => {
      const aValue = 201.2;
      const bValue = 133.8;

      await withUser(userA.id, (tx) =>
        tx.query("insert into measurements (weight_lbs) values ($1)", [aValue]),
      );
      await withUser(userB.id, (tx) =>
        tx.query("insert into measurements (weight_lbs) values ($1)", [bValue]),
      );

      // The mirror image of the test above. A wall that blocks everyone
      // equally would pass every leak test and be useless, so prove the
      // legitimate path works on the same reused connection.
      const aSaw = await weightsVisibleTo(userA);
      expect(aSaw).toContain(aValue);
      expect(aSaw).not.toContain(bValue);
    }, 30000);

    it("stamps new rows with the caller, not with whoever came before", async () => {
      await withUser(userA.id, (tx) =>
        tx.query("insert into measurements (weight_lbs) values ($1)", [177.7]),
      );

      // No user_id supplied — the column default calls the same identity
      // function. On a connection previously used by A, it must resolve
      // to B.
      const owner = await withUser(userB.id, async (tx) => {
        const { rows } = await tx.query(
          "insert into measurements (weight_lbs) values ($1) returning user_id",
          [188.8],
        );
        return rows[0].user_id as string;
      });

      expect(owner).toBe(userB.id);
    }, 30000);
  });

  describe("guards", () => {
    it("refuses a userId that is not a UUID", async () => {
      await expect(
        withUser("'; drop table measurements; --", async () => "unreachable"),
      ).rejects.toThrow(/not a valid UUID/);
    });
  });
});
