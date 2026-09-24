/**
 * Platform-keyed 今日輸贏 / 輸贏報表 buckets.
 *
 * USER RULE: 「今日輸贏是獨立的喔！不要跟dg還有mt混在一起」
 * Storage, totals, and history never share a bucket across MT | DG | SA.
 */

export type ReportPlatformKey = "MT" | "DG" | "SA";

export const REPORT_PLATFORM_KEYS: ReportPlatformKey[] = ["MT", "DG", "SA"];

/** localStorage key for today's PnL total (per platform). */
export function reportPnlStorageKey(platform: ReportPlatformKey) {
  return `report.pnl.${platform}`;
}

/** localStorage key for settled-hand history (per platform). */
export function reportHistoryStorageKey(platform: ReportPlatformKey) {
  return `report.history.${platform}`;
}

/** GMT+8 calendar day — same boundary as SA 站內「今天」00:00:00–23:59:59 UTC+8. */
export function reportDay(now = Date.now()) {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type PlatformDailyPnl = {
  value: number;
  day: string;
  updatedAt: number;
};

export type PlatformReportHistoryEntry = {
  side: "莊" | "閒" | "和";
  result: "莊" | "閒" | "和";
  amount: number;
  pnl: number;
  at: number;
  tableId?: string;
  resultKey?: string;
  gameId?: number;
};

export type PlatformReportBucket = {
  pnl: PlatformDailyPnl | null;
  history: PlatformReportHistoryEntry[];
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readJsonStorage<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonStorage(key: string, value: unknown) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** Load one platform bucket. Never reads another platform's keys. */
export function loadPlatformReport(
  platform: ReportPlatformKey,
  now = Date.now(),
): PlatformReportBucket {
  const day = reportDay(now);
  const pnl = readJsonStorage<PlatformDailyPnl | null>(
    reportPnlStorageKey(platform),
    null,
  );
  const history = readJsonStorage<PlatformReportHistoryEntry[]>(
    reportHistoryStorageKey(platform),
    [],
  );
  const sameDay = pnl?.day === day;
  return {
    pnl: sameDay && pnl && Number.isFinite(pnl.value) ? pnl : null,
    history: sameDay
      ? (Array.isArray(history) ? history : []).filter((h) => {
          if (!h || typeof h.at !== "number") return false;
          return reportDay(h.at) === day;
        })
      : [],
  };
}

export function savePlatformReport(
  platform: ReportPlatformKey,
  bucket: PlatformReportBucket,
) {
  writeJsonStorage(reportPnlStorageKey(platform), bucket.pnl);
  writeJsonStorage(reportHistoryStorageKey(platform), bucket.history);
}

/**
 * Append one SA GameResult settlement into the SA bucket only.
 * Never writes MT/DG keys.
 */
export function applySaReportSettlement(
  prev: PlatformReportBucket,
  entry: PlatformReportHistoryEntry,
  now = Date.now(),
): PlatformReportBucket {
  const day = reportDay(now);
  const baseValue =
    prev.pnl?.day === day && Number.isFinite(prev.pnl.value) ? prev.pnl.value : 0;
  const historyBase =
    prev.pnl?.day === day && Array.isArray(prev.history) ? prev.history : [];
  const next: PlatformReportBucket = {
    pnl: {
      value: Math.round(baseValue + entry.pnl),
      day,
      updatedAt: now,
    },
    history: [entry, ...historyBase].slice(0, 60),
  };
  savePlatformReport("SA", next);
  return next;
}

export function resetPlatformReport(platform: ReportPlatformKey, now = Date.now()) {
  const next: PlatformReportBucket = {
    pnl: { value: 0, day: reportDay(now), updatedAt: now },
    history: [],
  };
  savePlatformReport(platform, next);
  return next;
}

/**
 * Display selector: each platform reads only its own total.
 * SA never falls back to MT; DG never falls back to MT.
 */
export function selectPlatformTodayPnl(
  platform: string,
  buckets: {
    mt: number | null;
    dg: PlatformDailyPnl | null;
    sa: PlatformDailyPnl | null;
  },
  now = Date.now(),
): number | null {
  const day = reportDay(now);
  if (platform === "DG") {
    return buckets.dg?.day === day ? buckets.dg.value : null;
  }
  if (platform === "SA") {
    // SA float always shows a number once the SA bucket is active for today.
    // null only before first load; empty day → 0 (not MT/DG bleed-through).
    if (buckets.sa?.day === day && Number.isFinite(buckets.sa.value))
      return buckets.sa.value;
    return 0;
  }
  if (platform === "MT") return buckets.mt;
  return null;
}

/** Match pending float bet against an SA GameResult table identity. */
export function saResultMatchesPending(
  result: {
    tableId?: string;
    apiId?: string;
    tableBadge?: string;
    roomId?: string;
    hostId?: number;
  },
  pendingTableId: string,
) {
  const want = String(pendingTableId || "").trim();
  if (!want) return false;
  const host = result.hostId != null ? String(result.hostId) : "";
  const room = String(result.roomId || "").trim();
  const badge = String(result.tableBadge || "").trim();
  const api = String(result.apiId || "").trim();
  const id = String(result.tableId || "").trim();
  const candidates = new Set(
    [id, api, badge, room, host, host ? `SA${host}` : "", room ? `SA${room}` : ""]
      .map((x) => String(x || "").trim())
      .filter(Boolean),
  );
  if (candidates.has(want)) return true;
  // Normalize SA901 ↔ 901 ↔ D01 style aliases.
  const strip = (s: string) => s.replace(/^SA/i, "").trim();
  const wantStrip = strip(want);
  for (const c of candidates) {
    if (strip(c) === wantStrip) return true;
  }
  return false;
}

/** Compute baccarat PnL for a settled float bet (shared formula, platform-agnostic). */
export function computeBaccaratBetPnl(
  side: "莊" | "閒" | "和",
  actual: "莊" | "閒" | "和",
  amount: number,
) {
  let pnl = 0;
  let outcome: "win" | "loss" | "push" = "push";
  if (side === "和") {
    if (actual === "和") {
      pnl = amount * 8;
      outcome = "win";
    } else {
      pnl = -amount;
      outcome = "loss";
    }
  } else if (actual === "和") {
    pnl = 0;
    outcome = "push";
  } else if (actual === side) {
    pnl = side === "莊" ? amount * 0.95 : amount;
    outcome = "win";
  } else {
    pnl = -amount;
    outcome = "loss";
  }
  return { pnl: Math.round(pnl), outcome };
}
