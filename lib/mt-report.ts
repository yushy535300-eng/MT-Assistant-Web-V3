/**
 * MT「今日」跟官方投注報表同一套日期字串。
 * 官方 HAR（ofalive99 bet/history）送的是台北曆日 + 字面 `.000Z`：
 *   begin_at: "2026-09-22T00:00:00.000Z"
 *   end_at:   "2026-09-22T23:59:59.000Z"
 *   cur: 1
 * 不是把 +08:00 轉成真實 UTC（那會變成 21T16:00Z → 22T15:59Z，對不到官方總計）。
 *
 * 跨日（台北 00:00）官方報表會開新的一天並歸 0；浮窗必須跟同一條日界。
 */
export function mtTodayReportDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function mtTodayReportRange(now = new Date()) {
  const day = mtTodayReportDay(now);
  return {
    begin_at: `${day}T00:00:00.000Z`,
    end_at: `${day}T23:59:59.000Z`,
  };
}
