export type T9RoadResult = "莊" | "閒" | "和";

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
  results: T9RoadResult[];
  trend: string;
  live?: boolean;
  dealerPhoto?: string;
  streamUrl?: string;
  lastUpdated?: number;
  lastResultKey?: string;
  poker?: string;
  category?: string;
};

type T9Status = "idle" | "loading" | "connecting" | "connected" | "error" | "closed";
type T9Callbacks = {
  onTables: (tables: T9TableData[]) => void;
  onStatus?: (status: T9Status, message?: string) => void;
  onEvent?: (message: string) => void;
};
type T9Controller = { close: () => void };

function jsonOf<T>(event: MessageEvent, fallback: T): T {
  try { return JSON.parse(String(event.data ?? "")) as T; } catch { return fallback; }
}

export async function connectT9Live(
  gameUrl: string,
  sessionId: string,
  callbacks: T9Callbacks,
  options?: { skipStart?: boolean },
): Promise<T9Controller> {
  if (typeof window === "undefined" || typeof EventSource === "undefined")
    throw new Error("T9 即時連線目前僅支援網站版");
  if (!sessionId) throw new Error("登入工作階段已失效");

  let closed = false;
  let source: EventSource | null = null;
  let connected = false;
  if (!options?.skipStart) {
    callbacks.onStatus?.("loading", "正在啟動 T9 即時資料");
    const start = await fetch("/api/t9/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sessionId, gameUrl }),
    });
    const data = await start.json().catch(() => null);
    if (!start.ok || !data?.ok) {
      const message = String(data?.error || `T9 relay 啟動失敗 (${start.status})`);
      callbacks.onStatus?.("error", message);
      throw new Error(message);
    }
  }

  source = new EventSource(`/api/t9/stream?sessionId=${encodeURIComponent(sessionId)}`);
  callbacks.onStatus?.("connecting", "T9 即時牌路連線中...");
  source.addEventListener("status", (raw: Event) => {
    if (closed) return;
    const payload = jsonOf<{ status?: T9Status; message?: string }>(raw as MessageEvent, {});
    const status = payload.status || "connecting";
    if (status === "connected") connected = true;
    callbacks.onStatus?.(status, payload.message);
  });
  source.addEventListener("tables", (raw: Event) => {
    if (closed) return;
    const tables = jsonOf<T9TableData[]>(raw as MessageEvent, []);
    if (Array.isArray(tables)) callbacks.onTables(tables);
  });
  source.addEventListener("event", (raw: Event) => {
    if (closed) return;
    const payload = jsonOf<{ message?: string }>(raw as MessageEvent, {});
    if (payload.message) callbacks.onEvent?.(payload.message);
  });
  source.onerror = () => {
    if (closed || connected) return;
    callbacks.onStatus?.("error", "T9 即時通道中斷");
  };
  return {
    close: () => {
      if (closed) return;
      closed = true;
      try { source?.close(); } catch {}
      source = null;
    },
  };
}
