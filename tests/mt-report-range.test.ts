import { describe, expect, it } from "vitest";
import { mtTodayReportRange } from "../lib/mt-report";

describe("MT today report range", () => {
  it("matches official ofalive99 bet/history date strings (Taipei day + literal Z)", () => {
    // 2026-09-22 06:10 Taipei = 2026-09-21 22:10 UTC
    const now = new Date("2026-09-21T22:10:00.000Z");
    const range = mtTodayReportRange(now);
    expect(range.begin_at).toBe("2026-09-22T00:00:00.000Z");
    expect(range.end_at).toBe("2026-09-22T23:59:59.000Z");
  });

  it("keeps calendar day across Taipei midnight boundary", () => {
    // Still Sep 21 Taipei (2026-09-21 16:30 UTC = Sep 22 00:30 Taipei? No:
    // 16:00 UTC = 00:00 Taipei next day. So 15:30 UTC = Sep 21 23:30 Taipei.
    const still21 = new Date("2026-09-21T15:30:00.000Z");
    expect(mtTodayReportRange(still21)).toEqual({
      begin_at: "2026-09-21T00:00:00.000Z",
      end_at: "2026-09-21T23:59:59.000Z",
    });
    const day22 = new Date("2026-09-21T16:30:00.000Z");
    expect(mtTodayReportRange(day22)).toEqual({
      begin_at: "2026-09-22T00:00:00.000Z",
      end_at: "2026-09-22T23:59:59.000Z",
    });
  });
});
