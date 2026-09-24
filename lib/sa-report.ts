import type { SaWinReportResult } from "./sa-live";
import type { PlatformDailyPnl } from "./platform-report";
import { reportDay } from "./platform-report";

/**
 * Map SA live GameResult (SSE `result`) into settlePending body fields.
 * Used only for the SA 輸贏報表 path — never MT/DG report packets.
 */
export function saWinReportToSettleBody(
  ev: SaWinReportResult,
  pendingTableId: string,
) {
  const tableKeys = [ev.apiId, ev.tableId, ev.tableBadge, ev.roomId]
    .map((x) => String(x ?? "").trim())
    .filter((x) => x && x !== "undefined");
  return {
    table_id: pendingTableId,
    table_keys: tableKeys,
    shoe: ev.shoe,
    round: ev.round,
    game_sn: ev.gameId,
    result_key: ev.resultKey,
    poker: ev.poker,
  };
}

export function saWinReportTableMatches(
  ev: Pick<SaWinReportResult, "tableId" | "apiId" | "tableBadge" | "roomId">,
  pendingTableId: string,
) {
  const want = String(pendingTableId ?? "").trim();
  if (!want) return false;
  return [ev.apiId, ev.tableId, ev.tableBadge, ev.roomId]
    .map((x) => String(x ?? "").trim())
    .includes(want);
}

/** Apply official SA BetRecord day total into the SA bucket (display source). */
export function applySaOfficialPnl(
  prev: { pnl: PlatformDailyPnl | null; history: any[] },
  value: number,
  now = Date.now(),
): { pnl: PlatformDailyPnl; history: any[] } {
  const day = reportDay(now);
  const historyBase =
    prev.pnl?.day === day && Array.isArray(prev.history) ? prev.history : [];
  return {
    pnl: {
      value: Math.round(value),
      day,
      updatedAt: now,
    },
    history: historyBase,
  };
}
