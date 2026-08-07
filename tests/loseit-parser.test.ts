import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parseLoseItCsv } from "../lib/loseit/parser";

function readFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

const HEADER =
  "Date,Name,Icon,Type,Quantity,Units,Calories,Deleted,Fat (g),Protein (g),Carbohydrates (g),Saturated Fat (g),Sugars (g),Fiber (g),Cholesterol (mg),Sodium (mg)";

describe("parseLoseItCsv", () => {
  it("parses a valid multi-row CSV into diet entry rows", () => {
    const csv = [
      HEADER,
      "08/01/2026,Chicken Breast,🍗,Meal 1 8am,6,oz,280,0,3,53,0,1,0,0,150,90",
      "08/02/2026,Brown Rice,🍚,Meal 2 12pm,1,cup,215,0,1.8,5,45,0.4,0.7,3.5,0,10",
    ].join("\n");

    const rows = parseLoseItCsv(csv);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      entry_date: "2026-08-01",
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
    });
    expect(rows[1]).toEqual({
      entry_date: "2026-08-02",
      name: "Brown Rice",
      food_type: "Meal 2 12pm",
      quantity: 1,
      units: "cup",
      calories: 215,
      fat_g: 1.8,
      protein_g: 5,
      carbs_g: 45,
      saturated_fat_g: 0.4,
      sugars_g: 0.7,
      fiber_g: 3.5,
      cholesterol_mg: 0,
      sodium_mg: 10,
    });
  });

  it('treats "n/a" (any case) as null for numeric fields', () => {
    const csv = [
      HEADER,
      "08/03/2026,Water,💧,Meal 3 3pm,16,fl oz,0,0,n/a,N/A,n/A,n/a,n/a,n/a,n/a,n/a",
    ].join("\n");

    const rows = parseLoseItCsv(csv);

    expect(rows).toHaveLength(1);
    expect(rows[0].calories).toBe(0);
    expect(rows[0].fat_g).toBeNull();
    expect(rows[0].protein_g).toBeNull();
    expect(rows[0].carbs_g).toBeNull();
    expect(rows[0].saturated_fat_g).toBeNull();
    expect(rows[0].sugars_g).toBeNull();
    expect(rows[0].fiber_g).toBeNull();
    expect(rows[0].cholesterol_mg).toBeNull();
    expect(rows[0].sodium_mg).toBeNull();
  });

  it("skips rows where Deleted is not 0", () => {
    const csv = [
      HEADER,
      "08/04/2026,Kept Item,🥗,Meal 1 8am,1,serving,100,0,1,1,1,1,1,1,1,1",
      "08/04/2026,Deleted Item,🗑️,Meal 1 8am,1,serving,999,1,9,9,9,9,9,9,9,9",
    ].join("\n");

    const rows = parseLoseItCsv(csv);

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Kept Item");
  });

  it("handles a quoted name containing a comma", () => {
    const csv = [
      HEADER,
      '08/05/2026,"Bread, 21 Whole Grains And Seeds",🍞,Meal 1 8am,2,slice,140,0,2,6,24,0.5,3,4,0,200',
    ].join("\n");

    const rows = parseLoseItCsv(csv);

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Bread, 21 Whole Grains And Seeds");
  });

  it("rejects a CSV whose headers don't match the expected LoseIt columns", () => {
    const wrongHeader =
      "Date,Name,Type,Quantity,Units,Calories,Deleted,Fat (g),Protein (g),Carbohydrates (g),Saturated Fat (g),Sugars (g),Fiber (g),Cholesterol (mg),Sodium (mg)"; // missing "Icon"
    const csv = [
      wrongHeader,
      "08/06/2026,Mystery Food,Meal 1 8am,1,serving,100,0,1,1,1,1,1,1,1,1",
    ].join("\n");

    expect(() => parseLoseItCsv(csv)).toThrow();
  });

  it("skips exercise rows entirely, even though they're short several columns (real LoseIt export)", () => {
    const csv = readFixture("loseit-sample-quiet-day.csv");

    const rows = parseLoseItCsv(csv);

    expect(rows).toHaveLength(0);
  });

  it("parses a real full-day LoseIt export: exercise row dropped, quoted commas preserved", () => {
    const csv = readFixture("loseit-sample-full-day.csv");

    const rows = parseLoseItCsv(csv);

    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.name)).toEqual([
      "Ragi Millet Dosa Batter",
      "Chicken Breast BASIC",
      "Lite And Fit Greek Blueberry Yogart",
      "Kind Bar",
      "Bread, 21 Whole Grains And Seeds",
      "Egg Whites, Uncooked, Large Egg",
    ]);
    expect(rows.every((row) => row.entry_date === "2026-08-01")).toBe(true);

    const kindBar = rows[3];
    expect(kindBar.calories).toBe(240);
    expect(kindBar.fat_g).toBe(17);
    expect(kindBar.protein_g).toBe(12);
    expect(kindBar.carbs_g).toBe(18);

    const chickenBreast = rows[1];
    expect(chickenBreast.calories).toBe(249);
    expect(chickenBreast.saturated_fat_g).toBeNull();
  });
});
