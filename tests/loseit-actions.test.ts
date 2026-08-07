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
const mockSelect = vi.fn();
const mockUpsert = vi.fn(() => ({ select: mockSelect }));
const mockFrom = vi.fn(() => ({ upsert: mockUpsert }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}));

const AUTHED_USER = { id: "user-1" };

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
    mockSelect.mockResolvedValue({ data: [], error: null });
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
    expect(mockFrom).not.toHaveBeenCalled();
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
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("inserts every row when none are duplicates", async () => {
    const parsedRows = [sampleRow(), sampleRow({ name: "Brown Rice" })];
    vi.mocked(getMostRecentLoseItCsv).mockResolvedValue("csv-text");
    vi.mocked(parseLoseItCsv).mockReturnValue(parsedRows);
    mockSelect.mockResolvedValue({
      data: [{ id: "row-1" }, { id: "row-2" }],
      error: null,
    });

    const result = await importLoseItToday();

    expect(result).toEqual({ ok: true, inserted: 2, skipped_dupes: 0 });
    expect(mockFrom).toHaveBeenCalledWith("diet_entries");
    expect(mockUpsert).toHaveBeenCalledWith(
      [
        { ...parsedRows[0], user_id: AUTHED_USER.id },
        { ...parsedRows[1], user_id: AUTHED_USER.id },
      ],
      {
        onConflict: "user_id,entry_date,name,food_type,calories",
        ignoreDuplicates: true,
      },
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
    // (user_id, entry_date, name, food_type, calories) conflict and were
    // skipped, so `ignoreDuplicates` never returns them.
    mockSelect.mockResolvedValue({ data: [{ id: "row-1" }], error: null });

    const result = await importLoseItToday();

    expect(result).toEqual({ ok: true, inserted: 1, skipped_dupes: 2 });
    if (result.ok && !("no_email" in result)) {
      expect(result.inserted + result.skipped_dupes).toBe(parsedRows.length);
    }
  });

  it("returns the DB error message when the upsert fails", async () => {
    vi.mocked(getMostRecentLoseItCsv).mockResolvedValue("csv-text");
    vi.mocked(parseLoseItCsv).mockReturnValue([sampleRow()]);
    mockSelect.mockResolvedValue({
      data: null,
      error: { message: "connection to database failed" },
    });

    const result = await importLoseItToday();

    expect(result).toEqual({ ok: false, error: "connection to database failed" });
  });

  it("processes real LoseIt CSV end-to-end", async () => {
    // Unlike every other test in this file, use the real parser against the
    // real fixture bytes — this is the point of the test: proving the whole
    // pipeline (CSV -> parser -> upsert) handles real LoseIt quirks like
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
    mockSelect.mockResolvedValue({
      data: Array.from({ length: 6 }, (_, i) => ({ id: `row-${i}` })),
      error: null,
    });

    const result = await importLoseItToday();

    expect(result).toEqual({ ok: true, inserted: 6, skipped_dupes: 0 });
    expect(mockUpsert).toHaveBeenCalledTimes(1);

    type UpsertedRow = DietEntryRow & { user_id: string };
    const [insertedRows] = mockUpsert.mock.calls[0] as unknown as [UpsertedRow[], unknown];
    expect(insertedRows).toHaveLength(6);
    expect(insertedRows.every((row) => row.user_id === "test-user-123")).toBe(true);
    expect(insertedRows[0].name).toBe("Ragi Millet Dosa Batter");
    expect(insertedRows[5].name).toBe("Egg Whites, Uncooked, Large Egg");
    expect(insertedRows[3].protein_g).toBe(12);
    expect(insertedRows[3].carbs_g).toBe(18);
  });
});
