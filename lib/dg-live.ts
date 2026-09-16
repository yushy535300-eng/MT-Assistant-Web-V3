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

function jsonOf<T>(event: MessageEvent, fallback: T): T {
  try { return JSON.parse(String(event.data ?? "")) as T; } catch { return fallback; }
}

/**
 * DG cannot be connected reliably from the browser because the vendor WebSocket
 * validates the DG page Origin. The browser is therefore connected only to our
 * same-origin SSE relay; the Node server owns the DG WebSocket and preserves the
 * required vendor Origin header.
 */
export async function connectDgLive(gameUrl: string, sessionId: string, callbacks: DgCallbacks): Promise<DgController> {
  if (typeof window === "undefined" || typeof EventSource === "undefined") throw new Error("DG 即時連線目前僅支援網站版");
  if (!sessionId) throw new Error("登入工作階段已失效");
  callbacks.onStatus?.("loading", "正在準備 DG 即時連線");

  const start = await fetch("/api/dg/start", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sessionId, gameUrl }),
  });
  let startData: any = null; try { startData = await start.json(); } catch {}
  if (!start.ok || !startData?.ok) throw new Error(String(startData?.error || `DG 連線服務啟動失敗 (${start.status})`));

  let closed = false;
  const source = new EventSource(`/api/dg/stream?sessionId=${encodeURIComponent(sessionId)}`);
  callbacks.onStatus?.("connecting", "DG 連線中...");

  source.addEventListener("status", (raw: Event) => {
    if (closed) return;
    const event = raw as MessageEvent;
    const data = jsonOf<{status?:DgStatus;message?:string}>(event, {});
    callbacks.onStatus?.(data.status || "connecting", data.message || "DG 連線中...");
  });
  source.addEventListener("tables", (raw: Event) => {
    if (closed) return;
    const next = jsonOf<DgTableData[]>(raw as MessageEvent, []);
    if (Array.isArray(next)) callbacks.onTables(next);
  });
  source.addEventListener("event", (raw: Event) => {
    if (closed) return;
    const data = jsonOf<{message?:string}>(raw as MessageEvent, {});
    if (data.message) callbacks.onEvent?.(data.message);
  });
  source.onerror = () => {
    if (!closed) callbacks.onStatus?.("connecting", "DG 即時通道重連中...");
  };

  return {
    close: () => {
      if (closed) return;
      closed = true;
      source.close();
      void fetch("/api/dg/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
        keepalive: true,
      }).catch(() => undefined);
    },
  };
}
