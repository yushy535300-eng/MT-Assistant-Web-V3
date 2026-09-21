import type { SaWinReportResult } from "./sa-live";

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
