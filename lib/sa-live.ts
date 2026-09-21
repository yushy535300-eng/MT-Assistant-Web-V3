export type SaRoadResult = "莊" | "閒" | "和";

export type SaTableData = {
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
  /** Relay 「開桌」flag (TableMode Open/Pause or live round). */
  open?: boolean;
  rest?: number;
  dealerPhoto?: string;
  streamUrl?: string;
  lastUpdated?: number;
  lastResultKey?: string;
  poker?: string;
};

/** Mirrors server SaWinReportResult — live GameResult for SA 輸贏報表 only. */
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

type SaStatus = "idle" | "loading" | "connecting" | "connected" | "error" | "closed";

type SaCallbacks = {
  onTables: (tables: SaTableData[]) => void;
  onStatus?: (status: SaStatus, message?: string) => void;
  onEvent?: (message: string) => void;
  /** Live ScGameResult road — feeds SA 今日輸贏 bucket only (never MT/DG). */
  onResult?: (result: SaWinReportResult) => void;
};

type SaController = { close: () => void };

function jsonOf<T>(event: MessageEvent, fallback: T): T {
  try {
    return JSON.parse(String(event.data ?? "")) as T;
  } catch {
    return fallback;
  }
}

/**
 * Browser path: same-origin SA relay (Origin must be labplatformplus; the
 * server owns the upstream WSS). Mirrors DG's EventSource pattern.
 */
export async function connectSaLive(
  gameUrl: string,
  sessionId: string,
  callbacks: SaCallbacks,
): Promise<SaController> {
  if (typeof window === "undefined" || typeof EventSource === "undefined")
    throw new Error("SA 即時連線目前僅支援網站版");
  if (!sessionId) throw new Error("登入工作階段已失效");

  let closed = false;
  let source: EventSource | null = null;
  let connected = false;

  callbacks.onStatus?.("loading", "正在確認 SA 啟動網址");
  const start = await fetch("/api/sa/start", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sessionId, gameUrl }),
  });
  let startData: any = null;
  try {
    startData = await start.json();
  } catch {}
  if (!start.ok || !startData?.ok) {
    const message = String(startData?.error || `SA relay 啟動失敗 (${start.status})`);
    callbacks.onStatus?.("error", message);
    throw new Error(message);
  }

  source = new EventSource(
    `/api/sa/stream?sessionId=${encodeURIComponent(sessionId)}`,
  );
  callbacks.onStatus?.("connecting", "SA 即時牌路連線中...");

  source.addEventListener("status", (raw: Event) => {
    if (closed) return;
    const data = jsonOf<{ status?: SaStatus; message?: string }>(
      raw as MessageEvent,
      {},
    );
    const status = data.status || "connecting";
    if (status === "connected") connected = true;
    callbacks.onStatus?.(status, data.message || "SA 連線中...");
  });
  source.addEventListener("tables", (raw: Event) => {
    if (closed) return;
    const next = jsonOf<SaTableData[]>(raw as MessageEvent, []);
    if (Array.isArray(next)) callbacks.onTables(next);
  });
  source.addEventListener("result", (raw: Event) => {
    if (closed) return;
    const data = jsonOf<SaWinReportResult | null>(raw as MessageEvent, null);
    if (data?.road && (data.tableId || data.apiId || data.roomId)) {
      callbacks.onResult?.(data);
    }
  });
  source.addEventListener("event", (raw: Event) => {
    if (closed) return;
    const data = jsonOf<{ message?: string }>(raw as MessageEvent, {});
    if (data.message) callbacks.onEvent?.(data.message);
  });
  source.onerror = () => {
    if (closed || connected) return;
    callbacks.onStatus?.("error", "SA 即時通道中斷");
  };

  return {
    close: () => {
      if (closed) return;
      closed = true;
      try {
        source?.close();
      } catch {}
      source = null;
    },
  };
}
