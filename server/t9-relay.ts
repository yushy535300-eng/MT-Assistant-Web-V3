import { createCipheriv, createDecipheriv } from "node:crypto";
import { createRequire } from "node:module";
import type { Response } from "express";

const KEY = Buffer.from("cF9Yt7R4DqLqPZmAj3kHU2g8WaCvN5dL", "utf8");
const IV = Buffer.from("Jx9UrmvS3YkWpzE8", "utf8");
const BACCARAT_GAME_TYPE = "80001";
const T9_ORIGIN = "https://g.t9gaming.fun";
const require = createRequire(import.meta.url);
const NodeWebSocket: any = require("ws");

type T9Status = "idle" | "loading" | "connecting" | "connected" | "error" | "closed";

export type T9TableData = {
  id: string;
  apiId: string;
  game: string;
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
  results: Array<"莊" | "閒" | "和">;
  trend: string;
  live?: boolean;
  dealerPhoto?: string;
  streamUrl?: string;
  lastUpdated?: number;
  lastResultKey?: string;
  poker?: string;
  category?: string;
};

type Subscriber = Response;

function decryptFrame(raw: unknown) {
  const input = String(raw ?? "").trim();
  if (!input) return "";
  try {
    const decipher = createDecipheriv("aes-256-cbc", KEY, IV);
    decipher.setAutoPadding(true);
    return Buffer.concat([
      decipher.update(Buffer.from(input, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Some deployments may briefly emit plaintext diagnostics.
    return input;
  }
}

function encryptFrame(text: string) {
  const cipher = createCipheriv("aes-256-cbc", KEY, IV);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(text, "utf8"), cipher.final()]).toString("base64");
}

function t9RoadResult(value: unknown): "莊" | "閒" | "和" | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  // T9's own BaccaratRoadLogic: (history % 100) % 4; 1=banker, 2=player, 3=tie.
  const code = ((Math.trunc(n) % 100) + 100) % 100 % 4;
  if (code === 1) return "莊";
  if (code === 2) return "閒";
  if (code === 3) return "和";
  return null;
}

function parseHistory(raw: unknown) {
  if (!Array.isArray(raw)) return [] as Array<"莊" | "閒" | "和">;
  return raw.map(t9RoadResult).filter((x): x is "莊" | "閒" | "和" => !!x);
}

function countResults(results: Array<"莊" | "閒" | "和">) {
  let banker = 0, player = 0, tie = 0;
  for (const result of results) {
    if (result === "莊") banker++;
    else if (result === "閒") player++;
    else tie++;
  }
  return { banker, player, tie };
}

function normalizePhoto(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  try {
    return new URL(raw, T9_ORIGIN).toString();
  } catch {
    return undefined;
  }
}

function parseT9Card(value: unknown) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw || raw === "UNKNOWN") return null;
  const match = raw.match(/^[SHDC](\d{1,2})$/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 1 || n > 13) return null;
  if (n === 1) return "A";
  if (n === 11) return "J";
  if (n === 12) return "Q";
  if (n === 13) return "K";
  return String(n);
}

function pokerFromGameResult(gameResult: any, previous?: string) {
  if (!gameResult || typeof gameResult !== "object") return previous;
  const player = (Array.isArray(gameResult.PlayerCard) ? gameResult.PlayerCard : [])
    .map(parseT9Card)
    .filter(Boolean);
  const banker = (Array.isArray(gameResult.BankerCard) ? gameResult.BankerCard : [])
    .map(parseT9Card)
    .filter(Boolean);
  if (!player.length && !banker.length) return previous;
  return JSON.stringify({ player: player.join("-"), banker: banker.join("-") });
}

function countdownFrom(raw: any, previous?: number) {
  const status = Number(raw?.GameStatus);
  // Captured T9 baccarat statuses:
  // 100 StartGame / 101 ConfirmBet are betting states.
  // 103 EndBet and all dealing/result/shuffle states are not count-down states.
  const betting = status === 100 || status === 101;
  if (!betting) {
    if ([102,103,104,105,106,107,108,109,110,112].includes(status)) return 0;
    return previous;
  }
  const rawEnd = raw?.EndBetTime;
  let end = Number(rawEnd);
  if (!Number.isFinite(end) || end <= 0) {
    const parsed = Date.parse(String(rawEnd ?? '').replace(' ', 'T'));
    end = Number.isFinite(parsed) ? parsed : NaN;
  }
  if (!Number.isFinite(end) || end <= 0) return previous;
  return Math.max(0, Math.ceil((end - Date.now()) / 1000));
}

function normalizeTable(raw: any, previous?: T9TableData): T9TableData | null {
  const tableId = String(raw?.TableId ?? raw?.TableID ?? previous?.apiId ?? "").trim();
  if (!tableId) return null;
  const results = Array.isArray(raw?.History)
    ? parseHistory(raw.History)
    : previous?.results ?? [];
  const counts = countResults(results);
  const tableName = String(raw?.TableName ?? previous?.tableBadge ?? `T9-${tableId}`).trim();
  const dealerName = String(raw?.DealerName ?? previous?.name ?? "—").trim() || "—";
  const round = Array.isArray(raw?.History)
    ? results.length + 1
    : previous?.round ?? Math.max(0, Number(raw?.RoundId) || 0);
  // T9 does not expose a separate shoe id in the captured baccarat payload; use
  // the table's rolling road session as a stable display value until shuffle clears History.
  const shoe = String(raw?.ShoeId ?? raw?.ShoeID ?? previous?.shoe ?? "—");
  const playersRaw = raw?.PlayerCount ?? raw?.OnlineCount ?? raw?.MemberCount;
  const players = playersRaw != null ? String(playersRaw) : previous?.players ?? "—";
  const poker = pokerFromGameResult(raw?.GameResult, previous?.poker);
  const last = results.at(-1);
  return {
    id: tableName,
    apiId: tableId,
    game: "百家樂",
    name: dealerName,
    players,
    countdown: countdownFrom(raw, previous?.countdown),
    countdownUpdatedAt: raw?.EndBetTime != null ? Date.now() : previous?.countdownUpdatedAt,
    roomId: tableName,
    tableBadge: tableName,
    shoe,
    round,
    banker: counts.banker,
    player: counts.player,
    tie: counts.tie,
    results,
    trend: String(raw?.GroupName ?? raw?.TableTypeName ?? previous?.trend ?? "T9 真人百家樂"),
    live: Number(raw?.GameStatus) !== 105,
    dealerPhoto: normalizePhoto(raw?.DealerPhotoUrl) ?? previous?.dealerPhoto,
    streamUrl: normalizePhoto(raw?.VideoPath ?? raw?.VideoUrl) ?? previous?.streamUrl,
    lastUpdated: Date.now(),
    lastResultKey: last ? `${round}:${results.length}:${last}` : previous?.lastResultKey,
    poker,
    category: String(raw?.GroupId ?? raw?.GroupName ?? previous?.category ?? "T9"),
  };
}

function sortTables(tables: T9TableData[]) {
  return [...tables].sort((a, b) => {
    const an = Number(String(a.tableBadge || a.id).match(/\d+/)?.[0] || Number.MAX_SAFE_INTEGER);
    const bn = Number(String(b.tableBadge || b.id).match(/\d+/)?.[0] || Number.MAX_SAFE_INTEGER);
    return an - bn || String(a.tableBadge || a.id).localeCompare(String(b.tableBadge || b.id));
  });
}

function makeT9SerialNumber() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function safeT9GameUrl(raw: string) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !(host === "g.t9gaming.fun" || host.endsWith(".t9gaming.fun")))
    throw new Error("invalid_t9_url");
  const customToken = url.searchParams.get("customToken") || url.searchParams.get("token") || "";
  if (!customToken) throw new Error("t9_custom_token_missing");
  return { url, customToken };
}

function sse(res: Response, event: string, data: unknown) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {}
}

class T9Relay {
  private status: T9Status = "idle";
  private message = "T9 尚未連線";
  private ws: any = null;
  private tables = new Map<string, T9TableData>();
  private subscribers = new Set<Subscriber>();
  private closed = false;
  private lastUsed = Date.now();
  private gameUrl = "";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private loginData: any = null;
  private initialized = false;
  private bridge = false;
  private mirrorIngestLogged = false;

  constructor(public readonly sessionId: string) {}

  getStatus() { return this.status; }
  isReusable() {
    return (
      !this.closed &&
      this.status !== "error" &&
      this.status !== "closed"
    );
  }
  getLastUsed() { return this.lastUsed; }
  touch() { this.lastUsed = Date.now(); }

  private setStatus(status: T9Status, message: string) {
    this.status = status;
    this.message = message;
    this.touch();
    for (const res of this.subscribers) sse(res, "status", { status, message });
  }

  private emitTables() {
    const snapshot = sortTables([...this.tables.values()]);
    for (const res of this.subscribers) sse(res, "tables", snapshot);
  }

  private emitEvent(message: string) {
    for (const res of this.subscribers) sse(res, "event", { message });
  }

  subscribe(res: Response) {
    this.touch();
    this.subscribers.add(res);
    sse(res, "status", { status: this.status, message: this.message });
    sse(res, "tables", sortTables([...this.tables.values()]));
    return () => this.subscribers.delete(res);
  }

  private patchTable(raw: any) {
    const id = String(raw?.TableId ?? raw?.TableID ?? "").trim();
    if (!id) return;
    const previous = this.tables.get(id);
    const next = normalizeTable(raw, previous);
    if (!next) return;
    this.tables.set(id, next);
  }

  private sendPacket(opCode: string, data: any = {}) {
    const ws = this.ws;
    if (!ws || ws.readyState !== NodeWebSocket.OPEN || !this.loginData) return false;
    const packet = {
      OpCode: opCode,
      Data: data,
      Token: String(this.loginData.Token ?? ""),
    };
    try {
      ws.send(encryptFrame(JSON.stringify(packet)));
      return true;
    } catch {
      return false;
    }
  }

  private sendSyncTime() {
    return this.sendPacket("SyncTime", { GameType: BACCARAT_GAME_TYPE });
  }

  private sendSyncBalance() {
    return this.sendPacket("SyncBalance", {
      GameType: BACCARAT_GAME_TYPE,
      AgentId: String(this.loginData?.AgentId ?? ""),
      MemberName: String(this.loginData?.MemberName ?? ""),
    });
  }

  private startHeartbeat() {
    if (this.syncTimer) clearInterval(this.syncTimer);

    // Match captured T9 browser behaviour: application-level SyncTime about
    // every 30 seconds. Do not add Node websocket control pings that the
    // browser itself does not send.
    this.syncTimer = setInterval(() => {
      if (this.closed) return;
      this.sendSyncTime();
    }, 30000);
  }

  private stopHeartbeat() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
  }

  private handleMessage(payload: any) {
    const opcode = String(payload?.Opcode ?? payload?.OpCode ?? "");
    const data = payload?.Data ?? payload?.data ?? {};
    if (opcode === "Login") {
      const list = Array.isArray(data?.TableList) ? data.TableList : [];
      for (const raw of list) this.patchTable(raw);

      // Browser sequence captured from T9:
      // Login -> Login response -> SyncTime -> SyncTableStatus/Info
      // and SyncBalance during initialization.
      if (!this.initialized) {
        this.initialized = true;
        if (!this.bridge) {
          this.sendSyncTime();
          setTimeout(() => {
            if (!this.closed && this.initialized && !this.bridge)
              this.sendSyncBalance();
          }, 250);
          this.startHeartbeat();
          this.emitEvent("T9 Login 完成 · 已送出 SyncTime");
        } else {
          this.emitEvent("T9 單工作階段已接管 · 主頁與懸浮共用遊戲即時資料");
        }
      }

      this.setStatus("connected", `T9 已連線 · ${this.tables.size} 桌`);
      this.emitTables();
      return;
    }
    if (Array.isArray(data?.TableList)) {
      for (const raw of data.TableList) this.patchTable(raw);
      this.emitTables();
      return;
    }
    if (data?.TableId != null || data?.TableID != null) {
      this.patchTable(data);
      this.emitTables();
      return;
    }
    // Some opcodes wrap the table payload one level deeper.
    if (data?.TableInfo?.TableId != null) {
      this.patchTable(data.TableInfo);
      this.emitTables();
    }
  }

  isForegroundBridgeActive() {
    return this.bridge;
  }

  adoptLaunchUrl(gameUrl: string) {
    if (gameUrl) this.gameUrl = gameUrl;
    this.touch();
  }

  /** Feed one encrypted T9 application payload mirrored from the game iframe. */
  ingestApplicationPacket(raw: Buffer | string) {
    this.touch();
    let value: any = raw;
    if (Buffer.isBuffer(value)) value = value.toString("utf8");
    else value = String(value ?? "");
    const decoded = decryptFrame(value);
    try {
      const payload = JSON.parse(decoded);
      if (this.bridge && this.status !== "connected")
        this.setStatus("connected", `T9 遊戲內即時資料已接通 · ${this.tables.size} 桌`);
      if (this.bridge && !this.mirrorIngestLogged) {
        this.mirrorIngestLogged = true;
        this.emitEvent("T9 遊戲內 WebSocket 已鏡像 · 主頁/懸浮不再另行登入");
      }
      this.handleMessage(payload);
    } catch {}
  }

  enterBridgeMode(gameUrl?: string) {
    if (gameUrl) this.adoptLaunchUrl(gameUrl);
    this.bridge = true;
    this.closed = false;
    this.mirrorIngestLogged = false;
    this.stopHeartbeat();
    this.initialized = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch {}
    if (this.tables.size)
      this.setStatus("connected", `T9 單工作階段切換中 · ${this.tables.size} 桌`);
    else
      this.setStatus("connecting", "等待 T9 遊戲內即時資料...");
    this.emitEvent("T9 背景登入已停止 · 前景遊戲成為唯一 T9 工作階段");
  }

  async leaveBridgeMode(opts?: { restore?: boolean }) {
    if (!this.bridge) return;
    this.bridge = false;
    this.mirrorIngestLogged = false;
    this.initialized = false;
    this.stopHeartbeat();
    if (opts?.restore === false) {
      if (this.tables.size)
        this.setStatus("connected", `T9 快取保留 · ${this.tables.size} 桌`);
      return;
    }
    if (this.gameUrl) {
      this.setStatus("connecting", "T9 主頁即時資料恢復中...");
      await this.start(this.gameUrl);
    }
  }

  private async lobbyLogin(gameUrl: string) {
    const { url, customToken } = safeT9GameUrl(gameUrl);
    const merchant = url.searchParams.get("merchant") || "_T9";
    const language = (url.searchParams.get("language") || "tw").toLowerCase() === "tw" ? "TW" : "TW";
    const response = await fetch(`${url.origin}/api/Lobby/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/plain, */*",
        origin: url.origin,
        referer: url.toString(),
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/135 Safari/537.36",
      },
      body: JSON.stringify({
        Language: language,
        Token: customToken,
        Merchant: merchant,
        SerialNumber: makeT9SerialNumber(),
        Device: 2,
        ForceMode: 0,
      }),
      redirect: "follow",
    });
    const text = await response.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch {}
    const data = parsed?.Data ?? parsed?.data;
    if (!response.ok || !data?.Token || !data?.ConnectId)
      throw new Error(String(parsed?.Message ?? parsed?.message ?? `T9 lobby login failed (${response.status})`));
    return { origin: url.origin, data };
  }

  async start(gameUrl: string) {
    this.touch();
    this.gameUrl = gameUrl;
    this.closed = false;
    if (this.bridge) return;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    this.setStatus("loading", "正在取得 T9 即時授權");
    const login = await this.lobbyLogin(gameUrl);
    this.loginData = login.data;
    const connectId = String(login.data.ConnectId || "").trim();
    if (!connectId) throw new Error("t9_connect_id_missing");

    // T9 Lobby/login already returns the complete socket path suffix, including
    // its leading slash and member suffix (e.g. /abc..._2123033). Use it exactly
    // as returned. Encoding the leading slash as %2F causes HTTP 200 instead of
    // 101 Switching Protocols.
    const socketConnectId = connectId.startsWith("/") ? connectId : `/${connectId}`;
    const wsUrl =
      `${login.origin.replace(/^http/, "ws")}/api/baccarat` + socketConnectId;

    this.stopHeartbeat();
    this.initialized = false;
    this.setStatus("connecting", "T9 百家樂即時資料連線中...");
    this.emitEvent(`T9 WebSocket connecting · ${socketConnectId}`);

    // Use the Node `ws` client instead of globalThis.WebSocket so the server-side
    // handshake matches the successful Chrome request captured from T9.
    const ws = new NodeWebSocket(wsUrl, {
      origin: login.origin,
      handshakeTimeout: 12000,
      perMessageDeflate: true,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        "Accept-Language": "zh-TW,zh;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
    this.ws = ws;

    ws.on("open", () => {
      if (this.closed || this.ws !== ws) return;
      const loginPacket = {
        OpCode: "Login",
        Data: {
          AgentId: String(login.data.AgentId ?? ""),
          MemberName: String(login.data.MemberName ?? ""),
          AccountType: String(login.data.AccountType ?? login.data.WalletType ?? "1"),
          Password: "",
          GameType: BACCARAT_GAME_TYPE,
          GetBroadCast: "1",
        },
        Token: String(login.data.Token),
      };
      ws.send(encryptFrame(JSON.stringify(loginPacket)));
      this.emitEvent("T9 WebSocket 101 已建立，正在同步百家樂桌");
    });

    ws.on("message", (raw: any) => {
      if (this.closed || this.ws !== ws) return;
      this.touch();
      let payload = raw;
      if (Buffer.isBuffer(payload)) payload = payload.toString("utf8");
      else if (payload instanceof ArrayBuffer) payload = Buffer.from(payload).toString("utf8");
      else if (ArrayBuffer.isView(payload))
        payload = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).toString("utf8");
      const decoded = decryptFrame(payload);
      try {
        this.handleMessage(JSON.parse(decoded));
      } catch {
        // Do not turn one malformed frame into a disconnected relay.
      }
    });

    ws.on("unexpected-response", (_req: any, res: any) => {
      if (this.closed || this.ws !== ws) return;
      const status = Number(res?.statusCode || 0);
      const statusText = String(res?.statusMessage || "").trim();
      this.emitEvent(`T9 WebSocket handshake ${status || "?"} ${statusText}`.trim());
      this.setStatus(
        "error",
        status === 200
          ? "T9 WebSocket 路徑未升級 (200)，請重新授權"
          : `T9 WebSocket 握手失敗${status ? ` (${status})` : ""}`,
      );
      try { ws.close(); } catch {}
    });

    ws.on("error", (error: any) => {
      if (this.closed || this.ws !== ws) return;
      const detail = String(error?.message || error?.code || "unknown error");
      this.setStatus("error", `T9 WebSocket 連線失敗：${detail}`);
      this.emitEvent(`T9 WebSocket error · ${detail}`);
      try { ws.close(); } catch {}
    });

    ws.on("close", (code: number, reasonBuffer: Buffer) => {
      if (this.ws === ws) this.ws = null;
      this.stopHeartbeat();
      this.initialized = false;
      if (this.closed) return;
      const reason = Buffer.isBuffer(reasonBuffer)
        ? reasonBuffer.toString("utf8")
        : String(reasonBuffer || "");
      this.emitEvent(`T9 WebSocket closed · ${code}${reason ? ` · ${reason}` : ""}`);
      this.setStatus("connecting", `T9 即時通道重新連線中 (${code})...`);
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        void this.start(this.gameUrl).catch((e) => {
          this.setStatus("error", String(e?.message || "T9 reconnect failed"));
        });
      }, 2200);
    });
  }

  close() {
    this.closed = true;
    this.bridge = false;
    this.stopHeartbeat();
    this.initialized = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch {}
    this.setStatus("closed", "T9 已停止連線");
  }
}

const relays = new Map<string, T9Relay>();

export function ensureT9RelayShell(sessionId: string, gameUrl: string) {
  const existing = relays.get(sessionId);
  if (existing && existing.getStatus() !== "closed") {
    existing.adoptLaunchUrl(gameUrl);
    return existing;
  }
  if (existing) {
    try { existing.close(); } catch {}
    relays.delete(sessionId);
  }
  const relay = new T9Relay(sessionId);
  relay.adoptLaunchUrl(gameUrl);
  relays.set(sessionId, relay);
  return relay;
}

export async function startT9Relay(sessionId: string, gameUrl: string) {
  let relay = relays.get(sessionId);
  let reused = !!relay;

  // A failed relay must never survive a manual "重新連線". Otherwise /api/t9/start
  // keeps returning reused:true,status:error and the user is permanently stuck.
  if (relay && !relay.isReusable()) {
    try { relay.close(); } catch {}
    relays.delete(sessionId);
    relay = null;
    reused = false;
  }

  if (!relay) {
    relay = new T9Relay(sessionId);
    relays.set(sessionId, relay);
  }

  try {
    await relay.start(gameUrl);
    return { relay, reused };
  } catch (error) {
    try { relay.close(); } catch {}
    relays.delete(sessionId);
    throw error;
  }
}

export function getT9Relay(sessionId: string) { return relays.get(sessionId) || null; }
export function stopT9Relay(sessionId: string) {
  const relay = relays.get(sessionId);
  if (!relay) return;
  relay.close();
  relays.delete(sessionId);
}
export function sweepIdleT9Relays(maxIdleMs = 180000) {
  let stopped = 0;
  const now = Date.now();
  for (const [id, relay] of relays) {
    if (now - relay.getLastUsed() <= maxIdleMs) continue;
    relay.close();
    relays.delete(id);
    stopped++;
  }
  return { stopped, active: relays.size };
}
