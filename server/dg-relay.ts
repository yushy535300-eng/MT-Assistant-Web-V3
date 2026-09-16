import tls, { type TLSSocket } from "node:tls";
import { createCipheriv, createHash, randomBytes } from "node:crypto";

export type DgRoadResult = "莊" | "閒" | "和";
export type DgTableSnapshot = {
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
  results: DgRoadResult[];
  trend: string;
  live?: boolean;
  dealerPhoto?: string;
  streamUrl?: string;
  lastUpdated?: number;
  lastResultKey?: string;
  poker?: string;
};

type RelayStatus = "idle" | "connecting" | "connected" | "error" | "closed";
type PublicBean = {
  cmd?: number;
  token?: string;
  codeId?: number;
  lobbyId?: number;
  gameNo?: string;
  tableId?: number;
  seat?: number;
  mid?: number;
  type?: number;
  userName?: string;
  list?: string[];
  object?: string;
  table?: DgRawTable[];
};
type DgRawDealer = { id?: number; name?: string; no?: string; photo?: string; gender?: number; online?: boolean; tableId?: number; state?: number; type?: number };
type DgRawTable = {
  tableId?: number; shoeId?: number; playId?: number; state?: number; countDown?: number;
  result?: string; poker?: string; tel?: string[]; ext?: string[]; roads?: string[]; gameNo?: string;
  fms?: string; tableName?: string; vipName?: string; totalAmount?: number; onlineCount?: number;
  dealer?: DgRawDealer; gameId?: number; anchor?: DgRawDealer;
};

type SseClient = { write: (chunk: string) => unknown };

const WS_KEY_TEXT = "63dwReOhAlDbUoXiMFyZPgSvQc4JnTr7La0EjWf3Cu6NzBt9Ks1HxGq2Rd8Ym5Vp".split("").reverse().join("");
const WS_KEY_24 = Buffer.from(WS_KEY_TEXT.slice(0, 24), "utf8");
const DEFAULT_DG_WS = "wss://appatw.kindlestone.com";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function encrypt3Des(plain: string) {
  const cipher = createCipheriv("des-ede3", WS_KEY_24, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(Buffer.from(plain, "utf8")), cipher.final()]).toString("base64");
}

function extractToken(gameUrl: string) {
  try { return new URL(gameUrl).searchParams.get("token") || ""; }
  catch { return String(gameUrl || "").match(/[?&]token=([^&#]+)/i)?.[1] ? decodeURIComponent(String(gameUrl).match(/[?&]token=([^&#]+)/i)![1]) : ""; }
}

function n(value: bigint | number | undefined | null) {
  if (typeof value === "bigint") return Number(value);
  const x = Number(value ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function readVarint(buf: Buffer, start: number) {
  let value = 0n, shift = 0n, offset = start;
  while (offset < buf.length) {
    const b = buf[offset++]!;
    value |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value, offset };
    shift += 7n;
    if (shift > 70n) throw new Error("invalid varint");
  }
  throw new Error("truncated varint");
}

function readLength(buf: Buffer, offset: number) {
  const len = readVarint(buf, offset);
  const size = Number(len.value);
  const end = len.offset + size;
  if (!Number.isSafeInteger(size) || end > buf.length) throw new Error("invalid length");
  return { start: len.offset, end, offset: end };
}

function skipField(buf: Buffer, offset: number, wire: number) {
  if (wire === 0) return readVarint(buf, offset).offset;
  if (wire === 1) return Math.min(buf.length, offset + 8);
  if (wire === 2) return readLength(buf, offset).offset;
  if (wire === 5) return Math.min(buf.length, offset + 4);
  throw new Error(`unsupported wire ${wire}`);
}

function parseDealer(buf: Buffer): DgRawDealer {
  const out: DgRawDealer = {};
  let o = 0;
  while (o < buf.length) {
    const key = readVarint(buf, o); o = key.offset;
    const field = Number(key.value >> 3n), wire = Number(key.value & 7n);
    if (wire === 0) {
      const v = readVarint(buf, o); o = v.offset;
      if (field === 1) out.id = n(v.value); else if (field === 5) out.gender = n(v.value); else if (field === 6) out.online = v.value !== 0n; else if (field === 7) out.tableId = n(v.value); else if (field === 8) out.state = n(v.value); else if (field === 9) out.type = n(v.value);
    } else if (wire === 2) {
      const s = readLength(buf, o); o = s.offset; const text = buf.subarray(s.start, s.end).toString("utf8");
      if (field === 2) out.name = text; else if (field === 3) out.no = text; else if (field === 4) out.photo = text;
    } else o = skipField(buf, o, wire);
  }
  return out;
}

function parseTable(buf: Buffer): DgRawTable {
  const out: DgRawTable = { tel: [], ext: [], roads: [] };
  let o = 0;
  while (o < buf.length) {
    const key = readVarint(buf, o); o = key.offset;
    const field = Number(key.value >> 3n), wire = Number(key.value & 7n);
    if (wire === 0) {
      const v = readVarint(buf, o); o = v.offset;
      if (field === 1) out.tableId = n(v.value); else if (field === 2) out.shoeId = n(v.value); else if (field === 3) out.playId = n(v.value); else if (field === 4) out.state = n(v.value); else if (field === 5) out.countDown = n(v.value); else if (field === 15) out.totalAmount = n(v.value); else if (field === 16) out.onlineCount = n(v.value); else if (field === 18) out.gameId = n(v.value);
    } else if (wire === 2) {
      const s = readLength(buf, o); o = s.offset; const part = buf.subarray(s.start, s.end);
      if (field === 6) out.result = part.toString("utf8");
      else if (field === 7) out.poker = part.toString("utf8");
      else if (field === 8) out.tel!.push(part.toString("utf8"));
      else if (field === 9) out.ext!.push(part.toString("utf8"));
      else if (field === 10) out.roads!.push(part.toString("utf8"));
      else if (field === 11) out.gameNo = part.toString("utf8");
      else if (field === 12) out.fms = part.toString("utf8");
      else if (field === 13) out.tableName = part.toString("utf8");
      else if (field === 14) out.vipName = part.toString("utf8");
      else if (field === 17) out.dealer = parseDealer(part);
      else if (field === 19) out.anchor = parseDealer(part);
    } else o = skipField(buf, o, wire);
  }
  return out;
}

function parsePublicBean(buf: Buffer): PublicBean {
  const out: PublicBean = { list: [], table: [] };
  let o = 0;
  while (o < buf.length) {
    const key = readVarint(buf, o); o = key.offset;
    const field = Number(key.value >> 3n), wire = Number(key.value & 7n);
    if (wire === 0) {
      const v = readVarint(buf, o); o = v.offset;
      if (field === 1) out.cmd = n(v.value); else if (field === 3) out.codeId = n(v.value); else if (field === 4) out.lobbyId = n(v.value); else if (field === 6) out.tableId = n(v.value); else if (field === 7) out.seat = n(v.value); else if (field === 8) out.mid = n(v.value); else if (field === 10) out.type = n(v.value);
    } else if (wire === 2) {
      const s = readLength(buf, o); o = s.offset; const part = buf.subarray(s.start, s.end);
      if (field === 2) out.token = part.toString("utf8");
      else if (field === 5) out.gameNo = part.toString("utf8");
      else if (field === 11) out.userName = part.toString("utf8");
      else if (field === 12) out.list!.push(part.toString("utf8"));
      else if (field === 14) out.object = part.toString("utf8");
      else if (field === 17) out.table!.push(parseTable(part));
    } else o = skipField(buf, o, wire);
  }
  return out;
}

function varint(value: number | bigint) {
  let v = typeof value === "bigint" ? value : BigInt(Math.max(0, Math.trunc(value)));
  const bytes: number[] = [];
  do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; bytes.push(b); } while (v);
  return Buffer.from(bytes);
}
function fieldVarint(field: number, value: number | bigint) { return Buffer.concat([varint((field << 3) | 0), varint(value)]); }
function fieldString(field: number, value: string) { const b = Buffer.from(value, "utf8"); return Buffer.concat([varint((field << 3) | 2), varint(b.length), b]); }
function encodePublicBean(cmd: number, encryptedToken: string, extra: { lobbyId?: number; gameNo?: string; tableId?: number; seat?: number; mid?: number; type?: number; object?: string } = {}) {
  const parts: Buffer[] = [fieldVarint(1, cmd), fieldString(2, encryptedToken)];
  if (extra.lobbyId != null) parts.push(fieldVarint(4, extra.lobbyId));
  if (extra.gameNo) parts.push(fieldString(5, extra.gameNo));
  if (extra.tableId != null) parts.push(fieldVarint(6, extra.tableId));
  if (extra.seat != null && extra.seat >= 0) parts.push(fieldVarint(7, extra.seat));
  if (extra.mid != null) parts.push(fieldVarint(8, extra.mid));
  if (extra.type != null) parts.push(fieldVarint(10, extra.type));
  if (extra.object != null) parts.push(fieldString(14, extra.object));
  return Buffer.concat(parts);
}

function roadResult(raw: string): DgRoadResult | null {
  const parts = String(raw || "").split("#");
  const code = Number(parts[1] ?? parts[0]);
  if (!Number.isFinite(code) || code <= 0) return null;
  const base = code % 4;
  if (base === 1) return "閒";
  if (base === 2) return "莊";
  if (base === 3) return "和";
  return null;
}
function parseRoads(roads: string[] | undefined) { return (roads || []).map(roadResult).filter((x): x is DgRoadResult => !!x); }
function countResults(results: DgRoadResult[]) { let banker = 0, player = 0, tie = 0; for (const r of results) r === "莊" ? banker++ : r === "閒" ? player++ : tie++; return { banker, player, tie }; }
function tableSort(a: DgTableSnapshot, b: DgTableSnapshot) { const an = Number(a.apiId.replace(/\D/g, "")), bn = Number(b.apiId.replace(/\D/g, "")); return an - bn || a.apiId.localeCompare(b.apiId); }

class RawWsClient {
  private socket: TLSSocket | null = null;
  private buffer = Buffer.alloc(0);
  private handshakeDone = false;
  private fragments: Buffer[] = [];
  private fragmentOpcode = 0;
  private closed = false;
  private closeReported = false;
  constructor(private url: string, private origin: string, private onBinary: (data: Buffer) => void, private onOpen: () => void, private onClose: (why: string) => void) {}
  connect() {
    const u = new URL(this.url); const host = u.hostname; const port = Number(u.port || 443); const path = `${u.pathname || "/"}${u.search}`;
    const key = randomBytes(16).toString("base64");
    const expected = createHash("sha1").update(key + WS_GUID).digest("base64");
    const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: true }); this.socket = sock;
    const timeout = setTimeout(() => { try { sock.destroy(new Error("DG WebSocket 連線逾時")); } catch {} }, 12000);
    sock.once("secureConnect", () => {
      const req = [
        `GET ${path} HTTP/1.1`, `Host: ${host}${port === 443 ? "" : `:${port}`}`, "Upgrade: websocket", "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`, "Sec-WebSocket-Version: 13", `Origin: ${this.origin}`,
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/135 Safari/537.36", "Accept-Language: zh-TW,zh;q=0.9", "Pragma: no-cache", "Cache-Control: no-cache", "", ""
      ].join("\r\n");
      sock.write(req);
    });
    sock.on("data", chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (!this.handshakeDone) {
        const idx = this.buffer.indexOf("\r\n\r\n"); if (idx < 0) return;
        const header = this.buffer.subarray(0, idx).toString("utf8"); this.buffer = this.buffer.subarray(idx + 4);
        if (!/^HTTP\/1\.[01] 101\b/m.test(header)) { sock.destroy(new Error(`DG WebSocket 握手失敗：${header.split("\r\n")[0] || "unknown"}`)); return; }
        const accept = header.match(/^sec-websocket-accept:\s*(.+)$/im)?.[1]?.trim(); if (accept && accept !== expected) { sock.destroy(new Error("DG WebSocket 握手驗證失敗")); return; }
        clearTimeout(timeout); this.handshakeDone = true; this.onOpen();
      }
      if (this.handshakeDone) this.consumeFrames();
    });
    const reportClose = (why: string) => {
      if (this.closed || this.closeReported) return;
      this.closeReported = true;
      this.onClose(why);
    };
    sock.on("error", err => reportClose(err.message || "socket error"));
    sock.on("close", () => { clearTimeout(timeout); reportClose("closed"); });
  }
  private frame(opcode: number, payload: Buffer) {
    const mask = randomBytes(4); let head: Buffer;
    if (payload.length < 126) head = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
    else if (payload.length <= 0xffff) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 0x80 | 126; head.writeUInt16BE(payload.length, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(payload.length), 2); }
    const body = Buffer.alloc(payload.length); for (let i = 0; i < payload.length; i++) body[i] = payload[i]! ^ mask[i % 4]!;
    return Buffer.concat([head, mask, body]);
  }
  sendBinary(payload: Buffer) { if (this.socket && this.handshakeDone && !this.socket.destroyed) this.socket.write(this.frame(2, payload)); }
  private sendPong(payload: Buffer) { if (this.socket && this.handshakeDone && !this.socket.destroyed) this.socket.write(this.frame(10, payload)); }
  private consumeFrames() {
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0]!, b1 = this.buffer[1]!; const fin = !!(b0 & 0x80), opcode = b0 & 0x0f, masked = !!(b1 & 0x80); let len = b1 & 0x7f, pos = 2;
      if (len === 126) { if (this.buffer.length < 4) return; len = this.buffer.readUInt16BE(2); pos = 4; }
      else if (len === 127) { if (this.buffer.length < 10) return; const big = this.buffer.readBigUInt64BE(2); if (big > BigInt(Number.MAX_SAFE_INTEGER)) { this.close(); return; } len = Number(big); pos = 10; }
      const maskBytes = masked ? 4 : 0; if (this.buffer.length < pos + maskBytes + len) return;
      let payload = Buffer.from(this.buffer.subarray(pos + maskBytes, pos + maskBytes + len));
      if (masked) { const m = this.buffer.subarray(pos, pos + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i % 4]!; }
      this.buffer = this.buffer.subarray(pos + maskBytes + len);
      if (opcode === 8) { this.close(); return; }
      if (opcode === 9) { this.sendPong(payload); continue; }
      if (opcode === 10) continue;
      if (opcode === 0) { this.fragments.push(payload); if (fin) { const full = Buffer.concat(this.fragments); const op = this.fragmentOpcode; this.fragments = []; this.fragmentOpcode = 0; if (op === 2) this.onBinary(full); } continue; }
      if (!fin) { this.fragmentOpcode = opcode; this.fragments = [payload]; continue; }
      if (opcode === 2) this.onBinary(payload);
    }
  }
  close() { this.closed = true; try { this.socket?.end(this.frame(8, Buffer.alloc(0))); } catch {} try { this.socket?.destroy(); } catch {} this.socket = null; }
}

export class DgRelay {
  private token: string;
  private origin: string;
  private wsUrl = DEFAULT_DG_WS;
  private wsCandidates: string[] = [DEFAULT_DG_WS];
  private wsCandidateIndex = 0;
  private gameBasePath = "/ddnewpc";
  private ws: RawWsClient | null = null;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private clients = new Set<SseClient>();
  private map = new Map<number, DgTableSnapshot>();
  private status: RelayStatus = "idle";
  private statusMessage = "待命";
  private initialVideoRequested = new Set<number>();
  constructor(public readonly sessionId: string, public readonly gameUrl: string) {
    this.token = extractToken(gameUrl);
    this.origin = (() => { try { return new URL(gameUrl).origin; } catch { return "https://new-dd-cn.dingdangmail.com"; } })();
    try {
      const u = new URL(gameUrl);
      const m = u.pathname.match(/^(.*?\/ddnewpc)(?:\/|$)/i);
      if (m?.[1]) this.gameBasePath = m[1].replace(/\/$/, "");
    } catch {}
    if (!this.token) throw new Error("DG 授權網址缺少 token");
  }
  async start() {
    try {
      const cfg = await fetch(`${this.origin}${this.gameBasePath}/game_settings.json?v=${Date.now()}`, { headers: { Accept: "application/json", Referer: this.gameUrl, "User-Agent": "Mozilla/5.0 Chrome/135 Safari/537.36" }, signal: AbortSignal.timeout(7000) });
      if (cfg.ok) {
        const json: any = await cfg.json();
        const pc = json?.pc_h5 || {};
        const rawCandidates = [
          // Render/雲端機房連台灣專線有時會被上游 503，先嘗試通用/海外線，再回退台灣線與備援線。
          process.env.DG_WS_URL,
          pc.game_wss_overseas, pc.game_wss, pc.game_wss_cn,
          pc.game_wss_tw, pc.game_wss_line2, pc.game_wss_line3, pc.game_wss_line4,
          DEFAULT_DG_WS,
        ].map((v:any)=>String(v||"").trim()).filter(Boolean);
        const validated: string[] = [];
        for (const candidate of rawCandidates) {
          try {
            const parsed = new URL(candidate);
            const allowed = parsed.protocol === "wss:" && /(?:^|\.)(?:kindlestone\.com|taxyss\.com|ywjxi\.com)$/i.test(parsed.hostname);
            const normalized = candidate.replace(/\/$/, "");
            if (allowed && !validated.includes(normalized)) validated.push(normalized);
          } catch {}
        }
        this.wsCandidates = validated.length ? validated : [DEFAULT_DG_WS];
        this.wsCandidateIndex = 0;
        this.wsUrl = this.wsCandidates[0]!;
      }
    } catch {
      this.wsCandidates = [DEFAULT_DG_WS];
      this.wsCandidateIndex = 0;
      this.wsUrl = DEFAULT_DG_WS;
    }
    this.open();
  }
  subscribe(client: SseClient) {
    this.clients.add(client);
    this.sendTo(client, "status", { status: this.status, message: this.statusMessage });
    this.sendTo(client, "tables", this.tables());
    return () => this.clients.delete(client);
  }
  private sendTo(client: SseClient, event: string, data: unknown) { try { client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} }
  private broadcast(event: string, data: unknown) { for (const c of this.clients) this.sendTo(c, event, data); }
  private setStatus(status: RelayStatus, message: string) { this.status = status; this.statusMessage = message; this.broadcast("status", { status, message }); }
  private event(message: string) { this.broadcast("event", { message }); }
  private tables() { return [...this.map.values()].sort(tableSort); }
  private emitTables() { this.broadcast("tables", this.tables()); }
  private authToken(cmd: number) { return encrypt3Des(JSON.stringify({ cmd, token: this.token, time: Date.now() })); }
  private send(cmd: number, extra: Parameters<typeof encodePublicBean>[2] = {}) { this.ws?.sendBinary(encodePublicBean(cmd, this.authToken(cmd), extra)); }
  private open() {
    if (this.stopped) return;
    let endpointName = this.wsUrl; try { endpointName = new URL(this.wsUrl).hostname; } catch {}
    this.setStatus("connecting", `連線中 ${endpointName}...`);
    const sign = encrypt3Des(this.token);
    const url = `${this.wsUrl.replace(/\/$/, "")}/?sign=${encodeURIComponent(sign)}`;
    this.ws = new RawWsClient(url, this.origin, data => this.handle(data), () => {
      this.event("DG WebSocket 已建立，正在驗證");
      this.send(10086, { tableId: 1, type: 0, object: "PC" });
    }, why => {
      if (this.stopped) return;
      if (this.keepaliveTimer) clearInterval(this.keepaliveTimer); this.keepaliveTimer = null;
      const canFailover = /(?:HTTP\/1\.[01]\s+(?:502|503|504)|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|連線逾時)/i.test(String(why || ""));
      if (canFailover && this.wsCandidates.length > 1) {
        this.wsCandidateIndex = (this.wsCandidateIndex + 1) % this.wsCandidates.length;
        this.wsUrl = this.wsCandidates[this.wsCandidateIndex]!;
        let host = this.wsUrl; try { host = new URL(this.wsUrl).hostname; } catch {}
        this.setStatus("connecting", `DG 主線暫時不可用，切換備援 ${host}...`);
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.open(), 700);
        return;
      }
      this.setStatus("error", `已中斷，準備重連${why && why !== "closed" ? `：${why}` : ""}`);
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.open(), 2500);
    });
    this.ws.connect();
  }
  private requestVideos() {
    const baccarat = this.tables().filter(t => /^BAC\d+/i.test(t.apiId) || /^TID\d+/i.test(t.apiId));
    baccarat.forEach((t, idx) => {
      const tableId = Number(t.tableBadge); if (!tableId || this.initialVideoRequested.has(tableId)) return;
      this.initialVideoRequested.add(tableId);
      setTimeout(() => { if (!this.stopped) this.send(29, { tableId, type: 1 }); }, 180 + idx * 90);
    });
  }
  private handle(data: Buffer) {
    let bean: PublicBean; try { bean = parsePublicBean(data); } catch { return; }
    const cmd = n(bean.cmd);
    if (cmd === 10086) {
      if (n(bean.codeId) !== 0) { this.setStatus("error", `DG 驗證失敗 (${bean.codeId})`); return; }
      this.setStatus("connected", "已連線"); this.event("DG 驗證完成，正在同步真人桌");
      this.send(45, { type: 1 }); this.send(2, { lobbyId: 5, type: 0 }); this.send(5011, { type: 0 });
      setTimeout(() => { if (!this.stopped) this.send(87, { type: 1 }); }, 80);
      setTimeout(() => { if (!this.stopped) this.send(24, { type: 2 }); }, 120);
      if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = setInterval(() => { if (!this.stopped) this.send(99); }, 20000);
    }
    if (cmd === 29 && bean.tableId && bean.object && /^https?:\/\//i.test(bean.object)) {
      const prev = this.map.get(bean.tableId); if (prev) { this.map.set(bean.tableId, { ...prev, streamUrl: bean.object, lastUpdated: Date.now() }); this.emitTables(); }
    }
    if (cmd === 1004 && bean.tableId && bean.list?.length) {
      const prev = this.map.get(bean.tableId); if (prev) { const results = parseRoads(bean.list); const counts = countResults(results); this.map.set(bean.tableId, { ...prev, results, ...counts, lastUpdated: Date.now(), lastResultKey: `${prev.shoe}:${prev.round}:${results.length}:${results.at(-1) || ""}` }); this.emitTables(); }
    }
    if (bean.table?.length) {
      let changed = false;
      for (const raw of bean.table) {
        const tableId = n(raw.tableId); if (!tableId) continue;
        const prev = this.map.get(tableId);
        const fms = String(raw.fms ?? prev?.apiId ?? "").trim().toUpperCase();
        const gameId = raw.gameId != null ? n(raw.gameId) : undefined;
        if (!prev && gameId !== 1) continue;
        if (!prev && !fms) continue;
        const roads = raw.roads?.length ? raw.roads : undefined;
        const results = roads ? parseRoads(roads) : (prev?.results ?? []);
        const counts = countResults(results);
        const dealer = raw.dealer;
        const dealerPhoto = dealer?.photo ? `${this.origin}/vd/vd/image/Image/dealer/${String(dealer.photo).replace(/^\/+/, "")}` : prev?.dealerPhoto;
        const apiId = fms || prev?.apiId || `DG${tableId}`;
        const shoeNum = raw.shoeId != null ? n(raw.shoeId) : undefined;
        const roundNum = raw.playId != null ? n(raw.playId) : undefined;
        const next: DgTableSnapshot = {
          id: apiId, apiId, game: "百家樂", name: String(dealer?.name ?? prev?.name ?? "—"), players: raw.onlineCount != null ? String(n(raw.onlineCount)) : (prev?.players ?? "—"),
          countdown: raw.countDown != null ? n(raw.countDown) : prev?.countdown, countdownUpdatedAt: raw.countDown != null ? Date.now() : prev?.countdownUpdatedAt,
          roomId: String(raw.tableName ?? prev?.roomId ?? "—"), tableBadge: String(tableId), shoe: shoeNum != null && shoeNum > 0 ? String(shoeNum) : (prev?.shoe ?? "—"),
          round: roundNum ?? prev?.round ?? 0, ...counts, results, trend: prev?.trend ?? "", live: true, dealerPhoto, streamUrl: prev?.streamUrl,
          lastUpdated: Date.now(), lastResultKey: results.length ? `${shoeNum ?? prev?.shoe ?? "—"}:${roundNum ?? prev?.round ?? 0}:${results.length}:${results.at(-1)}` : prev?.lastResultKey,
          poker: raw.poker != null ? String(raw.poker) : prev?.poker,
        };
        this.map.set(tableId, next); changed = true;
      }
      if (changed) { this.emitTables(); if (cmd === 2 || cmd === 44) this.requestVideos(); }
    }
  }
  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer = null;
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer); this.keepaliveTimer = null;
    this.ws?.close(); this.ws = null; this.setStatus("closed", "已停止");
  }
}

const relays = new Map<string, DgRelay>();
export async function startDgRelay(sessionId: string, gameUrl: string) {
  const old = relays.get(sessionId); if (old) old.stop();
  const relay = new DgRelay(sessionId, gameUrl); relays.set(sessionId, relay); await relay.start(); return relay;
}
export function getDgRelay(sessionId: string) { return relays.get(sessionId) || null; }
export function stopDgRelay(sessionId: string) { const r = relays.get(sessionId); if (r) r.stop(); relays.delete(sessionId); }
