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
    if (closed) return;
    // EventSource retries by itself. A transport hiccup is NOT a T9 logout.
    // Keep the last valid tables on screen while SSE reconnects.
    callbacks.onStatus?.(
      connected ? "connecting" : "loading",
      "T9 即時資料同步恢復中",
    );
  };

  // SSE is primary. Snapshot polling is a safety net so homepage/floating
  // continue to receive the same relay state even if a proxy/CDN briefly
  // interrupts EventSource.
  let pollBusy = false;
  const pollSnapshot = async () => {
    if (closed || pollBusy) return;
    pollBusy = true;
    try {
      const r = await fetch(
        `/api/t9/snapshot?sessionId=${encodeURIComponent(sessionId)}`,
        { headers: { Accept: "application/json" }, cache: "no-store" as any },
      );
      const data = await r.json().catch(() => null);
      if (closed || !r.ok || !data?.ok) return;
      const tables = Array.isArray(data.tables) ? data.tables : [];
      if (tables.length) callbacks.onTables(tables);
      const status = String(data.status || "");
      if (status === "connected") {
        connected = true;
        callbacks.onStatus?.(
          "connected",
          String(data.message || `T9 已連線 · ${tables.length} 桌`),
        );
      } else if (!connected && (status === "connecting" || status === "loading")) {
        callbacks.onStatus?.(
          "connecting",
          String(data.message || "T9 即時資料連線中..."),
        );
      }
    } catch {
      // Keep last known tables; one failed poll must never destroy T9 session.
    } finally {
      pollBusy = false;
    }
  };
  void pollSnapshot();
  const pollTimer = setInterval(pollSnapshot, 2000);

  return {
    close: () => {
      if (closed) return;
      closed = true;
      clearInterval(pollTimer);
      try { source?.close(); } catch {}
      source = null;
    },
  };
}
