/** Centre-local dates. Centres run on Tashkent time regardless of server location. */
export const CENTER_TZ = "Asia/Tashkent";

/** "YYYY-MM-DD" for today in the centre's timezone. */
export function todayISO(tz = CENTER_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** "YYYY-MM-01" for the current month in the centre's timezone. */
export function monthStartISO(tz = CENTER_TZ): string {
  return `${todayISO(tz).slice(0, 7)}-01`;
}

/** Request-time window for the attendance list: last 7 days up to tomorrow. */
export function attendanceWindow() {
  const now = Date.now();
  return {
    now,
    from: new Date(now - 7 * 86400000).toISOString(),
    to: new Date(now + 36 * 3600000).toISOString(),
  };
}
