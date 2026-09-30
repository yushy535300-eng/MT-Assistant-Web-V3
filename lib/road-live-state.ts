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
  dealerId?: string;
  dealerNation?: string;
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
  return String(source?.table_id ?? source?.id ?? "").toUpperCase();
}

export function isMtBaccaratTable(source: any) {
  const tableId = getApiTableId(source);
  const tableType = String(source?.table_type ?? source?.tableType ?? source?.game_type ?? "").toUpperCase();
  // BAG07/BAG08 are advertised as BAS in the captured MT /tables response.
  if (tableType) return tableType === "BAC" || tableType === "BACCARAT" || tableType === "BAS";
  // Live table events do not always repeat table_type. These are the baccarat
  // prefixes observed in MT's authoritative /tables response.
  return /^(BAG|BAV|SBG)/.test(tableId);
}

function stats(results: RoadResult[]) {
  return {
    banker: results.filter((r) => r === "莊").length,
    player: results.filter((r) => r === "閒").length,
    tie: results.filter((r) => r === "和").length,
  };
}

function mergeSnapshot(local: RoadResult[], server: RoadResult[], sameShoe: boolean, round: number) {
  // Only an actual Shoe ID change starts a fresh road.
  if (!sameShoe) return server.length ? server : local;

  // Same Shoe must move forward, never backward. MT snapshots can arrive one packet
  // behind show_win, so a shorter snapshot must not make the UI flash back.
  if (server.length > local.length) return server;
  if (server.length === local.length && server.length) return server;
  return local;
}


function meaningfulDealerName(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text || /^[-—]+$/.test(text) || /^TEST$/i.test(text)) return "";
  return text;
}

function normalizeDealerPhoto(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith("//")) return `https:${text}`;
  if (text.startsWith("/")) return `https://ds.ofalive99.net${text}`;
  return text;
}

function dealerMeta(source: any) {
  const dealer = source?.dealer ?? source?.dealer_info ?? source?.dealerInfo ?? {};
  const id = String(
    dealer?.id ?? dealer?.dealer_id ?? source?.dealer_id ?? source?.dealerId ?? ""
  ).trim();
  const nation = String(dealer?.nation ?? source?.dealer_nation ?? "").trim();
  const name =
    meaningfulDealerName(dealer?.nick_name) ||
    meaningfulDealerName(dealer?.nickname) ||
    meaningfulDealerName(dealer?.name) ||
    meaningfulDealerName(dealer?.username) ||
    meaningfulDealerName(dealer?.realname) ||
    meaningfulDealerName(source?.dealer_name) ||
    meaningfulDealerName(source?.dealerName);
  const photo = normalizeDealerPhoto(
    source?.dealer_image ??
      source?.dealer_image_url ??
      source?.dealerPhoto ??
      dealer?.avatar_url ??
      dealer?.image ??
      dealer?.avatar
  );
  return { id, nation, name, photo };
}

function sameRoadResults(a: RoadResult[], b: RoadResult[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export function mergeLiveTable<T extends LiveRoadTable>(table: T, source: any): T {
  const trend = source?.trend ?? {};
  const serverResults = parseBeadPlate(trend?.bead_plate2 ?? trend?.bead_plate ?? source?.bead_plate2);
  const sourceShoe = String(trend?.current_shoe ?? source?.shoe ?? table.shoe ?? "—");
  const sourceRound = Number(trend?.current_round ?? source?.round ?? table.round);
  const currentShoe = String(table.shoe ?? "—");
  const shoeDiff =
    currentShoe !== "—" && sourceShoe !== "—" && currentShoe !== sourceShoe;

  // A tables/tablesvg packet may briefly carry a stale/new shoe id while its road
  // still belongs to the previous shoe. Never let that transient packet collapse
  // a full road to one dot. Accept a shoe change only when the snapshot itself
  // looks like the beginning of a fresh shoe.
  const finiteRound = Number.isFinite(sourceRound) ? sourceRound : table.round;
  const freshShoeSnapshot = finiteRound <= 3 && serverResults.length <= 3;
  const acceptShoeChange = !shoeDiff || freshShoeSnapshot;
  const effectiveShoe = shoeDiff && !acceptShoeChange ? currentShoe : sourceShoe;
  const results = shoeDiff && !acceptShoeChange
    ? table.results
    : mergeSnapshot(table.results, serverResults, !shoeDiff, finiteRound);
  const count = stats(results);
  const apiId = getApiTableId(source) || table.apiId;
  const dealer = dealerMeta(source);
  const dealerChanged = !!(
    dealer.id &&
    table.dealerId &&
    dealer.id !== table.dealerId
  );
  const nextName = dealer.name || (dealerChanged ? "—" : table.name);
  const nextPlayers = String(source?.totalplayers ?? source?.total_players ?? table.players);
  const nextRoomId = String(source?.room_id ?? table.roomId ?? "");
  const nextBadge = String(source?.orderState ?? table.tableBadge ?? "");
  const nextRound = shoeDiff && !acceptShoeChange
    ? table.round
    : (Number.isFinite(sourceRound) ? sourceRound : table.round);
  // A blank avatar on a newly assigned dealer must not keep showing the
  // previous dealer. When MT has no avatar (currently some TEST tables), clear
  // the stale image so the UI can fall back to that table's live video feed.
  const nextPhoto = dealer.photo
    ? dealer.photo
    : dealerChanged
      ? undefined
      : table.dealerPhoto;
  const nextDealerId = dealer.id || table.dealerId;
  const nextDealerNation = dealer.nation || table.dealerNation;

  // Snapshot replies are frequent. Keep the exact same object reference when
  // nothing visible changed so React.memo does not repaint every table card.
  if (
    apiId === table.apiId &&
    table.live === true &&
    nextName === table.name &&
    nextPlayers === table.players &&
    nextRoomId === String(table.roomId ?? "") &&
    nextBadge === String(table.tableBadge ?? "") &&
    effectiveShoe === table.shoe &&
    nextRound === table.round &&
    count.banker === table.banker &&
    count.player === table.player &&
    count.tie === table.tie &&
    nextPhoto === table.dealerPhoto &&
    nextDealerId === table.dealerId &&
    nextDealerNation === table.dealerNation &&
    sameRoadResults(results, table.results)
  ) {
    return table;
  }

  return {
    ...table,
    apiId,
    live: true,
    name: nextName,
    players: nextPlayers,
    roomId: nextRoomId,
    tableBadge: nextBadge,
    shoe: effectiveShoe,
    round: nextRound,
    ...count,
    results,
    dealerPhoto: nextPhoto,
    dealerId: nextDealerId,
    dealerNation: nextDealerNation,
    lastUpdated: Date.now(),
  } as T;
}

export function applyLiveTables<T extends LiveRoadTable>(current: T[], sources: any[]): T[] {
  const baccarat = sources.filter(isMtBaccaratTable);
  return current.map((table) => {
    const expected = String(table.apiId ?? `BAG${table.id}`).toUpperCase();
    // Exact table_id is mandatory. MT now exposes BAV01 and BAV01_LIVE with the
    // same table_name/room/game, so table_name fallback cross-wires dealer data.
    const source = baccarat.find((item) => getApiTableId(item) === expected);
    return source ? mergeLiveTable(table, source) : table;
  });
}

export function applyLiveShowWin<T extends LiveRoadTable>(current: T[], payload: any): T[] {
  const body = payload?.body ?? payload?.msg ?? payload?.data ?? {};
  const result = winnerToRoadResult(body?.winner);
  const targetApiId = String(body?.table_id ?? "").toUpperCase();
  if (!result || !current.some((table) => (table.apiId ?? table.id) === targetApiId)) return current;

  return current.map((table) => {
    if ((table.apiId ?? `BAG${table.id}`) !== targetApiId) return table;

    const nextShoe = String(body?.shoe ?? table.shoe ?? "—");
    const nextRound = Number(body?.round ?? table.round + 1);
    // Deduplicate against the authoritative current shoe, not a transient shoe
    // value carried by show_win. This prevents the same round being appended twice
    // when MT momentarily reports a different shoe id.
    const keyShoe = String(table.shoe ?? "—") !== "—" ? String(table.shoe) : nextShoe;
    const resultKey = `${keyShoe}|${Number.isFinite(nextRound) ? nextRound : ""}`;
    if (resultKey !== "|" && table.lastResultKey === resultKey) return table;

    // show_win is an incremental event only. NEVER clear/rebuild the road here.
    // MT can send a transient/stale shoe or round value in show_win; using it as a
    // reset signal causes the UI to collapse to one dot until /tables arrives.
    // A new shoe is accepted only from the authoritative /tables snapshot.
    const results = [...table.results, result];
    const count = stats(results);

    return {
      ...table,
      live: true,
      shoe: String(table.shoe ?? "—") !== "—" ? table.shoe : nextShoe,
      round: Number.isFinite(nextRound) ? Math.max(table.round, nextRound) : table.round + 1,
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
  const targetApiId = String(body?.table_id ?? "").toUpperCase();
  if (!allowedIds.includes(targetApiId)) return current;
  return current.map((table) => {
    if ((table.apiId ?? `BAG${table.id}`) !== targetApiId) return table;
    const receivedCount = Number(body?.count);
    const hasCount = Number.isFinite(receivedCount);
    return {
      ...table,
      live: true,
      // wait/end are timing events, not authoritative shoe snapshots. Never let
      // them mutate shoe state or move round backward; both can make the next
      // snapshot look like a false shoe change and roll the road back.
      shoe: table.shoe,
      round: Number.isFinite(Number(body?.round))
        ? Math.max(table.round, Number(body?.round))
        : table.round,
      countdown: hasCount ? Math.max(0, receivedCount) : table.countdown,
      countdownUpdatedAt: hasCount ? Date.now() : table.countdownUpdatedAt,
      lastUpdated: Date.now(),
    } as T;
  });
}
