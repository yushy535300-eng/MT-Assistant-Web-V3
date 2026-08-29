export type RoadResult = "莊" | "閒" | "和";

export type LiveRoadTable = {
  id: string;
  apiId?: string;
  name: string;
  players: string;
  countdown?: number;
  countdownUpdatedAt?: number;
  roomId?: string;
  tableBadge?: string;
  shoe: string;
  round: number;
  banker: number;
  player: number;
  tie: number;
  results: RoadResult[];
  live?: boolean;
  dealerPhoto?: string;
  lastUpdated?: number;
  lastResultKey?: string;
};

export function winnerToRoadResult(winner: unknown): RoadResult | null {
  const value = typeof winner === "string" ? winner.toUpperCase() : winner;
  if (value === 1 || value === "1" || value === "PLAYER" || winner === "閒") return "閒";
  if (value === 2 || value === "2" || value === "BANKER" || winner === "莊") return "莊";
  if (value === 3 || value === "3" || value === "TIE" || winner === "和") return "和";
  return null;
}

export function parseBeadPlate(raw: unknown): RoadResult[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => winnerToRoadResult(item?.winner ?? item?.result ?? item)).filter(Boolean) as RoadResult[];
  }
  if (typeof raw !== "string") return [];
  const digits = raw.replace(/[^0-9]/g, "");
  const results: RoadResult[] = [];
  for (let index = 0; index + 1 < digits.length; index += 2) {
    const result = winnerToRoadResult(Number(digits.charAt(index + 1)));
    if (result) results.push(result);
  }
  return results;
}

export function getApiTableId(source: any) {
  return String(source?.table_id ?? source?.id ?? source?.room_id ?? "");
}

function stats(results: RoadResult[]) {
  return {
    banker: results.filter((r) => r === "莊").length,
    player: results.filter((r) => r === "閒").length,
    tie: results.filter((r) => r === "和").length,
  };
}

function mergeSnapshot(local: RoadResult[], server: RoadResult[], sameShoe: boolean, round: number) {
  // A shoe change always starts a fresh road.
  if (!sameShoe) return server;

  // The server bead plate is the authoritative snapshot whenever it is available.
  // This prevents results from an older shoe being kept just because the local array is longer.
  if (server.length) {
    return Number.isFinite(round) && round >= 0 ? server.slice(0, round) : server;
  }

  // If the round counter has moved backwards/reset, never keep more local results than the current round.
  if (Number.isFinite(round) && round >= 0 && local.length > round) {
    return local.slice(0, round);
  }

  return local;
}

export function mergeLiveTable<T extends LiveRoadTable>(table: T, source: any): T {
  const trend = source?.trend ?? {};
  const serverResults = parseBeadPlate(trend?.bead_plate2 ?? trend?.bead_plate ?? source?.bead_plate2);
  const sourceShoe = String(trend?.current_shoe ?? source?.shoe ?? table.shoe ?? "—");
  const sourceRound = Number(trend?.current_round ?? source?.round ?? table.round);
  const sameShoe = sourceShoe === String(table.shoe);
  const roundReset = Number.isFinite(sourceRound) && sourceRound < Number(table.round);
  const results = mergeSnapshot(table.results, serverResults, sameShoe && !roundReset, sourceRound);
  const count = stats(results);
  const apiId = getApiTableId(source);
  return {
    ...table,
    apiId: apiId || table.apiId,
    live: true,
    name:
      source?.dealer?.nick_name ??
      source?.dealer?.nickname ??
      source?.dealer?.name ??
      source?.dealer?.username ??
      source?.dealer_name ??
      table.name,
    players: String(source?.totalplayers ?? source?.total_players ?? table.players),
    roomId: String(source?.room_id ?? table.roomId ?? ""),
    tableBadge: String(source?.orderState ?? table.tableBadge ?? ""),
    shoe: sourceShoe,
    round: sourceRound,
    ...count,
    results,
    dealerPhoto:
      source?.dealer_image ??
      source?.dealer_image_url ??
      source?.dealer?.avatar_url ??
      source?.dealer?.image ??
      source?.dealer?.avatar ??
      table.dealerPhoto,
    lastUpdated: Date.now(),
  } as T;
}

export function applyLiveTables<T extends LiveRoadTable>(current: T[], sources: any[]): T[] {
  const baccarat = sources.filter((source) => getApiTableId(source).startsWith("BAG"));
  return current.map((table) => {
    const expected = table.apiId ?? `BAG${table.id}`;
    const source = baccarat.find((item) => getApiTableId(item) === expected || String(item?.table_name ?? "") === table.id);
    return source ? mergeLiveTable(table, source) : table;
  });
}

export function applyLiveShowWin<T extends LiveRoadTable>(current: T[], payload: any): T[] {
  const body = payload?.body ?? payload?.msg ?? payload?.data ?? {};
  const result = winnerToRoadResult(body?.winner);
  const targetApiId = String(body?.table_id ?? "");
  if (!result || !targetApiId.startsWith("BAG")) return current;

  return current.map((table) => {
    if ((table.apiId ?? `BAG${table.id}`) !== targetApiId) return table;

    const nextShoe = String(body?.shoe ?? table.shoe ?? "—");
    const nextRound = Number(body?.round ?? table.round + 1);
    const resultKey = `${nextShoe}|${Number.isFinite(nextRound) ? nextRound : ""}`;
    if (resultKey !== "|" && table.lastResultKey === resultKey) return table;

    // Clear on a real shoe-id change OR when the round counter resets/backtracks.
    // Some feeds update the shoe id slightly later than the first round of a new shoe.
    const roundReset = Number.isFinite(nextRound) && nextRound <= Number(table.round);
    const base = nextShoe !== String(table.shoe) || roundReset ? [] : table.results;
    const results = [...base, result];
    const count = stats(results);

    return {
      ...table,
      live: true,
      shoe: nextShoe,
      round: Number.isFinite(nextRound) ? nextRound : table.round + 1,
      ...count,
      results,
      countdown: 0,
      countdownUpdatedAt: Date.now(),
      lastResultKey: resultKey !== "|" ? resultKey : table.lastResultKey,
      lastUpdated: Date.now(),
    } as T;
  });
}

export function applyLiveWait<T extends LiveRoadTable>(current: T[], payload: any, allowedIds: readonly string[]): T[] {
  const body = payload?.body ?? payload?.msg ?? payload?.data ?? {};
  const targetApiId = String(body?.table_id ?? "");
  if (!allowedIds.includes(targetApiId)) return current;
  return current.map((table) => {
    if ((table.apiId ?? `BAG${table.id}`) !== targetApiId) return table;
    const receivedCount = Number(body?.count);
    const hasCount = Number.isFinite(receivedCount);
    return {
      ...table,
      live: true,
      shoe: String(body?.shoe ?? table.shoe),
      round: Number(body?.round ?? table.round),
      countdown: hasCount ? Math.max(0, receivedCount) : table.countdown,
      countdownUpdatedAt: hasCount ? Date.now() : table.countdownUpdatedAt,
      lastUpdated: Date.now(),
    } as T;
  });
}
