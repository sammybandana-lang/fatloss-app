import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTodaysDietTotals } from "@/lib/loseit/queries";

const mockGetUser = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}));

describe("getTodaysDietTotals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when there is no signed-in user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const result = await getTodaysDietTotals();

    expect(result).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns null when the user has no entries logged today", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockEq.mockResolvedValue({ data: [], error: null });

    const result = await getTodaysDietTotals();

    expect(result).toBeNull();
  });

  it("sums calories/fat/protein/carbs across today's entries, treating null macros as 0", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockEq.mockResolvedValue({
      data: [
        { calories: 280, fat_g: 3, protein_g: 53, carbs_g: 0 },
        { calories: 150, fat_g: null, protein_g: 3, carbs_g: 30 },
        { calories: 100, fat_g: 5, protein_g: null, carbs_g: 10 },
      ],
      error: null,
    });

    const result = await getTodaysDietTotals();

    expect(result).toEqual({
      calories: 530,
      fat_g: 8,
      protein_g: 56,
      carbs_g: 40,
      entry_count: 3,
    });
    expect(mockFrom).toHaveBeenCalledWith("diet_entries");
    expect(mockEq).toHaveBeenCalledWith(
      "entry_date",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it("throws when the query fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockEq.mockResolvedValue({ data: null, error: { message: "db down" } });

    await expect(getTodaysDietTotals()).rejects.toThrow("db down");
  });
});
