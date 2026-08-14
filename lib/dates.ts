const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Formats a Date as YYYY-MM-DD in America/New_York. `en-CA` is used
 * specifically because it's the locale that reliably renders ISO-shaped
 * (YYYY-MM-DD) date strings — see MDN's Intl.DateTimeFormat docs.
 */
export function easternDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * ISO date string (YYYY-MM-DD) for "yesterday" in America/New_York.
 * Hevy stores `start_time` as UTC, so an 8pm ET workout lands after
 * midnight UTC the next day — computing "yesterday" in UTC would silently
 * exclude it. Eastern time matches Hevy's own displayed date and the
 * user's lived experience of "yesterday". DST is handled automatically:
 * `Intl.DateTimeFormat` resolves the correct UTC offset for
 * America/New_York at the given instant, the same behavior Postgres's
 * `AT TIME ZONE 'America/New_York'` gives natively (see
 * https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-ZONECONVERT).
 */
export function yesterdayInEasternTime(): string {
  const now = new Date();
  const [y, m, d] = easternDateString(now).split("-").map(Number);
  const easternToday = new Date(Date.UTC(y, m - 1, d));
  const easternYesterday = new Date(easternToday.getTime() - ONE_DAY_MS);
  return easternYesterday.toISOString().slice(0, 10);
}

/**
 * e.g. "2026-08-07" -> "Aug 7". Parsed/formatted in UTC so the date-only
 * string can't shift a day: `new Date("2026-08-07")` is midnight UTC, and
 * formatting that in a negative-offset zone would render "Aug 6".
 */
export function formatDateShort(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** e.g. "2026-08-07" -> "Aug 7, 2026". UTC for the same reason as above. */
export function formatDateLong(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/**
 * A UTC fetch window guaranteed to be a superset of the given Eastern
 * calendar date — a full day of margin on each side, comfortably covering
 * the ET/UTC offset (4-5 hours depending on DST). Rows are filtered down
 * to their precise Eastern date in JS afterward (with `easternDateString`
 * above); PostgREST has no clean way to express
 * `(start_time AT TIME ZONE 'America/New_York')::date =` as a `.filter()`
 * call, and adding a Postgres function for this one case isn't worth the
 * schema-change overhead in this app.
 */
export function wideUtcWindowAroundEasternDate(
  easternDateStr: string,
): { start: string; end: string } {
  const [y, m, d] = easternDateStr.split("-").map(Number);
  const center = new Date(Date.UTC(y, m - 1, d));
  return {
    start: new Date(center.getTime() - ONE_DAY_MS).toISOString(),
    end: new Date(center.getTime() + 2 * ONE_DAY_MS).toISOString(),
  };
}
