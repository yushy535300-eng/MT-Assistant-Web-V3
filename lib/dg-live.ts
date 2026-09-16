export type DgRoadResult = "莊" | "閒" | "和";

export type DgTableData = {
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

type DgStatus = "idle" | "loading" | "connecting" | "connected" | "error" | "closed";

type DgCallbacks = {
  onTables: (tables: DgTableData[]) => void;
  onStatus?: (status: DgStatus, message?: string) => void;
  onEvent?: (message: string) => void;
};

type DgController = { close: () => void };

const DG_WS = "wss://appatw.kindlestone.com";
const DG_KEY = "pV5mY8dR2qGxH1sK9tBzN6uC3fWjE0aL7rTnJ4cQvSgPZyFMiXoUbDlAhOeRwd36";
let vendorPromise: Promise<void> | null = null;

function loadScript(src: string, flag: string) {
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.reject(new Error("DG 即時資料僅支援 Web"));
  const w = window as any;
  if (flag === "crypto" && w.CryptoJS) return Promise.resolve();
  if (flag === "protobuf" && w.protobuf) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[data-dg-vendor="${flag}"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`DG ${flag} 載入失敗`)), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.dgVendor = flag;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`DG ${flag} 載入失敗`));
    document.head.appendChild(script);
  });
}

async function ensureVendor() {
  if (vendorPromise) return vendorPromise;
  vendorPromise = (async () => {
    await loadScript("/dg-vendor/CryptoJS.js", "crypto");
    await loadScript("/dg-vendor/protobuf.js", "protobuf");
  })();
  return vendorPromise;
}

function extractToken(url: string) {
  try {
    const u = new URL(url);
    return u.searchParams.get("token") || "";
  } catch {
    const match = String(url || "").match(/[?&]token=([^&#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }
}

function numberOf(value: any) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value.toNumber === "function") return Number(value.toNumber());
  if (value && typeof value.low === "number") return Number(value.low >>> 0);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function baccaratResultFromRoad(raw: string): DgRoadResult | null {
  const parts = String(raw || "").split("#");
  const code = Number(parts[1] ?? parts[0]);
  if (!Number.isFinite(code) || code <= 0) return null;
  const base = code % 4;
  if (base === 1) return "閒";
  if (base === 2) return "莊";
  if (base === 3) return "和";
  return null;
}

function parseRoads(roads: any[]): DgRoadResult[] {
  return (Array.isArray(roads) ? roads : []).map(baccaratResultFromRoad).filter((x): x is DgRoadResult => !!x);
}

function countResults(results: DgRoadResult[]) {
  let banker = 0, player = 0, tie = 0;
  for (const r of results) {
    if (r === "莊") banker++;
    else if (r === "閒") player++;
    else tie++;
  }
  return { banker, player, tie };
}

function dgPhotoUrl(gameUrl: string, photo?: string) {
  if (!photo) return undefined;
  try {
    const origin = new URL(gameUrl).origin;
    return `${origin}/vd/vd/image/Image/dealer/${String(photo).replace(/^\/+/, "")}`;
  } catch {
    return undefined;
  }
}

function normalizeTable(raw: any, previous: DgTableData | undefined, gameUrl: string): DgTableData | null {
  const tableId = numberOf(raw?.tableId);
  const fms = String(raw?.fms ?? previous?.apiId ?? "").trim().toUpperCase();
  const gameId = numberOf(raw?.gameId);
  const isExisting = !!previous;
  if (!isExisting) {
    if (gameId !== 1 || !/^BAC\d+/i.test(fms)) return null;
  }
  const roads = Array.isArray(raw?.roads) && raw.roads.length ? raw.roads : undefined;
  const results = roads ? parseRoads(roads) : (previous?.results ?? []);
  const counts = countResults(results);
  const dealer = raw?.dealer ?? {};
  const apiId = fms || previous?.apiId || `DG${tableId}`;
  const displayId = apiId;
  const round = numberOf(raw?.playId) || previous?.round || 0;
  const shoe = raw?.shoeId != null ? String(numberOf(raw.shoeId)) : (previous?.shoe ?? "—");
  const countdown = raw?.countDown != null ? numberOf(raw.countDown) : previous?.countdown;
  const tableName = String(raw?.tableName ?? previous?.roomId ?? "—");
  const dealerName = String(dealer?.name ?? previous?.name ?? "—");
  const dealerPhoto = dealer?.photo ? dgPhotoUrl(gameUrl, String(dealer.photo)) : previous?.dealerPhoto;
  const players = raw?.onlineCount != null ? String(numberOf(raw.onlineCount)) : (previous?.players ?? "—");
  const resultKey = results.length ? `${shoe}:${round}:${results.length}:${results[results.length - 1]}` : previous?.lastResultKey;
  return {
    id: displayId,
    apiId,
    game: "百家樂",
    name: dealerName,
    players,
    countdown,
    countdownUpdatedAt: raw?.countDown != null ? Date.now() : previous?.countdownUpdatedAt,
    roomId: tableName,
    tableBadge: tableId ? String(tableId) : previous?.tableBadge,
    shoe,
    round,
    banker: counts.banker,
    player: counts.player,
    tie: counts.tie,
    results,
    trend: previous?.trend ?? "",
    live: true,
    dealerPhoto,
    streamUrl: previous?.streamUrl,
    lastUpdated: Date.now(),
    lastResultKey: resultKey,
    poker: raw?.poker != null ? String(raw.poker) : previous?.poker,
  };
}

function sortDgTables(tables: DgTableData[]) {
  return [...tables].sort((a, b) => {
    const an = Number(String(a.apiId).replace(/\D/g, ""));
    const bn = Number(String(b.apiId).replace(/\D/g, ""));
    return an - bn || a.apiId.localeCompare(b.apiId);
  });
}

export async function connectDgLive(gameUrl: string, callbacks: DgCallbacks): Promise<DgController> {
  callbacks.onStatus?.("loading", "正在載入 DG 通訊元件");
  await ensureVendor();
  const token = extractToken(gameUrl);
  if (!token) throw new Error("DG 授權網址缺少 token");

  const w = window as any;
  const CryptoJS = w.CryptoJS;
  const protobuf = w.protobuf;
  const protoText = await fetch("/dg-vendor/PublicBeanProto.proto", { cache: "no-store" }).then(r => {
    if (!r.ok) throw new Error("DG Protobuf 定義載入失敗");
    return r.text();
  });
  const parsed = protobuf.parse(protoText);
  const PublicBean = parsed.root.lookupType("PublicBean");
  const key = CryptoJS.enc.Utf8.parse(DG_KEY);
  const encrypt = (plain: string) => CryptoJS.TripleDES.encrypt(plain, key, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }).toString();
  const sign = encrypt(token);

  let closedByUser = false;
  let initDone = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let ws: WebSocket | null = null;
  const map = new Map<number, DgTableData>();
  let lastEmitAt = 0;

  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmitAt < 45) return;
    lastEmitAt = now;
    callbacks.onTables(sortDgTables(Array.from(map.values())));
  };

  const encodeAndSend = (cmd: number, extra: Record<string, any> = {}) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const auth = encrypt(JSON.stringify({ cmd, token, time: Date.now() }));
    const payload = PublicBean.create({ cmd, token: auth, ...extra });
    const bytes = PublicBean.encode(payload).finish();
    ws.send(bytes);
  };

  const handlePacket = (decoded: any) => {
    const cmd = numberOf(decoded?.cmd);
    if (cmd === 10086 && !initDone) {
      initDone = true;
      callbacks.onStatus?.("connected", "DG 即時資料已連線");
      callbacks.onEvent?.("DG 驗證完成，正在同步真人桌");
      encodeAndSend(45, { type: 1 });
      encodeAndSend(2, { lobbyId: 5, type: 0 });
      encodeAndSend(5011, { type: 0 });
      setTimeout(() => encodeAndSend(87, { type: 1 }), 80);
      setTimeout(() => encodeAndSend(24, { type: 2 }), 100);
    }

    // DG sends the full baccarat road separately after settlement (cmd 1004).
    // Keep this in the same normalized TableData so the MT road renderer can be reused 1:1.
    if (cmd === 1004 && decoded?.tableId && Array.isArray(decoded?.list) && decoded.list.length) {
      const id = numberOf(decoded.tableId);
      const previous = map.get(id);
      if (previous) {
        const next = normalizeTable({ tableId: id, roads: decoded.list }, previous, gameUrl);
        if (next) { map.set(id, next); emit(true); }
      }
    }

    const incoming = Array.isArray(decoded?.table) ? decoded.table : [];
    if (incoming.length) {
      let changed = false;
      for (const raw of incoming) {
        const id = numberOf(raw?.tableId);
        const previous = map.get(id);
        const next = normalizeTable(raw, previous, gameUrl);
        if (!next) continue;
        map.set(id, next);
        changed = true;
      }
      if (changed) emit(cmd === 2 || cmd === 44);
    }
  };

  const open = () => {
    callbacks.onStatus?.("connecting", "正在連線 DG 即時資料");
    initDone = false;
    const url = `${DG_WS}/?sign=${encodeURIComponent(sign)}`;
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      callbacks.onStatus?.("connecting", "DG WebSocket 已建立，正在驗證");
      callbacks.onEvent?.("DG WebSocket 已連線");
      encodeAndSend(10086, { tableId: 1, type: 0, object: "PC" });
    };
    ws.onmessage = async (event: MessageEvent) => {
      try {
        let bytes: Uint8Array;
        if (event.data instanceof ArrayBuffer) bytes = new Uint8Array(event.data);
        else if (typeof Blob !== "undefined" && event.data instanceof Blob) bytes = new Uint8Array(await event.data.arrayBuffer());
        else return;
        const decoded = PublicBean.toObject(PublicBean.decode(bytes), { longs: Number, enums: String, defaults: false, arrays: true, objects: true });
        handlePacket(decoded);
      } catch (error: any) {
        callbacks.onEvent?.(`DG 封包解析略過：${error?.message || "unknown"}`);
      }
    };
    ws.onerror = () => callbacks.onStatus?.("error", "DG WebSocket 連線錯誤");
    ws.onclose = () => {
      callbacks.onStatus?.(closedByUser ? "closed" : "error", closedByUser ? "DG 已停止" : "DG 已中斷，準備重連");
      if (!closedByUser) {
        reconnectTimer = setTimeout(open, 2500);
      }
    };
  };

  open();
  return {
    close: () => {
      closedByUser = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try { ws?.close(); } catch {}
      ws = null;
    },
  };
}
