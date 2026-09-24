import { describe, expect, it, beforeEach } from "vitest";
import {
  applySaReportSettlement,
  reportDay,
  reportHistoryStorageKey,
  reportPnlStorageKey,
  saResultMatchesPending,
  selectPlatformTodayPnl,
  loadPlatformReport,
  resetPlatformReport,
} from "../lib/platform-report";
import { platformTodayPnl } from "../lib/dg-report";

describe("platform-keyed 今日輸贏 isolation", () => {
  const now = Date.parse("2026-09-21T08:00:00Z");
  const day = reportDay(now);

  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as any).window = {
      localStorage: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
      },
    };
  });

  it("uses distinct storage keys per platform", () => {
    expect(reportPnlStorageKey("MT")).toBe("report.pnl.MT");
    expect(reportPnlStorageKey("DG")).toBe("report.pnl.DG");
    expect(reportPnlStorageKey("SA")).toBe("report.pnl.SA");
    expect(reportHistoryStorageKey("SA")).toBe("report.history.SA");
    expect(reportPnlStorageKey("SA")).not.toBe(reportPnlStorageKey("MT"));
    expect(reportPnlStorageKey("SA")).not.toBe(reportPnlStorageKey("DG"));
  });

  it("never falls SA/MV back to MT in legacy platformTodayPnl", () => {
    expect(platformTodayPnl("MT", 999, null, now)).toBe(999);
    expect(platformTodayPnl("DG", 999, { value: 12, day, updatedAt: now }, now)).toBe(12);
    expect(platformTodayPnl("DG", 999, null, now)).toBeNull();
    expect(platformTodayPnl("SA", 999, { value: 12, day, updatedAt: now }, now)).toBeNull();
    expect(platformTodayPnl("MV", 999, null, now)).toBeNull();
  });

  it("selectPlatformTodayPnl keeps MT / DG / SA buckets separate", () => {
    const buckets = {
      mt: 100,
      dg: { value: -50, day, updatedAt: now },
      sa: { value: 25, day, updatedAt: now },
    };
    expect(selectPlatformTodayPnl("MT", buckets, now)).toBe(100);
    expect(selectPlatformTodayPnl("DG", buckets, now)).toBe(-50);
    expect(selectPlatformTodayPnl("SA", buckets, now)).toBe(25);
    expect(selectPlatformTodayPnl("MV", buckets, now)).toBeNull();
    // SA empty day shows 0 (never bleed MT)
    expect(
      selectPlatformTodayPnl(
        "SA",
        { mt: 100, dg: null, sa: null },
        now,
      ),
    ).toBe(0);
  });

  it("SA GameResult settlements write only the SA storage keys", () => {
    applySaReportSettlement(
      { pnl: null, history: [] },
      {
        side: "莊",
        result: "莊",
        amount: 1000,
        pnl: 950,
        at: now,
        tableId: "D01",
        resultKey: "1:莊",
        gameId: 1,
      },
      now,
    );
    expect(loadPlatformReport("SA", now).pnl?.value).toBe(950);
    expect(loadPlatformReport("MT", now).pnl).toBeNull();
    expect(loadPlatformReport("DG", now).pnl).toBeNull();
    expect(loadPlatformReport("MT", now).history).toEqual([]);
    expect(loadPlatformReport("DG", now).history).toEqual([]);
  });

  it("resetPlatformReport clears only the requested platform", () => {
    applySaReportSettlement(
      { pnl: null, history: [] },
      { side: "閒", result: "莊", amount: 500, pnl: -500, at: now },
      now,
    );
    resetPlatformReport("SA", now);
    expect(loadPlatformReport("SA", now).pnl?.value).toBe(0);
    expect(loadPlatformReport("SA", now).history).toEqual([]);
  });

  it("matches SA pending bets across D01 / SAhost / roomId aliases", () => {
    const result = {
      tableId: "D01",
      apiId: "SA901",
      tableBadge: "D01",
      roomId: "901",
      hostId: 901,
    };
    expect(saResultMatchesPending(result, "D01")).toBe(true);
    expect(saResultMatchesPending(result, "SA901")).toBe(true);
    expect(saResultMatchesPending(result, "901")).toBe(true);
    expect(saResultMatchesPending(result, "D02")).toBe(false);
  });

  it("reportDay matches SA 站內「今天」UTC+8 calendar window", () => {
    // Screenshot: 2026/09/24 00:00:00–23:59:59 UTC+8 → day 2026-09-24
    const morningUtc8 = Date.parse("2026-09-23T16:00:00.000Z"); // 00:00 Taipei
    const eveningUtc8 = Date.parse("2026-09-24T15:59:59.000Z"); // 23:59 Taipei
    expect(reportDay(morningUtc8)).toBe("2026-09-24");
    expect(reportDay(eveningUtc8)).toBe("2026-09-24");
    // Before midnight Taipei still previous day
    expect(reportDay(Date.parse("2026-09-23T15:59:59.000Z"))).toBe("2026-09-23");
  });
});
