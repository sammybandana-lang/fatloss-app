import { describe, it, expect } from "vitest";
import {
  parseOptionalPositiveNumber,
  parseRequiredPositiveNumber,
} from "../lib/measurements";

describe("parseRequiredPositiveNumber", () => {
  it("accepts a positive number", () => {
    expect(parseRequiredPositiveNumber("150.5", "weight")).toBe(150.5);
  });

  it("rejects zero, negative, non-numeric, and missing values", () => {
    expect(() => parseRequiredPositiveNumber("0", "weight")).toThrow();
    expect(() => parseRequiredPositiveNumber("-5", "weight")).toThrow();
    expect(() => parseRequiredPositiveNumber("abc", "weight")).toThrow();
    expect(() => parseRequiredPositiveNumber(null, "weight")).toThrow();
  });
});

describe("parseOptionalPositiveNumber", () => {
  it("treats blank or missing input as null", () => {
    expect(parseOptionalPositiveNumber("", "body fat %")).toBeNull();
    expect(parseOptionalPositiveNumber(null, "body fat %")).toBeNull();
  });

  it("accepts a positive number", () => {
    expect(parseOptionalPositiveNumber("22.5", "body fat %")).toBe(22.5);
  });

  it("rejects zero and negative values when provided", () => {
    expect(() => parseOptionalPositiveNumber("0", "body fat %")).toThrow();
    expect(() => parseOptionalPositiveNumber("-1", "body fat %")).toThrow();
    expect(() => parseOptionalPositiveNumber("abc", "body fat %")).toThrow();
  });
});
