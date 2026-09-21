/**
 * SA lobby road relay — connects to connect2explorer WSS with the TZ/SALI
 * launch token, parses InitBaccarat / GameResult / AnchorLogin, and streams
 * table snapshots over SSE (same pattern as dg-relay).
 */
import {
  SA_CMD,
  SA_DEFAULT_WS,
  SA_GAME_TYPE_BACCARAT,
  buildCsAck,
  buildPsLogin,
  buildRequestInitClient,
  countResults,
  extractSaAuth,
  isSaTableModeOpen,
  parseFrame,
  parseAllFrames,
  parseScAnchorLogin,
  parseScGameRest,
  parseScGameResult,
  parseScGameStart,
  parseScGameState,
  parseScInitBaccarat,
  parseScInitNewBaccarat,
  parseSpHostList,
  parseSpLogin,
  mergeSaInitRound,
  nextSaRoundAfterHand,
  shoeRoundFromGameCount,
  type SaRoadResult,
} from "./sa-protocol";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SA_TABLE_LABELS: Record<string, string> = (() => {
  const candidates = [
    join(process.cwd(), "server/sa-table-labels.json"),
    join(dirname(fileURLToPath(import.meta.url)), "sa-table-labels.json"),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8");
      const json = JSON.parse(raw);
      if (json?.labels && typeof json.labels === "object")
        return json.labels as Record<string, string>;
    } catch {}
  }
  return {};
})();

function saDisplayName(hostId: number) {
  const key = String(hostId);
  // Prefer official D01/C01 short codes from sa-table-labels.json.
  return SA_TABLE_LABELS[key] || key;
}

/** Official SA room cover CDN — `{hostId}.jpg` (HAR: thumbnail.rivetlabs.net). */
export function saHostCoverUrl(hostId: number) {
  const id = Number(hostId);
  if (!Number.isFinite(id) || id <= 0) return undefined;
  // Same-origin proxy so the card <img> always loads (CDN hotlink/CORS can blank).
  return `/api/sa/thumb/${id}`;
}

/**
 * Betting countdown only (官方大廳綠/紅倒數約 1–60 秒).
 * Reject ms / garbage u32 values like 19950 that are NOT 下注倒數.
 */
export function saBettingCountdown(...candidates: number[]) {
  for (const raw of candidates) {
    const n = Math.floor(Number(raw));
    if (Number.isFinite(n) && n >= 1 && n <= 60) return n;
  }
  return 0;
}

export type SaTableSnapshot = {
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
  results: SaRoadResult[];
  trend: string;
  live?: boolean;
  open?: boolean;
  rest?: number;
  dealerPhoto?: string;
  streamUrl?: string;
  lastUpdated?: number;
  lastResultKey?: string;
  poker?: string;
};


/**
 * Live GameResult push for SA 輸贏報表 only.
 * Emitted on new road outcomes — never Init history snapshots.
 */
export type SaWinReportResult = {
  tableId: string;
  apiId: string;
  tableBadge: string;
  roomId: string;
  hostId: number;
  road: SaRoadResult;
  gameId: number;
  resultKey: string;
  shoe: string;
  round: number;
  poker?: string;
  at: number;
};

type RelayStatus = "idle" | "connecting" | "connected" | "error" | "closed";
type SseClient = { write: (chunk: string) => unknown };

const DEFAULT_WS_CANDIDATES = [
  SA_DEFAULT_WS,
  "wss://scs01.connect2explorer.com/",
  "wss://scs11.connect2explorer.com/",
];

class SaRelay {
  private ws: WebSocket | null = null;
  private status: RelayStatus = "idle";
  private statusMessage = "";
  private clients = new Set<SseClient>();
  private map = new Map<number, SaTableSnapshot>();
  private gameToHost = new Map<number, number>();
  private hostIds: number[] = [];
  private stopped = false;
  private bridge = false;
  private ackTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEmitAt = 0;
  private token: string;
  private origin: string;
  private username: string;
  private gameUrl: string;
  private lastActivity = Date.now();
  private firstTablesLogged = false;
  private authFailed = false;
  private reconnectAttempt = 0;
  /** Game results / live deals that arrived before Init mapped gameId→host. */
  private pendingResults = new Map<
    number,
    { road?: SaRoadResult; gameId: number; key: string; poker?: string }
  >();
  /** gameId → GameStart gameCount (shoe*10000+round) for float round sync. */
  private gameToCount = new Map<number, number>();
  private initRetryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly sessionId: string,
    gameUrl: string,
  ) {
    const auth = extractSaAuth(gameUrl);
    this.token = auth.token;
    this.origin = auth.origin;
    this.username = auth.username;
    this.gameUrl = gameUrl;
    if (!this.token) throw new Error("SA 授權網址缺少 token");
  }

  getStatus() {
    return this.status;
  }

  matchesToken(token: string) {
    return !!token && token === this.token;
  }

  touch() {
    this.lastActivity = Date.now();
  }

  idleMs() {
    return Date.now() - this.lastActivity;
  }

  /**
   * Homepage: open desks only. Empty road shells MUST show when open=true
   * (DG pattern). Never require results.length — that was the bad hide-all-empty filter.
   */
  private isOpenTable(t: SaTableSnapshot): boolean {
    if (t.open === true) return true;
    if ((t.results?.length || 0) > 0) return true;
    if ((t.round || 0) > 0) return true;
    return false;
  }

  tables() {
    return [...this.map.values()]
      .filter((t) => this.isOpenTable(t))
      .sort((a, b) => {
        const an = Number(String(a.apiId).replace(/\D/g, "")) || 0;
        const bn = Number(String(b.apiId).replace(/\D/g, "")) || 0;
        return an - bn || a.apiId.localeCompare(b.apiId);
      });
  }

  subscribe(client: SseClient) {
    this.touch();
    this.clients.add(client);
    this.sendTo(client, "status", { status: this.status, message: this.statusMessage });
    if (this.map.size) this.sendTo(client, "tables", this.tables());
    return () => {
      this.clients.delete(client);
    };
  }

  private sendTo(client: SseClient, event: string, data: unknown) {
    try {
      client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {}
  }

  private broadcast(event: string, data: unknown) {
    for (const c of this.clients) this.sendTo(c, event, data);
  }

  private setStatus(status: RelayStatus, message: string) {
    this.status = status;
    this.statusMessage = message;
    this.broadcast("status", { status, message });
  }

  private event(message: string) {
    this.broadcast("event", { message });
  }

  private emitTables(force = false) {
    const now = Date.now();
    if (!force && now - this.lastEmitAt < 40) return;
    this.lastEmitAt = now;
    this.broadcast("tables", this.tables());
  }

  private log(msg: string) {
    console.log(`[SA relay] ${msg}｜session=${this.sessionId.slice(0, 8)}`);
  }

  isForegroundBridgeActive() {
    return this.bridge && !this.stopped;
  }

  /** Refresh launch token/origin without opening a background WS (bridge enter). */
  adoptLaunchUrl(gameUrl: string) {
    const auth = extractSaAuth(gameUrl);
    if (!auth.token) throw new Error("SA 授權網址缺少 token");
    this.token = auth.token;
    this.origin = auth.origin;
    this.username = auth.username;
    this.gameUrl = gameUrl;
    this.authFailed = false;
    this.touch();
  }

  async start() {
    if (this.stopped) return;
    // Never clear an active foreground bridge — /api/sa/start can race the
    // iframe enter path and must not reopen a competing PS_LOGIN session.
    if (this.bridge) {
      this.touch();
      this.setStatus("connecting", "等待 SA 遊戲內即時封包...");
      return;
    }
    this.setStatus("connecting", "SA 牌路連線中...");
    await this.connectWs();
  }

  private async connectWs() {
    if (this.stopped || this.bridge) return;
    const candidates = DEFAULT_WS_CANDIDATES;
    // Race the first successful endpoint — sequential 12s timeouts felt "too slow".
    const errors: string[] = [];
    try {
      await new Promise<void>((resolve, reject) => {
        let pending = candidates.length;
        let won = false;
        const failOne = (url: string, err: any) => {
          errors.push(`${url}: ${err?.message || err}`);
          pending -= 1;
          if (!won && pending <= 0)
            reject(new Error(errors[0] || "SA WebSocket 連線失敗"));
        };
        for (const url of candidates) {
          void this.openOne(url, 4500)
            .then(() => {
              if (won || this.stopped || this.bridge) return;
              won = true;
              resolve();
            })
            .catch((err) => failOne(url, err));
        }
      });
    } catch (err: any) {
      this.setStatus("error", String(err?.message || "SA WebSocket 連線失敗"));
      this.scheduleReconnect();
    }
  }

  private openOne(url: string, timeoutMs = 4500) {
    return new Promise<void>((resolve, reject) => {
      if (this.stopped || this.bridge) return reject(new Error("stopped"));
      // Another candidate already connected.
      if (this.ws && this.ws.readyState === WebSocket.OPEN)
        return reject(new Error("already_connected"));
      let settled = false;
      const fail = (err: any) => {
        if (settled) return;
        settled = true;
        try {
          ws?.close();
        } catch {}
        if (this.ws === ws) this.ws = null;
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      let ws: WebSocket;
      try {
        ws = new (WebSocket as any)(url, {
          headers: {
            Origin: this.origin,
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
          },
        }) as WebSocket;
        const timer = setTimeout(() => fail(new Error("SA WS timeout")), timeoutMs);
        ws.binaryType = "arraybuffer";
        ws.addEventListener("open", () => {
          clearTimeout(timer);
          if (this.stopped || this.bridge) {
            settled = true;
            try {
              ws.close();
            } catch {}
            reject(new Error("stopped"));
            return;
          }
          // If another race winner already took the slot, drop this socket.
          if (this.ws && this.ws !== ws && this.ws.readyState === WebSocket.OPEN) {
            settled = true;
            try {
              ws.close();
            } catch {}
            reject(new Error("already_connected"));
            return;
          }
          this.ws = ws;
          settled = true;
          this.log(`WS open ${url}`);
          try {
            ws.send(buildPsLogin(this.token));
          } catch (e) {
            fail(e);
            return;
          }
          this.startAck();
          resolve();
        });
        ws.addEventListener("message", (ev) => {
          if (this.ws !== ws) return;
          try {
            const data = ev.data;
            const buf = Buffer.isBuffer(data)
              ? data
              : data instanceof ArrayBuffer
                ? Buffer.from(data)
                : Buffer.from(String(data));
            this.onPacket(buf);
          } catch (e: any) {
            this.log(`封包略過｜${e?.message || e}`);
          }
        });
        ws.addEventListener("close", () => {
          clearTimeout(timer);
          if (this.ws === ws) {
            this.clearAck();
            this.ws = null;
            if (!settled) fail(new Error("SA WS closed before open"));
            else if (!this.stopped && !this.bridge) {
              this.setStatus("connecting", "SA 連線中斷，重連中...");
              this.scheduleReconnect();
            }
          } else if (!settled) fail(new Error("SA WS closed before open"));
        });
        ws.addEventListener("error", () => {
          clearTimeout(timer);
          if (!settled) fail(new Error("SA WS error"));
        });
      } catch (e) {
        fail(e);
      }
    });
  }

  private startAck() {
    this.clearAck();
    this.ackTimer = setInterval(() => {
      if (this.bridge || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try {
        this.ws.send(buildCsAck());
      } catch {}
    }, 15000);
  }

  private clearAck() {
    if (this.ackTimer) clearInterval(this.ackTimer);
    this.ackTimer = null;
  }

  private scheduleReconnect() {
    if (this.stopped || this.bridge || this.authFailed || this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(30000, 4000 * this.reconnectAttempt);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectWs();
    }, delay);
  }

  /** Feed a raw SA application packet (already de-framed from WS). */
  ingestApplicationPacket(raw: Buffer) {
    this.touch();
    if (this.bridge && this.status !== "connected") {
      this.setStatus("connected", "SA 遊戲內即時封包已接通");
    }
    // Upstream may coalesce several 0xaa commands in one WS binary frame.
    const frames = parseAllFrames(raw);
    if (!frames.length) {
      this.onPacket(raw);
      return;
    }
    for (const frame of frames) {
      this.dispatchCommand(frame.cmdId, frame.payload);
    }
  }

  enterBridgeMode() {
    if (this.stopped) throw new Error("SA relay 已停止");
    // In-game iframe becomes the only SA WS owner; proxy mirrors frames here.
    this.bridge = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearAck();
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
    this.setStatus("connecting", "等待 SA 遊戲內即時封包...");
    this.log("Bridge｜背景 WS 已停，前景代理接管");
  }

  async leaveBridgeMode() {
    if (this.stopped || !this.bridge) return;
    this.bridge = false;
    this.setStatus("connecting", "SA 背景牌路恢復中...");
    this.log("Bridge｜已離開前景 SA，恢復背景 WebSocket");
    await this.connectWs();
  }

  private onPacket(raw: Buffer) {
    const frames = parseAllFrames(raw);
    if (frames.length) {
      for (const frame of frames) this.dispatchCommand(frame.cmdId, frame.payload);
      return;
    }
    const frame = parseFrame(raw);
    if (!frame) return;
    this.dispatchCommand(frame.cmdId, frame.payload);
  }

  private dispatchCommand(cmdId: number, payload: Buffer) {
    this.touch();

    if (cmdId === SA_CMD.SP_LOGIN) {
      const login = parseSpLogin(payload);
      this.authFailed = false;
      this.reconnectAttempt = 0;
      this.setStatus("connected", "SA 已連線");
      this.event(
        login?.username
          ? `SA 登入成功（${login.username}）`
          : "SA 登入成功，正在同步桌台",
      );
      this.log(`Login ok｜user=${login?.username || this.username || "?"}`);
      return;
    }

    if (cmdId === SA_CMD.SP_LOGIN_FAIL) {
      this.authFailed = true;
      this.clearAck();
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      try {
        this.ws?.close();
      } catch {}
      this.ws = null;
      this.setStatus("error", "SA 授權失效，請重新進入平台取得新 token");
      this.event("SA 登入被拒（token 無效或過期）");
      this.log("Login fail｜停止重連，等待新授權");
      return;
    }

    if (cmdId === SA_CMD.SP_HOST_LIST) {
      const hosts = parseSpHostList(payload);
      this.hostIds = hosts
        .filter(
          (h) =>
            h.gameType === SA_GAME_TYPE_BACCARAT ||
            (h.gameType & SA_GAME_TYPE_BACCARAT) === SA_GAME_TYPE_BACCARAT,
        )
        .map((h) => h.hostId);
      const alive = new Set(this.hostIds);
      for (const id of [...this.map.keys()]) {
        if (!alive.has(id)) this.map.delete(id);
      }
      // SpHostList ≈ full lobby catalog (~74), NOT openHosts.
      // Open desks appear as empty road shells only after Init/GameRest proves
      // 開桌 (Rest Open/Pause) — then roads fill the SAME D01/C01 cards.
      // Do NOT shell all hostIds here (catalog flood) and do NOT wait for roads.
      this.emitTables(true);
      this.requestInitForHosts(this.hostIds);
      this.startInitRetryLoop();
      this.event(`SA 大廳 ${this.hostIds.length}｜開桌空殼由 Init/Rest 建立`);
      return;
    }

    if (
      cmdId === SA_CMD.SC_INIT_BACCARAT ||
      cmdId === SA_CMD.SC_INIT_SQUEEZE_BACCARAT
    ) {
      const init = parseScInitBaccarat(payload);
      if (init) this.applyInit(init);
      return;
    }

    if (cmdId === SA_CMD.SC_INIT_NEW_BACCARAT) {
      const init = parseScInitNewBaccarat(payload);
      if (init) this.applyInit(init);
      return;
    }

    // Live round start: REQUIRED so GameResult gameIds map to a host.
    if (cmdId === SA_CMD.SC_GAME_START) {
      const start = parseScGameStart(payload);
      if (!start) return;
      if (!this.isTrackedHost(start.hostId)) return;
      this.ensureTable(start.hostId);
      this.gameToHost.set(start.gameId, start.hostId);
      if (start.gameCount > 0) this.gameToCount.set(start.gameId, start.gameCount);
      const prev = this.map.get(start.hostId);
      if (prev) {
        const { shoe, round } = shoeRoundFromGameCount(start.gameCount);
        const shoeStr = shoe > 0 ? String(shoe) : prev.shoe;
        const shoeChanged =
          shoe > 0 && String(prev.shoe) !== "—" && String(shoe) !== String(prev.shoe);
        const nextRound = round
          ? shoeChanged
            ? round
            : Math.max(round, prev.round || 0)
          : prev.round;
        this.map.set(start.hostId, {
          ...prev,
          shoe: shoeStr,
          round: nextRound,
          countdown: saBettingCountdown(start.countdown),
          countdownUpdatedAt: Date.now(),
          live: true,
          open: true,
          rest: 0,
          dealerPhoto: saHostCoverUrl(start.hostId),
          // Keep prior hand poker through 庄贏 interstitial. Fresh GameState
          // deal CSV / pending flush overwrites; clearing here left 算牌/奇偶
          // stuck on「等待完整 show_poker」while video still showed cards.
          poker: prev.poker,
          lastUpdated: Date.now(),
        });
        this.emitTables(true);
      }
      // Flush early GameState deals for THIS gameId (may replace kept poker).
      this.flushPendingForHost(start.hostId);
      return;
    }

    if (cmdId === SA_CMD.SC_GAME_REST) {
      const restPkt = parseScGameRest(payload);
      if (!restPkt?.hostId) return;
      if (!this.isTrackedHost(restPkt.hostId)) return;
      if (!isSaTableModeOpen(restPkt.onOrOff)) {
        this.map.delete(restPkt.hostId);
        this.emitTables(true);
        return;
      }
      const prev = this.map.get(restPkt.hostId);
      const t = prev || this.ensureTable(restPkt.hostId);
      this.map.set(restPkt.hostId, {
        ...t,
        live: true,
        open: true,
        rest: restPkt.onOrOff,
        lastUpdated: Date.now(),
      });
      this.emitTables(true);
      return;
    }

    if (cmdId === SA_CMD.SC_GAME_STATE) {
      const st = parseScGameState(payload);
      if (!st?.gameId) return;
      // Baccarat deal CSV has no hostId — resolve via GameStart/Init map.
      let hostId =
        st.hostId && this.isTrackedHost(st.hostId) ? st.hostId : undefined;
      if (!hostId) hostId = this.gameToHost.get(st.gameId);
      if (!hostId) {
        if (st.poker) {
          const prevPending = this.pendingResults.get(st.gameId);
          this.pendingResults.set(st.gameId, {
            road: prevPending?.road,
            gameId: st.gameId,
            key: prevPending?.road ? prevPending.key : `${st.gameId}:deal`,
            poker: st.poker,
          });
        }
        return;
      }
      this.gameToHost.set(st.gameId, hostId);
      if (!this.isTrackedHost(hostId)) return;
      const prev = this.map.get(hostId) || this.ensureTable(hostId);
      const gc = this.gameToCount.get(st.gameId);
      const fromStart =
        gc != null && gc > 0 ? shoeRoundFromGameCount(gc).round : 0;
      const syncedRound =
        fromStart > 0 ? Math.max(prev.round || 0, fromStart) : prev.round;
      const syncedShoe =
        gc != null && gc > 0
          ? (() => {
              const { shoe } = shoeRoundFromGameCount(gc);
              return shoe > 0 ? String(shoe) : prev.shoe;
            })()
          : prev.shoe;
      // Deal remainTime is not betting countdown — only push when cards change
      // or legacy host-bound state needs a liveness tick.
      if (st.poker) {
        if (
          st.poker === prev.poker &&
          syncedRound === prev.round &&
          (prev.countdown || 0) === 0
        )
          return;
        this.map.set(hostId, {
          ...prev,
          poker: st.poker,
          shoe: syncedShoe,
          round: syncedRound,
          // 發牌中 — no betting countdown (matches official 大廳「發牌中」).
          countdown: 0,
          countdownUpdatedAt: Date.now(),
          dealerPhoto: saHostCoverUrl(hostId),
          live: true,
          open: true,
          rest: prev.rest ?? 0,
          lastUpdated: Date.now(),
        });
        this.emitTables(true);
        return;
      }
      this.map.set(hostId, {
        ...prev,
        shoe: syncedShoe,
        round: syncedRound,
        dealerPhoto: prev.dealerPhoto || saHostCoverUrl(hostId),
        live: true,
        open: true,
        rest: prev.rest ?? 0,
        lastUpdated: Date.now(),
      });
      this.emitTables(true);
      return;
    }

    if (cmdId === SA_CMD.SC_GAME_RESULT) {
      const gr = parseScGameResult(payload);
      // Need a road for 珠盘, and/or poker for float 開牌 / 算牌 / 奇偶.
      if (!gr?.road && !gr?.poker) return;
      const key = `${gr.gameId}:${gr.road || "cards"}`;
      const hostId = this.gameToHost.get(gr.gameId);
      if (!hostId) {
        // Merge — never let a road-only GameResult wipe pending deal poker
        // from progressive ScGameState CSV (HAR: states often arrive first).
        const prevPending = this.pendingResults.get(gr.gameId);
        this.pendingResults.set(gr.gameId, {
          road: gr.road || prevPending?.road,
          gameId: gr.gameId,
          key,
          poker: gr.poker ?? prevPending?.poker,
        });
        return;
      }
      if (!this.isTrackedHost(hostId)) return;
      if (!this.map.has(hostId)) this.ensureTable(hostId);
      if (gr.road) this.applyRoadResult(hostId, gr.road, key, gr.poker, gr.gameId);
      else if (gr.poker) this.applyPokerOnly(hostId, gr.poker);
      return;
    }

    if (cmdId === SA_CMD.SC_ANCHOR_LOGIN) {
      const a = parseScAnchorLogin(payload);
      if (!a?.hostId) return;
      const prev = this.map.get(a.hostId);
      if (!prev) return;
      if (
        (a.dealerName && prev.players !== a.dealerName) ||
        !prev.dealerPhoto
      ) {
        this.map.set(a.hostId, {
          ...prev,
          players: a.dealerName || prev.players,
          trend: a.dealerName || prev.trend,
          dealerPhoto: prev.dealerPhoto || saHostCoverUrl(a.hostId),
          lastUpdated: Date.now(),
        });
        this.emitTables();
      }
      return;
    }

    if (cmdId === SA_CMD.SC_ACK || cmdId === SA_CMD.CS_ACK) {
      return;
    }
  }

  /** Membership from SpHostList. Before first list, allow shells. */
  private isTrackedHost(hostId: number) {
    if (!hostId) return false;
    if (!this.hostIds.length) return true;
    return this.hostIds.includes(hostId);
  }

  private ensureTable(hostId: number) {
    let t = this.map.get(hostId);
    if (t) return t;
    // Official D01/C01 when mapped — never sequential 百家樂 1..N.
    const room = String(hostId);
    const label = saDisplayName(hostId);
    const apiId = `SA${hostId}`;
    t = {
      id: label,
      apiId,
      game: "百家樂",
      name: label,
      players: "—",
      roomId: room,
      tableBadge: label,
      shoe: "—",
      round: 0,
      banker: 0,
      player: 0,
      tie: 0,
      results: [],
      trend: "",
      live: true,
      open: true,
      rest: 0,
      dealerPhoto: saHostCoverUrl(hostId),
      lastUpdated: Date.now(),
    };
    this.map.set(hostId, t);
    return t;
  }

  private requestInitForHosts(hostIds: number[]) {
    if (!hostIds.length) return;
    if (this.bridge) return; // foreground game owns the session; frames still arrive via proxy
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    // Chunk to avoid oversized PS_REQUEST_INIT_CLIENT payloads.
    for (let i = 0; i < hostIds.length; i += 40) {
      const chunk = hostIds.slice(i, i + 40);
      try {
        this.ws.send(buildRequestInitClient(chunk));
      } catch {}
    }
  }

  private startInitRetryLoop() {
    if (this.initRetryTimer) return;
    this.initRetryTimer = setInterval(() => {
      if (this.stopped || this.bridge || this.authFailed) return;
      // Re-request init for desks not yet proven open, plus open shells missing roads.
      const need = this.hostIds.filter((id) => {
        const t = this.map.get(id);
        return !t || !t.results.length;
      });
      if (!need.length) return;
      this.requestInitForHosts(need);
      this.log(`重請求牌路 init｜need=${need.length}/${this.hostIds.length}｜open=${this.map.size}`);
    }, 12_000);
    this.initRetryTimer.unref?.();
  }

  private applyRoadResult(
    hostId: number,
    road: SaRoadResult,
    key: string,
    poker?: string,
    gameId?: number,
  ) {
    if (!this.isTrackedHost(hostId)) return;
    const prev = this.map.get(hostId);
    if (!prev) return;
    if (prev.lastResultKey === key && (!poker || prev.poker === poker)) return;
    const isNewHand = prev.lastResultKey !== key;
    const results = isNewHand
      ? [...prev.results, road].slice(-80)
      : prev.results;
    const counts = countResults(results);
    const gc = gameId != null ? this.gameToCount.get(gameId) : undefined;
    let nextRound = prev.round || 0;
    let nextShoe = prev.shoe;
    if (isNewHand) {
      nextRound = nextSaRoundAfterHand(prev.round || 0, gc);
      if (gc != null && gc > 0) {
        const { shoe } = shoeRoundFromGameCount(gc);
        if (shoe > 0) nextShoe = String(shoe);
      }
    }
    const next: SaTableSnapshot = {
      ...prev,
      ...counts,
      results,
      shoe: nextShoe,
      round: nextRound,
      // Prefer fresh GameResult/GameState poker for 算牌 / 奇偶.
      poker: poker ?? prev.poker,
      // Betting window ends when the hand settles — avoid stale countdown.
      countdown: isNewHand ? 0 : prev.countdown,
      countdownUpdatedAt: isNewHand ? Date.now() : prev.countdownUpdatedAt,
      live: true,
      open: true,
      rest: prev.rest ?? 0,
      dealerPhoto: prev.dealerPhoto || saHostCoverUrl(hostId),
      lastUpdated: Date.now(),
      lastResultKey: key,
    };
    this.map.set(hostId, next);
    this.emitTables(true);
    // SA-only 輸贏報表: live GameResult → SSE `result` (not Init history).
    if (isNewHand && road) {
      const resolvedGameId =
        gameId != null && Number.isFinite(gameId)
          ? gameId
          : Number(String(key).split(":")[0]) || 0;
      const payload: SaWinReportResult = {
        tableId: next.id || saDisplayName(hostId),
        apiId: next.apiId || `SA${hostId}`,
        tableBadge: next.tableBadge || saDisplayName(hostId),
        roomId: next.roomId || String(hostId),
        hostId,
        road,
        gameId: resolvedGameId,
        resultKey: key,
        shoe: String(next.shoe ?? ""),
        round: Number(next.round) || 0,
        poker: next.poker,
        at: Date.now(),
      };
      this.broadcast("result", payload);
      this.event(
        `SA 開獎 ${payload.tableBadge || payload.tableId}｜${payload.road}｜gameId ${payload.gameId}`,
      );
    }
  }

  private applyPokerOnly(hostId: number, poker: string) {
    if (!this.isTrackedHost(hostId)) return;
    const prev = this.map.get(hostId);
    if (!prev || prev.poker === poker) return;
    this.map.set(hostId, {
      ...prev,
      poker,
      live: true,
      open: true,
      rest: prev.rest ?? 0,
      lastUpdated: Date.now(),
    });
    this.emitTables(true);
  }

  private flushPendingForHost(hostId: number) {
    for (const [gameId, pending] of this.pendingResults) {
      if (this.gameToHost.get(gameId) !== hostId) continue;
      this.pendingResults.delete(gameId);
      if (pending.road) {
        this.applyRoadResult(
          hostId,
          pending.road,
          pending.key,
          pending.poker,
          pending.gameId,
        );
      } else if (pending.poker) {
        this.applyPokerOnly(hostId, pending.poker);
      }
    }
  }

  private applyInit(init: {
    hostId: number;
    countDown: number;
    remainTime: number;
    rest?: number;
    hands: {
      gameId: number;
      gameCount: number;
      result: SaRoadResult | null;
      poker?: string;
    }[];
  }) {
    if (!this.isTrackedHost(init.hostId)) return;
    // Close / InternalTest: prune shell. Open (incl. empty roads): fill same card.
    if (init.rest != null && !isSaTableModeOpen(init.rest)) {
      this.map.delete(init.hostId);
      this.emitTables(true);
      return;
    }
    const prev = this.map.get(init.hostId) || this.ensureTable(init.hostId);
    const results = init.hands
      .map((h) => h.result)
      .filter((x): x is SaRoadResult => !!x)
      .slice(-80);
    const last = init.hands[init.hands.length - 1];
    for (const h of init.hands) {
      if (h.gameId) this.gameToHost.set(h.gameId, init.hostId);
      if (h.gameId && h.gameCount > 0) this.gameToCount.set(h.gameId, h.gameCount);
    }
    const { shoe, round } = last
      ? shoeRoundFromGameCount(last.gameCount)
      : { shoe: 0, round: 0 };
    const counts = countResults(results);
    const label = saDisplayName(init.hostId);
    const room = String(init.hostId);
    // Never let a stale Init snapshot pull float round behind live GameResult.
    const nextRound = mergeSaInitRound(prev.round || 0, prev.shoe, shoe, round);
    const nextShoe = shoe > 0 ? String(shoe) : prev.shoe;
    // Prefer longer live road if Init is behind (same shoe); avoid bead wipe.
    const liveAhead =
      String(nextShoe) === String(prev.shoe) &&
      (prev.results?.length || 0) > results.length;
    const nextResults = liveAhead ? prev.results : results;
    const nextCounts = liveAhead ? countResults(nextResults) : counts;
    // Prefer live deal poker; else last Init OldResult cards (join mid-hand).
    const initPoker = !liveAhead
      ? [...init.hands].reverse().find((h) => h.poker)?.poker
      : undefined;
    this.map.set(init.hostId, {
      ...prev,
      ...nextCounts,
      name: label,
      roomId: room,
      tableBadge: label,
      id: label,
      results: nextResults,
      shoe: nextShoe,
      round: nextRound,
      countdown: saBettingCountdown(init.remainTime, init.countDown),
      countdownUpdatedAt: Date.now(),
      live: true,
      open: true,
      rest: Number.isFinite(Number(init.rest)) ? Number(init.rest) : 0,
      dealerPhoto: saHostCoverUrl(init.hostId),
      lastUpdated: Date.now(),
      lastResultKey: liveAhead
        ? prev.lastResultKey
        : last
          ? `${last.gameId}:${last.result || ""}`
          : prev.lastResultKey,
      poker: prev.poker ?? initPoker,
    });
    this.flushPendingForHost(init.hostId);
    this.emitTables(true);
    const withRoads = [...this.map.values()].filter((t) => t.results.length).length;
    const openCount = this.tables().length;
    if (!this.firstTablesLogged && openCount > 0) {
      this.firstTablesLogged = true;
      this.log(`已同步開桌：${openCount} 桌｜有牌路 ${withRoads}`);
      this.event(`SA 開桌 ${openCount}（有牌路 ${withRoads}）`);
    }
  }

  stop() {
    this.stopped = true;
    this.bridge = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.initRetryTimer) clearInterval(this.initRetryTimer);
    this.initRetryTimer = null;
    this.clearAck();
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
    this.setStatus("closed", "SA 已停止");
    this.clients.clear();
  }
}

const relays = new Map<string, SaRelay>();

/**
 * Create/reuse a relay object for foreground enter without opening background WS.
 * Opening WS here would share the SALI token with the iframe and trigger ERR26.
 */
export function ensureSaRelayShell(sessionId: string, gameUrl: string): SaRelay {
  const auth = extractSaAuth(gameUrl);
  if (!auth.token) throw new Error("SA 授權網址缺少 token");
  const existing = relays.get(sessionId);
  if (existing && existing.getStatus() !== "closed") {
    existing.adoptLaunchUrl(gameUrl);
    return existing;
  }
  if (existing) {
    try {
      existing.stop();
    } catch {}
    relays.delete(sessionId);
  }
  const relay = new SaRelay(sessionId, gameUrl);
  relays.set(sessionId, relay);
  return relay;
}

export async function startSaRelay(sessionId: string, gameUrl: string) {
  const auth = extractSaAuth(gameUrl);
  const existing = relays.get(sessionId);
  if (existing && existing.isForegroundBridgeActive()) {
    // Keep SSE subscribers + table cache; adopt the enter-game token for leave.
    try {
      existing.adoptLaunchUrl(gameUrl);
    } catch {}
    existing.touch();
    return { relay: existing, reused: true };
  }
  if (existing && existing.matchesToken(auth.token)) {
    existing.touch();
    if (existing.getStatus() === "idle" || existing.getStatus() === "closed") {
      await existing.start();
    }
    return { relay: existing, reused: true };
  }
  if (existing) existing.stop();
  const relay = new SaRelay(sessionId, gameUrl);
  relays.set(sessionId, relay);
  await relay.start();
  return { relay, reused: false };
}

export function getSaRelay(sessionId: string) {
  return relays.get(sessionId) || null;
}

export function stopSaRelay(sessionId: string) {
  const r = relays.get(sessionId);
  if (!r) return;
  r.stop();
  relays.delete(sessionId);
}

export function findSaRelayByToken(token: string) {
  for (const r of relays.values()) {
    if (r.matchesToken(token)) return r;
  }
  return null;
}

export function sweepIdleSaRelays(maxIdleMs = 30 * 60 * 1000) {
  for (const [id, r] of relays) {
    if (r.idleMs() > maxIdleMs) {
      r.stop();
      relays.delete(id);
    }
  }
}
