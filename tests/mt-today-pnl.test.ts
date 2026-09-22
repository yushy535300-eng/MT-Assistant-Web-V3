import { describe, expect, it } from "vitest";

/**
 * Mirror of app/index.tsx readTodayPnl — 今日輸贏 must equal official
 * 投注報表「今日／總計」= total.all.w (never page 小計, never order-level totals).
 */
function readTodayPnl(payload: any) {
  const toNumber = (raw: any) => {
    if (raw == null || raw === "") return null;
    const n = Number(String(raw).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  };
  const fromTotalNode = (node: any) => {
    if (!node || typeof node !== "object") return null;
    return toNumber(node?.total?.all?.w ?? node?.total?.all?.win);
  };
  const unwrap = (node: any) => {
    if (node == null) return null;
    if (typeof node === "string") {
      const t = node.trim();
      if (!(t.startsWith("{") || t.startsWith("[")) || t.length > 200000)
        return null;
      try {
        return JSON.parse(t);
      } catch {
        return null;
      }
    }
    return typeof node === "object" ? node : null;
  };
  const candidates = [
    payload?.msg?.total?.all?.w,
    payload?.data?.total?.all?.w,
    payload?.body?.total?.all?.w,
    payload?.msg?.data?.total?.all?.w,
    payload?.data?.msg?.total?.all?.w,
    payload?.body?.msg?.total?.all?.w,
    payload?.msg?.total?.all?.win,
    payload?.data?.total?.all?.win,
    payload?.body?.total?.all?.win,
  ];
  for (const raw of candidates) {
    const n = toNumber(raw);
    if (n !== null) return n;
  }
  const roots = [
    payload?.msg,
    payload?.data,
    payload?.body,
    payload?.msg?.data,
    payload?.data?.msg,
    payload?.body?.msg,
    payload?.result,
    payload?.response,
    payload,
  ];
  for (const root of roots) {
    const node = unwrap(root);
    if (!node) continue;
    const direct = fromTotalNode(node);
    if (direct !== null) return direct;
    for (const key of ["msg", "data", "body", "result", "response"]) {
      const child = unwrap(node?.[key]);
      const n = fromTotalNode(child);
      if (n !== null) return n;
    }
  }
  return null;
}

describe("MT 今日輸贏 = 投注報表今日總計", () => {
  it("reads total.all.w as 總計, not page 小計", () => {
    const payload = {
      msg: {
        total: {
          page: { w: -54500 },
          all: { w: -70500 },
        },
        orders: [{ total: { all: { w: 1000 } } }],
      },
    };
    expect(readTodayPnl(payload)).toBe(-70500);
  });

  it("does not pick order-level total.all.w via deep walk", () => {
    const payload = {
      msg: {
        orders: [{ total: { all: { w: 42500 } } }],
      },
    };
    expect(readTodayPnl(payload)).toBe(null);
  });

  it("accepts comma-formatted total", () => {
    expect(
      readTodayPnl({ data: { total: { all: { w: "-70,500.00" } } } }),
    ).toBe(-70500);
  });

  it("unwraps stringified msg without taking order totals", () => {
    expect(
      readTodayPnl({
        msg: JSON.stringify({
          total: { page: { w: 100 }, all: { w: -70500 } },
          orders: [{ total: { all: { w: 42500 } } }],
        }),
      }),
    ).toBe(-70500);
  });

  it("skips empty string total fields", () => {
    expect(
      readTodayPnl({
        msg: { total: { all: { w: "" }, page: { w: "" } } },
        data: { total: { all: { w: -70500 } } },
      }),
    ).toBe(-70500);
  });

  it("reads official ofalive99 HAR fixture total.all.w = -70500", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const payload = JSON.parse(
      readFileSync(
        resolve(__dirname, "fixtures/mt-bet-history-today.json"),
        "utf8",
      ),
    );
    expect(payload.msg.total.sub.w).toBe("-54500.00"); // page 小計 — must NOT use
    expect(readTodayPnl(payload)).toBe(-70500);
  });
});
