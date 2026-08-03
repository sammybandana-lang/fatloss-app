const KG_TO_LBS = 2.2046226218;

/** Converts kilograms to pounds, rounded to 1 decimal place for display. */
export function kgToLbs(kg: number): number {
  return Math.round(kg * KG_TO_LBS * 10) / 10;
}
