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
  if (winner === 1 || winner === "1" || winner === "PLAYER" || winner === "閒") return "閒";
  if (winner === 2 || winner === "2" || winner === "BANKER" || winner === "莊") return "莊";
  if (winner === 3 || winner === "3" || winner === "TIE" || winner === "和") return "和";
  return null;
}

export function parseBeadPlate(raw: unknown): RoadResult[] {
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

export function mergeLiveTable<T extends LiveRoadTable>(table: T, source: any): T {
  const trend = source?.trend ?? {};
  const serverResults = parseBeadPlate(trend?.bead_plate2);
  const sourceShoe = String(trend?.current_shoe ?? source?.shoe ?? table.shoe);
  const sameShoe = String(table.shoe) === sourceShoe;
  const results = sameShoe && table.lastResultKey?.startsWith(`${sourceShoe}|`) && table.results.length > serverResults.length ? table.results : serverResults;
  const banker = results.filter((result) => result === "莊").length;
  const player = results.filter((result) => result === "閒").length;
  const tie = results.filter((result) => result === "和").length;
  const apiId = getApiTableId(source);
  return {
    ...table,
    apiId: apiId || table.apiId,
    live: true,
    name: source?.dealer?.nick_name ?? source?.dealer?.username ?? source?.table_name ?? table.name,
    players: String(source?.totalplayers ?? table.players),
    roomId: String(source?.room_id ?? table.roomId ?? ""),
    tableBadge: String(source?.orderState ?? table.tableBadge ?? ""),
    shoe: sourceShoe,
    round: Number(trend?.current_round ?? source?.round ?? table.round),
    banker,
    player,
    tie,
    results,
    dealerPhoto: source?.dealer_image ?? source?.dealer_image_url ?? source?.dealer?.avatar_url ?? source?.dealer?.image ?? source?.dealer?.avatar ?? table.dealerPhoto,
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
  const resultKey = `${String(body?.shoe ?? "")}|${String(body?.round ?? "")}`;
  if (!result || !targetApiId.startsWith("BAG")) return current;
  return current.map((table) => {
    if ((table.apiId ?? `BAG${table.id}`) !== targetApiId) return table;
    if (resultKey !== "|" && table.lastResultKey === resultKey) return table;
    const nextShoe = String(body?.shoe ?? table.shoe);
    const results = [...(nextShoe !== String(table.shoe) ? [] : table.results), result].slice(-120);
    return {
      ...table,
      live: true,
      shoe: nextShoe,
      round: Number(body?.round ?? table.round + 1),
      banker: results.filter((value) => value === "莊").length,
      player: results.filter((value) => value === "閒").length,
      tie: results.filter((value) => value === "和").length,
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
    return { ...table, live: true, shoe: String(body?.shoe ?? table.shoe), round: Number(body?.round ?? table.round), countdown: hasCount ? Math.max(0, receivedCount) : table.countdown, countdownUpdatedAt: hasCount ? Date.now() : table.countdownUpdatedAt, lastUpdated: Date.now() } as T;
  });
}
