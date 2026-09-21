/**
 * SA Gaming (labplatformplus / connect2explorer) binary lobby protocol.
 * Framing and command layouts verified against ws2.labplatformplus.com HAR
 * and the vendor SPA chunk (CMD* classes / getCmdID).
 *
 * Packet: 0xaa | u32le(2+4+payloadLen) | u16le(cmdId) | u32le(payloadLen) | payload
 */

export type SaRoadResult = "莊" | "閒" | "和";

export const SA_CMD = {
  SC_ACK: 30024,
  SC_GAME_STATE: 30005,
  SC_GAME_RESULT: 30006,
  SC_GAME_START: 30003,
  SC_GAME_REST: 30017,
  SC_ANCHOR_LOGIN: 30012,
  SC_HOST_SETTING: 30052,
  SC_INIT_BACCARAT: 30501,
  SC_INIT_NEW_BACCARAT: 30519,
  SC_INIT_SQUEEZE_BACCARAT: 30508,
  SP_LOGIN: 50001,
  SP_LOGIN_FAIL: 50002,
  SP_HOST_LIST: 50012,
  SP_BACCARAT_GOOD_ROAD: 50090,
  SP_BACCARAT_STATISTICS: 50095,
  CS_ACK: 35002,
  PS_LOGIN: 55001,
  PS_REQUEST_INIT_CLIENT: 55010,
} as const;

/** Vendor TableMode (InitBaccarat.Rest / ScGameRest.OnOrOff). */
export const SA_TABLE_MODE = {
  OPEN: 0,
  CLOSE: 1,
  INTERNAL_TEST: 2,
  PAUSE: 3,
  INTERNAL_TEST_PAUSE: 4,
} as const;

/**
 * Official lobby treats Open + Pause as 「開桌」(IsRest=false).
 * Close / InternalTest are resting and must not flood the homepage grid.
 */
export function isSaTableModeOpen(rest: number | undefined | null): boolean {
  const mode = Number(rest);
  return mode === SA_TABLE_MODE.OPEN || mode === SA_TABLE_MODE.PAUSE;
}

export const SA_GAME_TYPE_BACCARAT = 1;
export const SA_BET_SOURCE_WEBSITE = 64 | 16 | 2048; // Browser|HTML5|PC = 2128
export const SA_DEFAULT_WS = "wss://scs12.connect2explorer.com/";

export class ByteReader {
  private pos = 0;
  constructor(private buf: Buffer) {}
  get remaining() {
    return Math.max(0, this.buf.length - this.pos);
  }
  u8() {
    const v = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return v;
  }
  u16() {
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  u32() {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  u64() {
    const v = this.buf.readBigUInt64LE(this.pos);
    this.pos += 8;
    return v;
  }
  i64() {
    const v = this.buf.readBigInt64LE(this.pos);
    this.pos += 8;
    return Number(v);
  }
  str() {
    const start = this.pos;
    const idx = this.buf.indexOf(0, start);
    if (idx < 0) {
      this.pos = this.buf.length;
      return this.buf.subarray(start).toString("utf8");
    }
    const out = this.buf.subarray(start, idx).toString("utf8");
    this.pos = idx + 1;
    return out;
  }
}

export class ByteWriter {
  private parts: Buffer[] = [];
  u8(v: number) {
    const b = Buffer.alloc(1);
    b.writeUInt8(v & 0xff, 0);
    this.parts.push(b);
  }
  u16(v: number) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v & 0xffff, 0);
    this.parts.push(b);
  }
  u32(v: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0, 0);
    this.parts.push(b);
  }
  u64(v: number | bigint) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(v), 0);
    this.parts.push(b);
  }
  str(v: string) {
    this.parts.push(Buffer.from(String(v || ""), "utf8"));
    this.parts.push(Buffer.alloc(1));
  }
  toBuffer() {
    return Buffer.concat(this.parts);
  }
}

export function wrapCommand(cmdId: number, payload: Buffer) {
  const bodyLen = payload.length;
  const totalInner = 2 + 4 + bodyLen;
  const out = Buffer.alloc(1 + 4 + totalInner);
  out.writeUInt8(0xaa, 0);
  out.writeUInt32LE(totalInner, 1);
  out.writeUInt16LE(cmdId & 0xffff, 5);
  out.writeUInt32LE(bodyLen, 7);
  payload.copy(out, 11);
  return out;
}

export function parseFrame(raw: Buffer): { cmdId: number; payload: Buffer } | null {
  if (!raw || raw.length < 11 || raw[0] !== 0xaa) return null;
  const cmdId = raw.readUInt16LE(5);
  const bodyLen = raw.readUInt32LE(7);
  if (raw.length < 11 + bodyLen) return null;
  return { cmdId, payload: raw.subarray(11, 11 + bodyLen) };
}

/** Split a buffer that may contain one or more 0xaa SA commands. */
export function parseAllFrames(
  raw: Buffer,
): Array<{ cmdId: number; payload: Buffer }> {
  const out: Array<{ cmdId: number; payload: Buffer }> = [];
  if (!raw || !raw.length) return out;
  let offset = 0;
  while (offset < raw.length) {
    const start = raw.indexOf(0xaa, offset);
    if (start < 0) break;
    if (raw.length < start + 11) break;
    const bodyLen = raw.readUInt32LE(start + 7);
    const total = 11 + bodyLen;
    if (bodyLen < 0 || raw.length < start + total) break;
    const frame = parseFrame(raw.subarray(start, start + total));
    if (frame) out.push(frame);
    offset = start + total;
  }
  return out;
}

/**
 * ScGameStart (30003): binds a live gameId to hostId so subsequent
 * ScGameResult packets can update the correct table road.
 * Layout verified against ws2 HAR: u16 hostId | u64 gameId | u32 gameCount | u32 countdown
 */
export function parseScGameStart(
  payload: Buffer,
): { hostId: number; gameId: number; gameCount: number; countdown: number } | null {
  try {
    if (!payload || payload.length < 14) return null;
    const r = new ByteReader(payload);
    const hostId = r.u16();
    const gameId = Number(r.u64());
    const gameCount = r.remaining >= 4 ? r.u32() : 0;
    const countdown = r.remaining >= 4 ? r.u32() : 0;
    if (!hostId || !gameId) return null;
    return { hostId, gameId, gameCount, countdown };
  } catch {
    return null;
  }
}

export type SaGameState = {
  /** Present on legacy u16-host layout; baccarat deal CSV omits hostId. */
  hostId?: number;
  gameId: number;
  state: number;
  detail: string;
  remainTime?: number;
  playerCards?: number[];
  bankerCards?: number[];
  /** DG-style poker JSON when detail carries dealt cards (算牌 / 奇偶). */
  poker?: string;
};

/**
 * ScGameState (30005) — HAR ws2…3596 baccarat deal layout:
 *   u8 remainTime | u64 gameId | u16 state | cstring detail
 * Detail CSV progresses live: `1, 43, 0` → `2, 43, 31, 2, 22, 15`.
 * Fallback: u16 hostId | u64 gameId | u16 state | cstring (non-deal / JSON games).
 */
export function parseScGameState(payload: Buffer): SaGameState | null {
  try {
    if (!payload || payload.length < 11) return null;

    // Layout B (baccarat deal): u8 remain | u64 gameId | u16 state | str
    const remainTime = payload.readUInt8(0);
    const gameIdB = Number(payload.readBigUInt64LE(1));
    const stateB = payload.length >= 11 ? payload.readUInt16LE(9) : 0;
    let endB = 11;
    while (endB < payload.length && payload[endB] !== 0) endB++;
    const detailB = payload.subarray(11, endB).toString("utf8");
    const dealCards = extractSaDealCards(detailB);
    if (dealCards || (/^\d+\s*,/.test(detailB) && !detailB.trim().startsWith("{"))) {
      const poker = dealCards
        ? formatSaPokerJson(
            dealCards.playerCards,
            dealCards.bankerCards,
            dealCards.oneBased,
          )
        : undefined;
      return {
        gameId: gameIdB,
        state: stateB,
        detail: detailB,
        remainTime,
        playerCards: dealCards?.playerCards,
        bankerCards: dealCards?.bankerCards,
        poker,
      };
    }

    // Layout C: u16 hostId | u64 gameId | u16 state | str
    if (payload.length < 12) return null;
    const r = new ByteReader(payload);
    const hostId = r.u16();
    const gameId = Number(r.u64());
    const state = r.remaining >= 2 ? r.u16() : 0;
    const detail = r.remaining > 0 ? r.str() : "";
    if (!gameId && !detail) return null;
    const extracted = extractSaDealCards(detail) || extractSaBaccaratCards(detail);
    const poker = extracted
      ? formatSaPokerJson(
          extracted.playerCards,
          extracted.bankerCards,
          extracted.oneBased,
        )
      : undefined;
    return {
      hostId: hostId || undefined,
      gameId,
      state,
      detail,
      playerCards: extracted?.playerCards,
      bankerCards: extracted?.bankerCards,
      poker,
    };
  } catch {
    return null;
  }
}

/** New-format FResult: bits 0-2 marker, bit3=Tie, bit4=Player, bit5=Banker. */
export function roadFromFResult(fresult: number | bigint): SaRoadResult | null {
  const v = typeof fresult === "bigint" ? Number(fresult) : Number(fresult);
  if (!Number.isFinite(v) || v === 0) return null;
  const b0 = (v & 1) !== 0;
  const b1 = (v & 2) !== 0;
  const b2 = (v & 4) !== 0;
  if (b0 && b1 && b2) {
    if ((v & (1 << 3)) !== 0) return "和";
    if ((v & (1 << 4)) !== 0) return "閒";
    if ((v & (1 << 5)) !== 0) return "莊";
    return null;
  }
  if ((v & (1 << 1)) !== 0) return "閒";
  if ((v & (1 << 2)) !== 0) return "莊";
  if ((v & (1 << 0)) !== 0) return "和";
  return null;
}

function cardPoint(card: number, oneBased: boolean) {
  const c = oneBased ? card - 1 : card;
  if (c < 0) return 0;
  const v = (c % 13) + 1;
  return v >= 10 ? 0 : v;
}

export function roadFromCards(
  playerCards: number[],
  bankerCards: number[],
  oneBased = true,
): SaRoadResult | null {
  if (!playerCards.length || !bankerCards.length) return null;
  const pp = playerCards.reduce((s, c) => s + cardPoint(c, oneBased), 0) % 10;
  const bp = bankerCards.reduce((s, c) => s + cardPoint(c, oneBased), 0) % 10;
  if (pp === bp) return "和";
  return pp > bp ? "閒" : "莊";
}

/** Face rank for float / V38 (DG-compatible). SA classic ResultString cards are 0-based 0..51. */
export function saCardRank(card: number, oneBased = false): string | null {
  if (!Number.isFinite(card)) return null;
  const n = oneBased ? Math.trunc(card) - 1 : Math.trunc(card);
  if (n < 0 || n > 51) return null;
  const rank = (n % 13) + 1;
  if (rank === 1) return "A";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  return String(rank);
}

/**
 * DG float poker JSON: `{"player":"Q-10","banker":"4-4"}`.
 * Consumed by parseDgV38Poker / 算牌 / 奇偶 for SA+DG alike.
 */
export function formatSaPokerJson(
  playerCards: number[],
  bankerCards: number[],
  oneBased = false,
): string | undefined {
  const player = playerCards
    .map((c) => saCardRank(c, oneBased))
    .filter((x): x is string => !!x)
    .slice(0, 3);
  const banker = bankerCards
    .map((c) => saCardRank(c, oneBased))
    .filter((x): x is string => !!x)
    .slice(0, 3);
  if (!player.length && !banker.length) return undefined;
  return JSON.stringify({ player: player.join("-"), banker: banker.join("-") });
}

/** @deprecated alias — prefer formatSaPokerJson with explicit oneBased. */
export function saPokerJson(
  playerCards: number[],
  bankerCards: number[],
  oneBased = false,
): string | undefined {
  return formatSaPokerJson(playerCards, bankerCards, oneBased);
}

export type SaExtractedCards = {
  playerCards: number[];
  bankerCards: number[];
  /** false = GameResult CSV (HAR-verified); true = InitBaccarat binary / JSON PK. */
  oneBased: boolean;
};

/**
 * Pull player/banker card ids from ScGameResult ResultString.
 * Classic lobby (D01–D04): `pCount, pCards…, bCount, bCards…` with 0-based ids
 * (card 0 = A♠). Multi-seat JSON: banker B.PK + first seat P[].PK (1-based).
 */
export function extractSaBaccaratCards(resultString: string): SaExtractedCards | null {
  const rs = String(resultString || "").trim();
  if (!rs) return null;

  if (rs.startsWith("{")) {
    try {
      const j = JSON.parse(rs);
      const bankerCards = Array.isArray(j?.B?.PK)
        ? j.B.PK.map(Number).filter((n: number) => Number.isFinite(n))
        : [];
      let playerCards: number[] = [];
      if (Array.isArray(j?.P)) {
        for (const seat of j.P) {
          if (Array.isArray(seat?.PK) && seat.PK.length) {
            playerCards = seat.PK.map(Number).filter((n: number) => Number.isFinite(n));
            break;
          }
        }
      } else if (Array.isArray(j?.P?.PK)) {
        playerCards = j.P.PK.map(Number).filter((n: number) => Number.isFinite(n));
      }
      if (!playerCards.length && !bankerCards.length) return null;
      return { playerCards, bankerCards, oneBased: true };
    } catch {
      return null;
    }
  }

  if (!rs.includes(",")) return null;
  const nums = rs.split(",").map((x) => Number(String(x).trim()));
  if (nums.length < 4 || !Number.isFinite(nums[0])) return null;
  const pCount = nums[0];
  if (pCount < 2 || pCount > 3) return null;
  const playerCards = nums.slice(1, 1 + pCount);
  const rest = nums.slice(1 + pCount);
  if (!rest.length || !Number.isFinite(rest[0])) return null;
  const bCount = rest[0];
  if (bCount < 2 || bCount > 3) return null;
  const bankerCards = rest.slice(1, 1 + bCount);
  if (playerCards.length !== pCount || bankerCards.length !== bCount) return null;
  if (
    playerCards.some((c) => !Number.isFinite(c) || c < 0 || c > 51) ||
    bankerCards.some((c) => !Number.isFinite(c) || c < 0 || c > 51)
  ) {
    return null;
  }
  // HAR ws2…3596: CSV card ids are 0-based (roadFromCards false matches FResult 51/51).
  return { playerCards, bankerCards, oneBased: false };
}

/**
 * Live GameState deal CSV — same 0-based card ids as GameResult, but allows
 * partial hands while cards are still being dealt (pCount/bCount 0..3).
 * Examples from HAR: `1, 43, 0` → `1, 43, 1, 22` → `2, 43, 31, 2, 22, 15`.
 */
export function extractSaDealCards(detail: string): SaExtractedCards | null {
  const rs = String(detail || "").trim();
  if (!rs || rs.startsWith("{") || !rs.includes(",")) return null;
  const nums = rs.split(",").map((x) => Number(String(x).trim()));
  if (nums.length < 2 || !Number.isFinite(nums[0])) return null;
  const pCount = nums[0];
  if (pCount < 0 || pCount > 3) return null;
  const playerCards = nums.slice(1, 1 + pCount);
  if (playerCards.length !== pCount) return null;
  const rest = nums.slice(1 + pCount);
  let bankerCards: number[] = [];
  if (rest.length >= 1 && Number.isFinite(rest[0])) {
    const bCount = rest[0];
    if (bCount < 0 || bCount > 3) return null;
    bankerCards = rest.slice(1, 1 + bCount);
    if (bankerCards.length !== bCount) return null;
  }
  if (!playerCards.length && !bankerCards.length) return null;
  if (
    playerCards.some((c) => !Number.isFinite(c) || c < 0 || c > 51) ||
    bankerCards.some((c) => !Number.isFinite(c) || c < 0 || c > 51)
  ) {
    return null;
  }
  return { playerCards, bankerCards, oneBased: false };
}

export function shoeRoundFromGameCount(gameCount: number) {
  const gc = Number(gameCount) || 0;
  return { shoe: Math.floor(gc / 10000), round: gc % 10000 };
}

/**
 * SA float round after a settled hand (GameResult road).
 * Prefer absolute GameStart gameCount when known (no double-bump after Start).
 * Otherwise +1 so float cannot lag Init while roads keep appending
 * (official 37 / float 32 class of bug).
 */
export function nextSaRoundAfterHand(prevRound: number, gameCount?: number) {
  const fromStart =
    gameCount != null && Number(gameCount) > 0
      ? shoeRoundFromGameCount(Number(gameCount)).round
      : 0;
  const prev = Number(prevRound) || 0;
  if (fromStart > 0) return Math.max(prev, fromStart);
  return prev + 1;
}

/**
 * Merge Init snapshot round without regressing a live GameStart/GameResult
 * round on the same shoe.
 */
export function mergeSaInitRound(
  prevRound: number,
  prevShoe: string | number | undefined,
  shoe: number,
  round: number,
) {
  if (!(round > 0)) return Number(prevRound) || 0;
  const prev = Number(prevRound) || 0;
  const prevShoeStr = String(prevShoe ?? "");
  const sameShoe =
    !shoe ||
    !prevShoeStr ||
    prevShoeStr === "—" ||
    prevShoeStr === String(shoe);
  if (sameShoe && prev > round) return prev;
  return round;
}

export function buildPsLogin(token: string, domain = "", betSource = SA_BET_SOURCE_WEBSITE) {
  const w = new ByteWriter();
  w.str(token);
  w.u32(betSource);
  w.str(domain);
  w.u64(0);
  return wrapCommand(SA_CMD.PS_LOGIN, w.toBuffer());
}

export function buildCsAck() {
  return wrapCommand(SA_CMD.CS_ACK, Buffer.alloc(0));
}

export function buildRequestInitClient(hostIds: number[]) {
  const w = new ByteWriter();
  const ids = hostIds.filter((h) => h > 0).slice(0, 255);
  w.u8(ids.length);
  for (const id of ids) w.u16(id);
  return wrapCommand(SA_CMD.PS_REQUEST_INIT_CLIENT, w.toBuffer());
}

export type SaHostInfo = { hostId: number; setting: number; gameType: number };

export function parseSpHostList(payload: Buffer): SaHostInfo[] {
  const r = new ByteReader(payload);
  const n = r.u8();
  const out: SaHostInfo[] = [];
  for (let i = 0; i < n && r.remaining >= 12; i++) {
    out.push({ hostId: r.u16(), setting: r.u16(), gameType: Number(r.i64()) });
  }
  return out;
}

export type SaBaccaratHand = {
  gameId: number;
  gameCount: number;
  fresult: number;
  result: SaRoadResult | null;
  playerCards?: number[];
  bankerCards?: number[];
  /** DG-style poker JSON when Init OldResult carried card bytes. */
  poker?: string;
};

export type SaInitBaccarat = {
  hostId: number;
  hallId: number;
  countDown: number;
  remainTime: number;
  /** TableMode: 0=Open, 1=Close, 2=InternalTest, 3=Pause, … */
  rest: number;
  currentState: number;
  hands: SaBaccaratHand[];
};

function readBaseResult(r: ByteReader) {
  const gameId = r.i64();
  const gameCount = r.u32();
  const fresult = Number(r.u64());
  return { gameId, gameCount, fresult };
}

function readBaccaratHand(r: ByteReader, oneBasedCards: boolean): SaBaccaratHand {
  const base = readBaseResult(r);
  const pcN = r.u8();
  const playerCards: number[] = [];
  for (let i = 0; i < pcN; i++) playerCards.push(r.u8());
  const bcN = r.u8();
  const bankerCards: number[] = [];
  for (let i = 0; i < bcN; i++) bankerCards.push(r.u8());
  const result =
    roadFromFResult(base.fresult) ||
    roadFromCards(playerCards, bankerCards, oneBasedCards);
  const poker =
    playerCards.length || bankerCards.length
      ? formatSaPokerJson(playerCards, bankerCards, oneBasedCards)
      : undefined;
  return { ...base, result, playerCards, bankerCards, poker };
}

export function parseScInitBaccarat(payload: Buffer): SaInitBaccarat | null {
  try {
    const r = new ByteReader(payload);
    const hallId = r.u32();
    const hostId = r.u16();
    const countDown = r.u32();
    const remainTime = r.u32();
    const rest = r.u8(); // TableMode
    r.u8(); // AllowSideBet
    r.u8(); // Seat
    r.i64(); // TableLimit
    r.u8(); // LastRound
    const n = r.u8();
    const hands: SaBaccaratHand[] = [];
    for (let i = 0; i < n && r.remaining > 16; i++) {
      hands.push(readBaccaratHand(r, true));
    }
    const currentState = r.remaining >= 2 ? r.u16() : 0;
    return { hostId, hallId, countDown, remainTime, rest, currentState, hands };
  } catch {
    return null;
  }
}

/** InitNewBaccarat uses CMDRoadMap OldResult (gameId + "round,code" string). */
export function parseScInitNewBaccarat(payload: Buffer): SaInitBaccarat | null {
  try {
    const r = new ByteReader(payload);
    const hallId = r.u32();
    const hostId = r.u16();
    const countDown = r.u32();
    const remainTime = r.u32();
    const rest = r.u8();
    r.u8();
    r.u8();
    r.i64();
    r.u8();
    const n = r.u8();
    const hands: SaBaccaratHand[] = [];
    for (let i = 0; i < n && r.remaining > 8; i++) {
      const gameId = r.i64();
      const roadStr = r.str();
      // Prefer card-point decode is unavailable; RoadMap for baccarat may be sparse.
      // Fall through: leave result null unless FResult-like numeric pair appears.
      const parts = roadStr.split(",").map((x) => Number(String(x).trim()));
      let result: SaRoadResult | null = null;
      let gameCount = 0;
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        gameCount = parts[0];
        // Some tables encode winner as 1/2/3 in second field — map conservatively via points only when cards present.
        const code = parts[1];
        if (code === 1) result = "閒";
        else if (code === 2) result = "莊";
        else if (code === 3) result = "和";
      }
      hands.push({ gameId, gameCount, fresult: 0, result });
    }
    const currentState = r.remaining >= 2 ? r.u16() : 0;
    return { hostId, hallId, countDown, remainTime, rest, currentState, hands };
  } catch {
    return null;
  }
}

/** ScGameRest (30017): live open/close toggle — u16 hostId | u8 OnOrOff(TableMode). */
export function parseScGameRest(
  payload: Buffer,
): { hostId: number; onOrOff: number } | null {
  try {
    if (!payload || payload.length < 3) return null;
    const r = new ByteReader(payload);
    const hostId = r.u16();
    const onOrOff = r.u8();
    if (!hostId) return null;
    return { hostId, onOrOff };
  } catch {
    return null;
  }
}

export type SaGameResult = {
  gameId: number;
  gameResult: number;
  resultString: string;
  road: SaRoadResult | null;
  /** Card ids (0-based CSV / 1-based JSON — see extractSaBaccaratCards). */
  playerCards: number[];
  bankerCards: number[];
  /** DG-style poker JSON for float / 算牌 / 奇偶. */
  poker?: string;
};

export function parseScGameResult(payload: Buffer): SaGameResult | null {
  try {
    const r = new ByteReader(payload);
    const gameId = Number(r.u64());
    const gameResult = Number(r.u64());
    const resultString = r.str();
    const extracted = extractSaBaccaratCards(resultString);
    const playerCards = extracted?.playerCards ?? [];
    const bankerCards = extracted?.bankerCards ?? [];
    const oneBased = extracted?.oneBased ?? false;
    let road = roadFromFResult(gameResult);
    if (!road && playerCards.length && bankerCards.length) {
      road = roadFromCards(playerCards, bankerCards, oneBased);
      if (!road) road = roadFromCards(playerCards, bankerCards, !oneBased);
    }
    const poker =
      playerCards.length || bankerCards.length
        ? formatSaPokerJson(playerCards, bankerCards, oneBased)
        : undefined;
    return {
      gameId,
      gameResult,
      resultString,
      road,
      playerCards,
      bankerCards,
      poker,
    };
  } catch {
    return null;
  }
}

export type SaAnchorLogin = { hostId: number; dealerName: string; dealerId: number };

export function parseScAnchorLogin(payload: Buffer): SaAnchorLogin | null {
  try {
    const r = new ByteReader(payload);
    const hostId = r.u16();
    const n = r.u8();
    if (n <= 0 || r.remaining < 5) return { hostId, dealerName: "", dealerId: 0 };
    const dealerId = r.u32();
    const dealerName = r.str();
    return { hostId, dealerId, dealerName };
  } catch {
    return null;
  }
}

export type SaSpLogin = {
  playerId: number;
  lobbyCode: string;
  reconnectKey: string;
  username: string;
};

export function parseSpLogin(payload: Buffer): SaSpLogin | null {
  try {
    const r = new ByteReader(payload);
    const playerId = r.i64();
    const lobbyCode = r.str();
    r.str(); // CurrencyDisplayName
    r.u8(); // DuplicateLogin
    r.u64(); // PlayerPrefs
    r.u64(); // CurrencyType
    const curN = r.u8();
    for (let i = 0; i < curN && r.remaining > 0; i++) r.u64();
    r.u64(); // PlayerPrefs2
    const reconnectKey = r.str();
    r.i64(); // MinimumToken
    const username = r.str();
    return { playerId, lobbyCode, reconnectKey, username };
  } catch {
    return null;
  }
}

export function extractSaAuth(gameUrl: string) {
  let token = "";
  let username = "";
  let origin = "https://ws2.labplatformplus.com";
  try {
    const u = new URL(gameUrl);
    token = u.searchParams.get("token") || "";
    username = u.searchParams.get("username") || "";
    if (u.protocol === "https:") origin = u.origin;
  } catch {
    const tm = String(gameUrl || "").match(/[?&]token=([^&#]+)/i);
    const um = String(gameUrl || "").match(/[?&]username=([^&#]+)/i);
    if (tm) token = decodeURIComponent(tm[1]);
    if (um) username = decodeURIComponent(um[1]);
  }
  return { token: String(token || "").trim(), username: String(username || "").trim(), origin };
}

export function countResults(results: SaRoadResult[]) {
  let banker = 0;
  let player = 0;
  let tie = 0;
  for (const r of results) {
    if (r === "莊") banker++;
    else if (r === "閒") player++;
    else tie++;
  }
  return { banker, player, tie };
}
