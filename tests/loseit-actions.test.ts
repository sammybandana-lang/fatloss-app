import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { importLoseItToday } from "@/app/loseit-actions";
import { getMostRecentLoseItCsv } from "@/lib/gmail/client";
import { parseLoseItCsv, type DietEntryRow } from "@/lib/loseit/parser";

vi.mock("@/lib/gmail/client", () => ({
  getMostRecentLoseItCsv: vi.fn(),
}));

vi.mock("@/lib/loseit/parser", () => ({
  parseLoseItCsv: vi.fn(),
}));

const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));

/**
 * The database is mocked, not connected to.
 *
 * These tests cover the import's own logic — what it does with a missing
 * email, a parser failure, and the inserted/skipped counts — none of
 * which needs a real database. `withUser` is stubbed to hand the code a
 * transaction whose only job is to record the SQL it was given.
 *
 * That `withUser` genuinely scopes a query to one user is proven for
 * real, against the real database, in tests/db-connection.test.ts. Doing
 * it again here would make this file slow and would not check anything
 * new.
 */
const mockQuery = vi.fn();

vi.mock("@/lib/db", () => ({
  withUser: vi.fn(
    async <T,>(_userId: string, fn: (tx: { query: typeof mockQuery }) => Promise<T>) =>
      fn({ query: mockQuery }),
  ),
}));

const AUTHED_USER = { id: "user-1" };

/** The rows the import actually sent, decoded from the query's parameters. */
function rowsSentToTheDatabase(): DietEntryRow[] {
  const [, params] = mockQuery.mock.calls[0] as [string, [string, string]];
  return JSON.parse(params[1]);
}

/** The user id the import stamped every row with. */
function userIdSentToTheDatabase(): string {
  const [, params] = mockQuery.mock.calls[0] as [string, [string, string]];
  return params[0];
}

function sampleRow(overrides: Partial<DietEntryRow> = {}): DietEntryRow {
  return {
    entry_date: "2026-08-06",
    name: "Chicken Breast",
    food_type: "Meal 1 8am",
    quantity: 6,
    units: "oz",
    calories: 280,
    fat_g: 3,
    protein_g: 53,
    carbs_g: 0,
    saturated_fat_g: 1,
    sugars_g: 0,
    fiber_g: 0,
    cholesterol_mg: 150,
    sodium_mg: 90,
    ...overrides,
  };
}

describe("importLoseItToday", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ data: { user: AUTHED_USER } });
    // Every inserted row comes back with its id; none by default.
    mockQuery.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns Not authenticated when there is no signed-in user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const result = await importLoseItToday();

    expect(result).toEqual({ ok: false, error: "Not authenticated" });
    expect(getMostRecentLoseItCsv).not.toHaveBeenCalled();
  });

  it("returns no_email when Gmail has no matching email", async () => {
    vi.mocked(getMostRecentLoseItCsv).mockResolvedValue(null);

    const result = await importLoseItToday();

    expect(result).toEqual({ ok: true, no_email: true });
    expect(parseLoseItCsv).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects the whole batch when the parser throws (e.g. bad header)", async () => {
    vi.mocked(getMostRecentLoseItCsv).mockResolvedValue("bogus,csv");
    vi.mocked(parseLoseItCsv).mockImplementation(() => {
      throw new Error("This doesn't look like a LoseIt daily report.");
    });

    const result = await importLoseItToday();

    expect(result).toEqual({
      ok: false,
      error: "This doesn't look like a LoseIt daily report.",
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("inserts every row when none are duplicates", async () => {
    const parsedRows = [sampleRow(), sampleRow({ name: "Brown Rice" })];
    vi.mocked(getMostRecentLoseItCsv).mockResolvedValue("csv-text");
    vi.mocked(parseLoseItCsv).mockReturnValue(parsedRows);
    mockQuery.mockResolvedValue({ rows: [{ id: "row-1" }, { id: "row-2" }] });

    const result = await importLoseItToday();

    expect(result).toEqual({ ok: true, inserted: 2, skipped_dupes: 0 });

    // One statement for the whole batch, not one per row.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(rowsSentToTheDatabase()).toEqual(parsedRows);
    expect(userIdSentToTheDatabase()).toBe(AUTHED_USER.id);

    // The duplicate rule is what makes a re-run harmless, so assert the
    // statement actually carries it rather than trusting the comment.
    const [sql] = mockQuery.mock.calls[0] as [string, unknown];
    expect(sql).toContain(
      "on conflict (user_id, entry_date, name, food_type, calories) do nothing",
    );
  });

  it("reports skipped_dupes for rows that already exist, summing to the parsed count", async () => {
    const parsedRows = [
      sampleRow({ name: "Chicken Breast" }),
      sampleRow({ name: "Brown Rice" }),
      sampleRow({ name: "Water" }),
    ];
    vi.mocked(getMostRecentLoseItCsv).mockResolvedValue("csv-text");
    vi.mocked(parseLoseItCsv).mockReturnValue(parsedRows);
    // Only one of the three rows was newly inserted; the rest hit the
    // (user_id, entry_date, name, food_type, calories) conflict, and
    // `do nothing` means the statement never returns them.
    mockQuery.mockResolvedValue({ rows: [{ id: "row-1" }] });

    const result = await importLoseItToday();

    expect(result).toEqual({ ok: true, inserted: 1, skipped_dupes: 2 });
    if (result.ok && !("no_email" in result)) {
      expect(result.inserted + result.skipped_dupes).toBe(parsedRows.length);
    }
  });

  it("returns the DB error message when the insert fails", async () => {
    vi.mocked(getMostRecentLoseItCsv).mockResolvedValue("csv-text");
    vi.mocked(parseLoseItCsv).mockReturnValue([sampleRow()]);
    // node-postgres throws where the Supabase client returned an error
    // field. The import must still convert it to a result value rather
    // than letting it escape to the caller.
    mockQuery.mockRejectedValue(new Error("connection to database failed"));

    const result = await importLoseItToday();

    expect(result).toEqual({ ok: false, error: "connection to database failed" });
  });

  it("processes real LoseIt CSV end-to-end", async () => {
    // Unlike every other test in this file, use the real parser against the
    // real fixture bytes — this is the point of the test: proving the whole
    // pipeline (CSV -> parser -> insert) handles real LoseIt quirks like
    // quoted commas in names and a mix of food/exercise rows.
    const actualParser = await vi.importActual<typeof import("@/lib/loseit/parser")>(
      "@/lib/loseit/parser",
    );
    vi.mocked(parseLoseItCsv).mockImplementation(actualParser.parseLoseItCsv);

    const fixtureCsv = fs.readFileSync(
      path.join(__dirname, "fixtures", "loseit-sample-full-day.csv"),
      "utf-8",
    );
    vi.mocked(getMostRecentLoseItCsv).mockResolvedValue(fixtureCsv);

    mockGetUser.mockResolvedValue({ data: { user: { id: "test-user-123" } } });
    mockQuery.mockResolvedValue({
      rows: Array.from({ length: 6 }, (_, i) => ({ id: `row-${i}` })),
    });

    const result = await importLoseItToday();

    expect(result).toEqual({ ok: true, inserted: 6, skipped_dupes: 0 });
    expect(mockQuery).toHaveBeenCalledTimes(1);

    const insertedRows = rowsSentToTheDatabase();
    expect(insertedRows).toHaveLength(6);
    // The owner is now one bound parameter applied to every row, rather
    // than a user_id stamped onto each row object — same guarantee, one
    // place instead of N.
    expect(userIdSentToTheDatabase()).toBe("test-user-123");
    expect(insertedRows[0].name).toBe("Ragi Millet Dosa Batter");
    expect(insertedRows[5].name).toBe("Egg Whites, Uncooked, Large Egg");
    expect(insertedRows[3].protein_g).toBe(12);
    expect(insertedRows[3].carbs_g).toBe(18);
  });
});
