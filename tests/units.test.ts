import { describe, it, expect } from "vitest";
import { kgToLbs } from "../lib/units";

describe("kgToLbs", () => {
  it("converts a known value correctly", () => {
    // 1 kg ≈ 2.2046226218 lbs
    expect(kgToLbs(1)).toBe(2.2);
  });

  it("returns 0 for 0 kg", () => {
    expect(kgToLbs(0)).toBe(0);
  });

  it("always rounds to at most 1 decimal place, even with excessive precision input", () => {
    const result = kgToLbs(83.4127);
    expect(Number.isInteger(result * 10)).toBe(true);
  });
});
