import {
  createElement,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import * as Linking from "expo-linking";
import { useVideoPlayer, VideoView } from "expo-video";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import {
  applyLiveShowWin,
  applyLiveTables,
  applyLiveWait,
  getApiTableId,
  isMtBaccaratTable,
  parseBeadPlate,
  winnerToRoadResult,
  type RoadResult,
} from "@/lib/road-live-state";
import {
  buildBeadGrid,
  buildBigRoad,
  buildDerivedRoad,
  buildRoadWindow,
  buildAskRoad,
} from "@/lib/road-render";
import { connectDgLive, type DgTableData } from "@/lib/dg-live";
import { connectSaLive, type SaTableData, type SaWinReportResult } from "@/lib/sa-live";
import {
  saWinReportTableMatches,
  saWinReportToSettleBody,
  applySaOfficialPnl,
} from "@/lib/sa-report";
import { collectConfirmedMtTableIds } from "@/lib/mt-table-membership";
import { type DgDailyPnl } from "@/lib/dg-report";
import { mtTodayReportDay, mtTodayReportRange } from "@/lib/mt-report";
import { saTableLabel } from "@/lib/sa-table-labels";
import {
  applySaReportSettlement,
  computeBaccaratBetPnl,
  loadPlatformReport,
  resetPlatformReport,
  saResultMatchesPending,
  savePlatformReport,
  selectPlatformTodayPnl,
  type PlatformReportBucket,
  type ReportPlatformKey,
} from "@/lib/platform-report";

type PlatformKey = "MT" | "DG" | "SA" | "MV";

/** Set iframe.src only when the URL actually changes. Rewriting the same src
 *  on every React render reloads DG (spinner / digital table / live video flash). */
function StableGameIframe({
  src,
  style,
  allow,
}: {
  src: string;
  style: Record<string, unknown>;
  allow: string;
}) {
  const frameRef = useRef<any>(null);
  const appliedSrcRef = useRef("");
  useEffect(() => {
    const node = frameRef.current;
    if (!node || !src || appliedSrcRef.current === src) return;
    appliedSrcRef.current = src;
    try {
      node.src = src;
    } catch {}
  }, [src]);
  return createElement("iframe" as any, {
    ref: frameRef,
    style,
    allow,
  });
}

type Result = RoadResult;
type TableData = {
  id: string;
  apiId?: string;
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
  results: Result[];
  trend: string;
  live?: boolean;
  /** SA relay 「開桌」 (TableMode Open/Pause or live round). */
  open?: boolean;
  rest?: number;
  dealerPhoto?: string;
  streamUrl?: string;
  lastUpdated?: number;
  lastResultKey?: string;
  poker?: string;
  category?: string;
};

type StrategyName =
  | "平注"
  | "馬丁"
  | "達朗貝爾"
  | "Fibonacci"
  | "Paroli"
  | "1-3-2-6"
  | "Labouchere"
  | "Oscar's Grind";
type BetSide = "莊" | "閒" | "和";
type BetRecord = {
  side: BetSide;
  result: Result;
  amount: number;
  pnl: number;
  at: number;
};
type PendingBet = {
  tableId: string;
  side: BetSide;
  amount: number;
  resultKey?: string;
  /** Which 今日輸贏 bucket owns this pending settle. */
  reportPlatform?: ReportPlatformKey;
} | null;

const mtLoadingTableIds = [
  "BAG01",
  "BAG02",
  "BAG03",
  "BAG03A",
  "BAG05",
  "BAG06",
  "BAG07",
  "BAG08",
  "BAG09",
  "BAG10",
  "BAG11",
  "BAG12",
  "BAG13",
  "BAG13A",
  "BAG15",
];
const dealerStreamUrls: Record<string, string> = {
  BAG01: "https://pull.bighit888.com/livestream/bag01-1.flv",
  BAG02: "https://pull.bighit888.com/livestream/bag02-1.flv",
  BAG03: "https://pull.bighit888.com/livestream/bag03-1.flv",
  BAG03A: "https://pull.bighit888.com/livestream/bag03a-1.flv",
  BAG05: "https://pull.bighit888.com/livestream/bag05-1.flv",
  BAG06: "https://pull.bighit888.com/livestream/bag06-1.flv",
  BAG07: "https://pull.bighit888.com/livestream/bag07-1.flv",
  BAG08: "https://pull.bighit888.com/livestream/bag08-1.flv",
  BAG09: "https://pull.bighit888.com/livestream/bag09-1.flv",
  BAG10: "https://pull.bighit888.com/livestream/bag10-1.flv",
  BAG11: "https://pull.bighit888.com/livestream/bag11-1.flv",
  BAG12: "https://pull.bighit888.com/livestream/bag12-1.flv",
  BAG13: "https://pull.bighit888.com/livestream/bag13-1.flv",
  BAG13A: "https://pull.bighit888.com/livestream/bag13a-1.flv",
  BAG15: "https://pull.bighit888.com/livestream/bag15-1.flv",
};

let mpegTsLoaderPromise: Promise<any> | null = null;
function ensureMpegTs() {
  if (
    Platform.OS !== "web" ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  )
    return Promise.resolve(null);
  const w = window as any;
  if (w.mpegts) return Promise.resolve(w.mpegts);
  if (mpegTsLoaderPromise) return mpegTsLoaderPromise;
  mpegTsLoaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(
      'script[data-mt-mpegts="1"]',
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve((window as any).mpegts), {
        once: true,
      });
      existing.addEventListener(
        "error",
        () => reject(new Error("mpegts load failed")),
        { once: true },
      );
      return;
    }
    const script = document.createElement("script");
    script.src =
      "https://cdn.jsdelivr.net/npm/mpegts.js@1.8.0/dist/mpegts.min.js";
    script.async = true;
    script.dataset.mtMpegts = "1";
    script.onload = () => resolve((window as any).mpegts);
    script.onerror = () => reject(new Error("mpegts load failed"));
    document.head.appendChild(script);
  });
  return mpegTsLoaderPromise;
}
// Visual road templates shown only while the first authoritative /tables
// snapshot is loading. They are never used as the live membership whitelist.
const initialTables: TableData[] = mtLoadingTableIds.map((apiId) => ({
  id: apiId,
  apiId,
  game: "百家樂",
  name: "—",
  players: "—",
  roomId: "—",
  tableBadge: "—",
  shoe: "—",
  round: 0,
  banker: 0,
  player: 0,
  tie: 0,
  results: [],
  trend: "",
  live: false,
}));
const dgPlaceholderDefs = [
  ["BAC001", "RB01", "60101"],
  ["BAC002", "RB02", "60102"],
  ["BAC003", "RB03", "60103"],
  ["BAC004", "RB04", "60104"],
  ["BAC005", "RB05", "60105"],
  ["TID348", "S01", "50101"],
  ["TID349", "S02", "50102"],
  ["TID350", "S03", "50103"],
  ["TID351", "S05", "50104"],
  ["TID352", "S06", "50105"],
  ["TID354", "S07", "50106"],
  ["TID77842", "S09", "50107"],
  ["TID77846", "S10", "50108"],
] as const;
const dgPlaceholderTables: TableData[] = dgPlaceholderDefs.map(
  ([apiId, roomId, tableBadge]) => ({
    id: apiId,
    apiId,
    game: "百家樂",
    name: "—",
    players: "—",
    roomId,
    tableBadge,
    shoe: "—",
    round: 0,
    banker: 0,
    player: 0,
    tie: 0,
    results: [],
    trend: "",
    live: false,
  }),
);

// SA desks come only from relay 「開桌」(Init Rest Open/Pause, GameStart,
// GameRest, or live roads). Never seed from sa-table-labels.json catalog.

/**
 * Client safety net — open desks only.
 * open===true keeps empty road shells (DG pattern). Never require results.
 */
function isSaOpenTable(t: {
  results?: unknown[];
  round?: number;
  live?: boolean;
  countdown?: number;
  open?: boolean;
}): boolean {
  if (t.open === true) return true;
  if ((t.results?.length || 0) > 0) return true;
  if ((t.round || 0) > 0) return true;
  if (t.live && (t.countdown || 0) > 0) return true;
  return false;
}

const lineContactUrl = "https://line.me/ti/p/k2pkYGXGL3";
const threadsUrl = "https://www.threads.com/@uss0857?igshid=NTc4MTIwNjQ2YQ==";
const tzRegisterUrl = "https://shy9453.tz6868.cc";
const resultColor = (r?: Result) =>
  r === "莊"
    ? "#EF4E57"
    : r === "閒"
      ? "#2879E5"
      : r === "和"
        ? "#20B66B"
        : "#70889A";
const strategies: StrategyName[] = [
  "平注",
  "馬丁",
  "達朗貝爾",
  "Fibonacci",
  "Paroli",
  "1-3-2-6",
  "Labouchere",
  "Oscar's Grind",
];

function openLineContact() {
  if (typeof window !== "undefined")
    window.open(lineContactUrl, "_blank", "noopener,noreferrer");
  else Linking.openURL(lineContactUrl).catch(() => undefined);
}
function openThreads() {
  if (typeof window !== "undefined")
    window.open(threadsUrl, "_blank", "noopener,noreferrer");
  else Linking.openURL(threadsUrl).catch(() => undefined);
}
function openTzRegister() {
  if (typeof window !== "undefined")
    window.open(tzRegisterUrl, "_blank", "noopener,noreferrer");
  else Linking.openURL(tzRegisterUrl).catch(() => undefined);
}

type PatternInfo = {
  type:
    "資料累積中" | "一房兩廳" | "單跳" | "雙跳" | "連龍" | "一般連" | "混合";
  label: string;
  side?: "莊" | "閒";
  run?: number;
};

function roadSides(results: Result[]): ("莊" | "閒")[] {
  return results.filter((r): r is "莊" | "閒" => r === "莊" || r === "閒");
}

function columnRuns(results: Result[]) {
  const seq = roadSides(results);
  const runs: { side: "莊" | "閒"; length: number }[] = [];
  for (const side of seq) {
    const last = runs[runs.length - 1];
    if (last?.side === side) last.length += 1;
    else runs.push({ side, length: 1 });
  }
  return runs;
}

function tailAlternating(
  runs: { side: "莊" | "閒"; length: number }[],
  size: number,
  len: number,
) {
  if (runs.length < size) return false;
  const x = runs.slice(-size);
  return (
    x.every((r) => r.length === len) &&
    x.every((r, i) => i === 0 || r.side !== x[i - 1].side)
  );
}

function getPatternInfo(results: Result[]): PatternInfo {
  const seq = roadSides(results);
  const runs = columnRuns(results);
  if (seq.length < 3 || !runs.length)
    return { type: "資料累積中", label: "資料累積中" };
  const lastRun = runs[runs.length - 1];

  // 使用實際大路「柱」判斷，不再只抓 raw results 最後三顆。
  // 使用者規則：連 4 起才叫龍；連 2/3 只叫連。
  if (lastRun.length >= 4)
    return {
      type: "連龍",
      label: `${lastRun.side}龍${lastRun.length}顆`,
      side: lastRun.side,
      run: lastRun.length,
    };

  // 單跳：至少最近四柱都是 1 格。
  if (tailAlternating(runs, 4, 1))
    return { type: "單跳", label: "單跳", side: lastRun.side };

  // 雙跳：至少最近三柱都是 2 格。
  if (tailAlternating(runs, 3, 2))
    return { type: "雙跳", label: "雙跳", side: lastRun.side };

  // 兩閒一莊 / 兩莊一閒：
  // 禁止只看最後 3 柱的 2-1-2 就命名。至少要看到兩次完整重複節奏，
  // 才能確認這是一個持續牌型；否則視為轉型/混合路，再交由下三路與問路確認。
  if (runs.length >= 6) {
    const x = runs.slice(-6);
    const twoPlayerOneBanker =
      x[0].side === "閒" &&
      x[0].length === 2 &&
      x[1].side === "莊" &&
      x[1].length === 1 &&
      x[2].side === "閒" &&
      x[2].length === 2 &&
      x[3].side === "莊" &&
      x[3].length === 1 &&
      x[4].side === "閒" &&
      x[4].length === 2 &&
      x[5].side === "莊" &&
      x[5].length === 1;
    const twoBankerOnePlayer =
      x[0].side === "莊" &&
      x[0].length === 2 &&
      x[1].side === "閒" &&
      x[1].length === 1 &&
      x[2].side === "莊" &&
      x[2].length === 2 &&
      x[3].side === "閒" &&
      x[3].length === 1 &&
      x[4].side === "莊" &&
      x[4].length === 2 &&
      x[5].side === "閒" &&
      x[5].length === 1;
    if (twoPlayerOneBanker)
      return { type: "一房兩廳", label: "兩閒一莊", side: "閒" };
    if (twoBankerOnePlayer)
      return { type: "一房兩廳", label: "兩莊一閒", side: "莊" };
  }

  if (lastRun.length >= 2)
    return {
      type: "一般連",
      label: `${lastRun.side}連${lastRun.length}`,
      side: lastRun.side,
      run: lastRun.length,
    };
  return { type: "混合", label: "轉型／混合路", side: lastRun.side };
}

function derivedTailPreference(
  results: Result[],
  offset: 1 | 2 | 3,
): "莊" | "閒" | null {
  const marks = buildDerivedRoad(results, offset, offset === 2);
  if (!marks.length) return null;
  const seq = marks
    .map((m) => m.result)
    .filter((r): r is "莊" | "閒" => r === "莊" || r === "閒");
  if (!seq.length) return null;

  // 先看尾段自己的節奏：連則續色；明顯交替則續跳。
  const last = seq[seq.length - 1];
  let run = 1;
  for (let i = seq.length - 2; i >= 0 && seq[i] === last; i--) run++;
  if (run >= 2) return last;
  if (seq.length >= 4) {
    const x = seq.slice(-4);
    if (x[0] !== x[1] && x[1] !== x[2] && x[2] !== x[3])
      return last === "莊" ? "閒" : "莊";
  }

  // 無明顯尾型時參考整段較近期的結構，但不把紅藍直接當莊閒。
  const tail = seq.slice(-8);
  let same = 0,
    change = 0;
  for (let i = 1; i < tail.length; i++)
    tail[i] === tail[i - 1] ? same++ : change++;
  return change > same ? (last === "莊" ? "閒" : "莊") : last;
}

function roadDecision(results: Result[]) {
  const seq = roadSides(results);
  if (!seq.length)
    return {
      side: "莊" as const,
      scoreBanker: 0,
      scorePlayer: 0,
      reason: "等待牌路資料",
    };

  const info = getPatternInfo(results);
  const ask = buildAskRoad(results);
  const prefs = [
    derivedTailPreference(results, 1),
    derivedTailPreference(results, 2),
    derivedTailPreference(results, 3),
  ];
  const bankerAsk = [ask.banker.bigEye, ask.banker.small, ask.banker.cockroach];
  const playerAsk = [ask.player.bigEye, ask.player.small, ask.player.cockroach];

  let b = 0,
    p = 0;
  // 三條下三路等權重：問路新增色若符合該路目前節奏就加分。
  prefs.forEach((pref, i) => {
    if (!pref) return;
    if (bankerAsk[i] === pref) b += 2;
    if (playerAsk[i] === pref) p += 2;
  });

  const runs = columnRuns(results);
  const last = seq[seq.length - 1];
  // 大路整體牌型作主判斷；下三路與問路作二次確認。
  if (info.type === "連龍") {
    if (last === "莊") b += 4;
    else p += 4;
  } else if (info.type === "單跳") {
    if (last === "莊") p += 4;
    else b += 4;
  } else if (info.type === "雙跳") {
    if (last === "莊") b += 4;
    else p += 4;
  } else if (info.type === "一房兩廳" && info.side) {
    if (info.side === "莊") b += 3;
    else p += 3;
  } else if (info.type === "一般連") {
    if (last === "莊") b += 2;
    else p += 2;
  }

  // 全路段柱型微量參考，避免只看尾端。
  const recentRuns = runs.slice(-10);
  const bankerDepth = recentRuns
    .filter((r) => r.side === "莊")
    .reduce((s, r) => s + r.length, 0);
  const playerDepth = recentRuns
    .filter((r) => r.side === "閒")
    .reduce((s, r) => s + r.length, 0);
  if (bankerDepth > playerDepth) b += 0.5;
  else if (playerDepth > bankerDepth) p += 0.5;

  // 強制二選一；完全同分時以問路吻合數，再以目前大路轉向決勝。
  const side: "莊" | "閒" =
    b === p ? (last === "莊" ? "閒" : "莊") : b > p ? "莊" : "閒";
  const fmt = (x: Result | null) =>
    x === "莊" ? "紅" : x === "閒" ? "藍" : "—";
  return {
    side,
    scoreBanker: b,
    scorePlayer: p,
    reason: `${info.label}｜莊問路 ${bankerAsk.map(fmt).join("・")}｜閒問路 ${playerAsk.map(fmt).join("・")}｜三路綜合 ${b.toFixed(1)}:${p.toFixed(1)}`,
  };
}

function detectPattern(results: Result[]) {
  return getPatternInfo(results).label;
}

// Convert the existing road score gap into a 0–100 signal-strength percentage.
// This does not change roadDecision(); it only gives the existing decision a display confidence.
function confidencePercent(scoreBanker: number, scorePlayer: number) {
  const gap = Math.abs(scoreBanker - scorePlayer);
  return Math.max(0, Math.min(100, Math.round((gap / 6) * 100)));
}
function confidenceState(percent: number) {
  if (percent >= 80) return { label: "高可信", color: "#43E07A" };
  if (percent >= 50) return { label: "中可信", color: "#FFD447" };
  return { label: "低可信", color: "#FF5B63" };
}

function recommendSide(results: Result[]): "莊" | "閒" {
  return roadDecision(results).side;
}

function analysisText(table?: TableData) {
  if (!table) return "等待牌局資料。";
  const seq = roadSides(table.results);
  if (seq.length < 3) return "目前資料累積中，第三顆開始判斷牌型。";

  const info = getPatternInfo(table.results);
  const d = roadDecision(table.results);
  const ask = buildAskRoad(table.results);
  const prefs = [
    derivedTailPreference(table.results, 1),
    derivedTailPreference(table.results, 2),
    derivedTailPreference(table.results, 3),
  ];

  const colorName = (x: Result | null) =>
    x === "莊" ? "紅" : x === "閒" ? "藍" : "—";
  const prefName = (x: "莊" | "閒" | null) =>
    x === "莊" ? "偏紅" : x === "閒" ? "偏藍" : "資料不足";

  const bankerAsk = [ask.banker.bigEye, ask.banker.small, ask.banker.cockroach];
  const playerAsk = [ask.player.bigEye, ask.player.small, ask.player.cockroach];

  return [
    `【大路】${info.label}。`,
    `【大眼仔】${prefName(prefs[0])}；【小路】${prefName(prefs[1])}；【曱甴路】${prefName(prefs[2])}。`,
    `【莊問路】${bankerAsk.map(colorName).join("・")}；【閒問路】${playerAsk.map(colorName).join("・")}。`,
    `【綜合】莊 ${d.scoreBanker.toFixed(1)}／閒 ${d.scorePlayer.toFixed(1)}，整段牌路與三路問路綜合後，我會選${d.side}。`,
  ].join("\n");
}

function strategyAmount(
  name: StrategyName,
  base: number,
  level: number,
  lab: number[],
) {
  const b = Math.max(0, base || 0);
  if (name === "馬丁") return b * (Math.pow(2, Math.max(0, level) + 1) - 1);
  if (name === "達朗貝爾") return b * (Math.max(0, level) + 1);
  if (name === "Fibonacci") {
    const fib = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
    return b * fib[Math.min(level, fib.length - 1)];
  }
  if (name === "Paroli")
    return b * Math.pow(2, Math.min(Math.max(0, level), 2));
  if (name === "1-3-2-6")
    return b * [1, 3, 2, 6][Math.min(Math.max(0, level), 3)];
  if (name === "Labouchere") {
    const seq = lab.length ? lab : [1, 2, 3, 4];
    return b * (seq.length === 1 ? seq[0] : seq[0] + seq[seq.length - 1]);
  }
  if (name === "Oscar's Grind") return b * (Math.max(0, level) + 1);
  return b;
}

const ROAD_SPEC = {
  colors: {
    hollowRed: "#E6352B",
    hollowBlue: "#4578D4",
    solidRed: "#EF3215",
    solidBlue: "#2D64F5",
    slashRed: "#CC2419",
    slashBlue: "#2476E2",
    tie: "#20B66B",
  },
} as const;

function ResultDot({ result, desktop }: { result: Result; desktop: boolean }) {
  const color =
    result === "莊"
      ? ROAD_SPEC.colors.solidRed
      : result === "閒"
        ? ROAD_SPEC.colors.solidBlue
        : ROAD_SPEC.colors.tie;
  return (
    <View
      style={[
        s.beadDot,
        desktop && s.beadDotDesktop,
        { backgroundColor: color, borderColor: color },
      ]}
    >
      <Text
        allowFontScaling={false}
        style={[s.beadDotText, desktop && s.beadDotTextDesktop]}
      >
        {result}
      </Text>
    </View>
  );
}

function derivedColor(ri: number, result: Result) {
  const red = result === "莊";
  if (ri === 0)
    return red ? ROAD_SPEC.colors.hollowRed : ROAD_SPEC.colors.hollowBlue;
  if (ri === 1)
    return red ? ROAD_SPEC.colors.solidRed : ROAD_SPEC.colors.solidBlue;
  return red ? ROAD_SPEC.colors.slashRed : ROAD_SPEC.colors.slashBlue;
}

function buildSlidingBeadGrid(results: Result[]): Array<Result | undefined> {
  // 珠盤固定 6 欄 × 6 列，並以「整欄 6 顆」為單位滑動。
  // 1~36 顆：全部顯示。
  // 第 37 顆：立刻移除最左欄 6 顆，只留下第 7~37 顆（31 顆），
  //           第 37 顆位於最右新欄第一格，下面 5 格保持空白。
  // 第 38~42 顆：依序往該新欄下方填。
  // 第 43 顆：再次立刻移除當時最左欄 6 顆，只留下第 13~43 顆。
  if (!results.length) return Array(36).fill(undefined);

  // 每多開滿一個新欄的第一顆（37、43、49...），就淘汰一整欄 6 顆。
  const columnsToDrop = Math.max(0, Math.floor((results.length - 1) / 6) - 5);
  const startIndex = columnsToDrop * 6;
  const visible = results.slice(startIndex);

  return buildBeadGrid(visible);
}

// 牌路 UI：73.62×87.66 是 294.54×97.88 設計稿中的珠盤基準尺寸。
// 實際畫面依桌卡等比例放大/縮小；禁止把珠盤固定成 73.62 CSS px 而縮成一條。
// 空間不足時由外層 UI 撐開，禁止 flex/grid 拉伸珠盤單格。
function RoadGrid({
  table,
  desktop,
  platform = "MT",
}: {
  table: TableData;
  desktop: boolean;
  platform?: PlatformKey;
}) {
  const dg = platform === "DG";
  const ab = platform === "SA";
  const db = platform === "MV";
  const roadCellTheme = dg ? s.roadCellDg : ab ? s.roadCellAb : db ? s.roadCellDb : null;
  const beads = useMemo(
    () => buildSlidingBeadGrid(table.results),
    [table.results],
  );
  const big = useMemo(
    () => buildRoadWindow(buildBigRoad(table.results), 15),
    [table.results],
  );
  const lower = useMemo(
    () => [
      buildRoadWindow(buildDerivedRoad(table.results, 1, false), 10),
      buildRoadWindow(buildDerivedRoad(table.results, 2, true), 10),
      buildRoadWindow(buildDerivedRoad(table.results, 3, false), 10),
    ],
    [table.results],
  );
  return (
    <View
      style={[
        s.roadArea,
        desktop && s.roadAreaDesktop,
        dg && s.roadAreaDg,
        ab && s.roadAreaAb,
        db && s.roadAreaDb,
      ]}
    >
      <View
        style={[
          s.beadPane,
          desktop && s.beadPaneDesktop,
          dg && s.beadPaneDg,
          ab && s.beadPaneAb,
          db && s.beadPaneDb,
        ]}
      >
        <View style={[s.beadGrid, dg && s.beadGridDg, ab && s.beadGridAb, db && s.beadGridDb]}>
          {Array.from({ length: 36 }, (_, i) => (
            <View
              key={i}
              style={[
                s.beadCell,
                desktop && s.beadCellDesktop,
                roadCellTheme,
              ]}
            >
              {beads[i] ? (
                <ResultDot result={beads[i]!} desktop={desktop} />
              ) : null}
            </View>
          ))}
        </View>
      </View>
      <View style={s.roadStack}>
        <View style={[s.bigGrid, desktop && s.bigGridDesktop]}>
          {Array.from({ length: 90 }, (_, i) => {
            const row = Math.floor(i / 15),
              col = i % 15,
              m = big.find((x) => x.row === row && x.col === col);
            return (
              <View
                key={i}
                style={[
                  s.bigCell,
                  desktop && s.bigCellDesktop,
                  roadCellTheme,
                ]}
              >
                {m ? (
                  <View
                    style={[
                      s.bigMark,
                      desktop && s.bigMarkDesktop,
                      {
                        borderColor:
                          m.result === "莊"
                            ? ROAD_SPEC.colors.hollowRed
                            : m.result === "閒"
                              ? ROAD_SPEC.colors.hollowBlue
                              : ROAD_SPEC.colors.tie,
                      },
                    ]}
                  >
                    {m.tieCount ? (
                      <Text
                        style={[s.tieNumber, desktop && s.tieNumberDesktop]}
                      >
                        {m.tieCount}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
        <View
          style={[
            s.lowerArea,
            desktop && s.lowerAreaDesktop,
            dg && s.lowerAreaDg,
            ab && s.lowerAreaAb,
            db && s.lowerAreaDb,
          ]}
        >
          {lower.map((road, ri) => (
            <View
              key={ri}
              style={[
                s.lowerPane,
                dg && s.lowerPaneDg,
                ab && s.lowerPaneAb,
                db && s.lowerPaneDb,
              ]}
            >
              {Array.from({ length: 60 }, (_, i) => {
                const row = Math.floor(i / 10),
                  col = i % 10,
                  m = road.find((x) => x.row === row && x.col === col);
                if (!m)
                  return (
                    <View
                      key={i}
                      style={[
                        s.lowerCell,
                        desktop && s.lowerCellDesktop,
                        roadCellTheme,
                      ]}
                    />
                  );
                const color = derivedColor(ri, m.result);
                return (
                  <View
                    key={i}
                    style={[
                      s.lowerCell,
                      desktop && s.lowerCellDesktop,
                      roadCellTheme,
                    ]}
                  >
                    {ri === 0 ? (
                      <View style={[s.lowerHollow, { borderColor: color }]} />
                    ) : ri === 1 ? (
                      <View
                        style={[s.lowerSolid, { backgroundColor: color }]}
                      />
                    ) : (
                      <View
                        style={[s.lowerSlash, { backgroundColor: color }]}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function CountdownBadge({
  count,
  updatedAt,
  tick = true,
}: {
  count?: number;
  updatedAt?: number;
  tick?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!tick || count == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [tick, count]);
  // Only show real betting countdown (1–60). Hide garbage / 發牌中 zeros.
  const raw = count == null ? null : Number(count);
  const sane =
    raw != null && Number.isFinite(raw) && raw >= 1 && raw <= 60 ? raw : null;
  const elapsed = tick && updatedAt && sane != null
    ? Math.floor((now - updatedAt) / 1000)
    : 0;
  const shown = sane == null ? null : Math.max(0, sane - elapsed);
  return (
    <View style={s.countWrap}>
      <MaterialIcons name="schedule" size={11} color="#DDE8F0" />
      <Text style={s.countdown}>
        {shown == null || shown <= 0 ? "—" : shown}
      </Text>
    </View>
  );
}

function DealerLiveVideo({
  table,
  enabled,
  connected,
}: {
  table: TableData;
  enabled: boolean;
  connected: boolean;
}) {
  const tableId = table.apiId ?? `BAG${table.id}`;
  const url = table.streamUrl ?? dealerStreamUrls[tableId];
  const videoRef = useRef<any>(null);
  const playerRef = useRef<any>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
    setPlaying(false);
    if (Platform.OS !== "web" || !enabled || !connected || !url) return;
    let disposed = false;
    const destroy = () => {
      const p = playerRef.current;
      playerRef.current = null;
      if (p) {
        try {
          p.pause?.();
        } catch {}
        try {
          p.unload?.();
        } catch {}
        try {
          p.detachMediaElement?.();
        } catch {}
        try {
          p.destroy?.();
        } catch {}
      }
    };
    const start = async () => {
      try {
        const mpegts = await ensureMpegTs();
        if (disposed || !mpegts || !videoRef.current) return;
        if (!mpegts.getFeatureList?.()?.mseLivePlayback) return;
        destroy();
        const video = videoRef.current;
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        const player = mpegts.createPlayer(
          { type: "flv", isLive: true, url },
          {
            enableWorker: true,
            enableStashBuffer: true,
            stashInitialSize: 384,
            lazyLoad: false,
            liveBufferLatencyChasing: true,
            autoCleanupSourceBuffer: true,
            autoCleanupMaxBackwardDuration: 30,
            autoCleanupMinBackwardDuration: 8,
          },
        );
        playerRef.current = player;
        player.attachMediaElement(video);
        if (mpegts.Events?.ERROR)
          player.on(mpegts.Events.ERROR, () => {
            if (disposed) return;
            setPlaying(false);
            destroy();
            retryRef.current = setTimeout(start, 1800);
          });
        video.onplaying = () => {
          if (!disposed) setPlaying(true);
        };
        video.onstalled = () => {
          if (!disposed) setPlaying(false);
        };
        video.onerror = () => {
          if (!disposed) {
            setPlaying(false);
            destroy();
            retryRef.current = setTimeout(start, 1800);
          }
        };
        player.load();
        Promise.resolve(player.play()).catch(() => undefined);
      } catch {
        if (!disposed) retryRef.current = setTimeout(start, 2200);
      }
    };
    start();
    return () => {
      disposed = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = null;
      destroy();
    };
  }, [tableId, url, enabled, connected]);

  return (
    <View style={s.liveMediaFill}>
      {table.dealerPhoto ? (
        Platform.OS === "web" ? (
          // SA room covers are landscape (dealer centered). Cover + center
          // crop into the tall photo slot = 裁荷官 (sides/table cut away).
          createElement("img" as any, {
            src: table.dealerPhoto,
            alt: "",
            draggable: false,
            style: {
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center 32%",
              transform: "scale(1.55)",
              transformOrigin: "center 28%",
              background: "#0a1018",
            },
          })
        ) : (
          <Image source={{ uri: table.dealerPhoto }} style={s.photoImage} />
        )
      ) : (
        <Text style={s.crown}>♛</Text>
      )}
      {Platform.OS === "web" && enabled && connected && url
        ? createElement("video" as any, {
            ref: (node: any) => {
              videoRef.current = node;
            },
            muted: true,
            autoPlay: true,
            playsInline: true,
            controls: false,
            style: {
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              background: "#000",
              opacity: playing ? 1 : 0,
              pointerEvents: "none",
            },
          })
        : null}
    </View>
  );
}

function TableCard({
  table,
  desktop,
  onAction,
  connected,
  platform = "MT",
  scaled = false,
}: {
  table: TableData;
  desktop: boolean;
  onAction: (kind: string, table: TableData) => void;
  connected: boolean;
  platform?: PlatformKey;
  scaled?: boolean;
}) {
  const dg = platform === "DG";
  const ab = platform === "SA";
  const db = platform === "MV";
  const tableId = table.apiId ?? `BAG${table.id}`;
  const [videoEnabled, setVideoEnabled] = useState(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(`mt.video.${tableId}`) === "1";
    } catch {
      return false;
    }
  });
  const toggleVideo = () =>
    setVideoEnabled((v) => {
      const next = !v;
      if (Platform.OS === "web" && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(`mt.video.${tableId}`, next ? "1" : "0");
        } catch {}
      }
      return next;
    });
  return (
    <View
      style={[
        s.tableCard,
        desktop && s.tableCardDesktop,
        dg && s.tableCardDg,
        ab && s.tableCardAb,
        db && s.tableCardDb,
        scaled && s.tableCardScaled,
      ]}
    >
      <View style={[s.tableHead, dg && s.tableHeadDg, ab && s.tableHeadAb, db && s.tableHeadDb]}>
        <View style={s.row}>
          <Text style={s.game}>{table.game || "百家樂"}</Text>
          <Text style={[s.tableId, dg && s.tableIdDg, ab && s.tableIdAb, db && s.tableIdDb]}>
            {ab
              ? table.tableBadge || table.name || table.id || table.roomId
              : table.id}
          </Text>
          <MaterialIcons name="person" size={12} color="#fff" />
          <Text style={s.headText}>{table.players}</Text>
          <CountdownBadge
            count={table.countdown}
            updatedAt={table.countdownUpdatedAt}
            tick={platform === "MT" || platform === "DG" || platform === "SA"}
          />
        </View>
        <View style={s.row}>
          <Text style={[s.statText, { color: "#F35762" }]}>
            莊 {table.banker}
          </Text>
          <Text style={[s.statText, { color: "#4D96F3" }]}>
            閒 {table.player}
          </Text>
          <Text style={[s.statText, { color: "#45C98A" }]}>和 {table.tie}</Text>
          <Pressable
            style={[s.miniBtn, { backgroundColor: "#7043C9" }]}
            onPress={() => onAction("分析", table)}
          >
            <Text style={s.miniBtnText}>分析</Text>
          </Pressable>
          <Pressable
            style={[s.miniBtn, { backgroundColor: "#208C55" }]}
            onPress={() => onAction("關注", table)}
          >
            <Text style={s.miniBtnText}>關注</Text>
          </Pressable>
          <Pressable
            style={[
              s.miniBtn,
              {
                backgroundColor: dg
                  ? "#9A7332"
                  : ab
                    ? "#4A3488"
                    : db
                      ? "#1A6B5C"
                      : "#1681C7",
              },
            ]}
            onPress={() => onAction("平台", table)}
          >
            <Text style={s.miniBtnText}>{platform}平台</Text>
          </Pressable>
        </View>
      </View>
      <View
        style={[
          s.tableBody,
          desktop ? s.tableBodyDesktop : s.tableBodyMobile,
          dg && s.tableBodyDg,
          ab && s.tableBodyAb,
          db && s.tableBodyDb,
        ]}
      >
        <View
          style={[
            s.dealer,
            desktop ? s.dealerDesktop : s.dealerMobile,
            dg && s.dealerDg,
            ab && s.dealerAb,
            db && s.dealerDb,
          ]}
        >
          <View style={[s.photo, desktop ? s.photoDesktop : s.photoMobile]}>
            <DealerLiveVideo
              table={table}
              enabled={videoEnabled}
              connected={connected}
            />
          </View>
          <Text style={[s.dealerName, dg && s.dealerNameDg, ab && s.dealerNameAb, db && s.dealerNameDb]}>
            {ab
              ? table.name || table.tableBadge || table.id || "—"
              : table.name || "—"}
          </Text>
          <Text style={s.meta}>
            {ab
              ? (() => {
                  const label =
                    table.tableBadge || table.name || table.id || table.roomId || "—";
                  const dealer =
                    table.trend && table.trend !== label
                      ? table.trend
                      : table.players && table.players !== "—"
                        ? table.players
                        : "";
                  return dealer ? `${label} · 荷官 ${dealer}` : String(label);
                })()
              : `房間 ${table.roomId || table.id}`}
          </Text>
          <View style={s.metaVideoRow}>
            <Text numberOfLines={1} style={[s.meta, s.metaVideoText]}>
              Shoe {table.shoe} · 第 {table.round} 把
            </Text>
            <Text style={s.videoLabel}>視訊</Text>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: videoEnabled }}
              onPress={toggleVideo}
              hitSlop={5}
              style={[s.videoSwitch, videoEnabled && s.videoSwitchOn]}
            >
              <View
                style={[s.videoSwitchKnob, videoEnabled && s.videoSwitchKnobOn]}
              />
            </Pressable>
          </View>
        </View>
        <RoadGrid table={table} desktop={desktop} platform={platform} />
      </View>
    </View>
  );
}

// Keep unchanged table cards out of the high-frequency WebSocket render path.
// The connection still receives every packet; only cards whose TableData reference
// actually changed are reconciled again.
function MatrixMark({
  size = 28,
  brand = "MT",
}: {
  size?: number;
  brand?: PlatformKey;
}) {
  return (
    <View
      style={[
        s.matrixMark,
        { width: size, height: size, borderRadius: Math.max(7, size * 0.23) },
      ]}
    >
      <View style={s.matrixMarkInner}>
        <Text
          style={[
            s.matrixMarkText,
            brand === "DG" && s.matrixMarkTextDg,
            brand === "SA" && s.matrixMarkTextAb,
            brand === "MV" && s.matrixMarkTextDb,
            { fontSize: Math.max(10, size * 0.34) },
          ]}
        >
          {brand}
        </Text>
        <View
          style={[
            s.matrixMarkAccent,
            brand === "DG" && s.matrixMarkAccentDg,
            brand === "SA" && s.matrixMarkAccentAb,
            brand === "MV" && s.matrixMarkAccentDb,
          ]}
        />
      </View>
    </View>
  );
}
function ThreadsSignature({ mobile = false }: { mobile?: boolean }) {
  return (
    <View
      style={[s.threadsSignature, mobile ? s.threadsSignatureMobile : null]}
    >
      <FontAwesome6 name="threads" size={mobile ? 12 : 13} color="#F2F8FC" />
      {mobile ? <Text style={s.threadsWord}>Threads</Text> : null}
      <Text style={[s.threadsId, mobile ? s.threadsIdMobile : null]}>
        @uss0857
      </Text>
    </View>
  );
}

const MemoTableCard = memo(TableCard);

function LiveStreamCard({
  table,
  desktop,
  onEnter,
  busy,
}: {
  table: TableData;
  desktop: boolean;
  onEnter: (table: TableData) => void;
  busy?: boolean;
}) {
  const isLive = !!table.live;
  const comingSoon =
    table.category === "comingSoon" ||
    table.name === "老爺" ||
    /敬請期待|人家還沒好/.test(String(table.trend || table.players || ""));
  const title = String(table.trend || table.roomId || "").trim();
  const badge = isLive ? "LIVE" : comingSoon ? "敬請期待" : "休息中";
  const cta = isLive ? "進入直播" : comingSoon ? "敬請期待" : "尚未開播";
  const meta =
    title ||
    (isLive
      ? "直播中 · 點擊進入觀看"
      : comingSoon
        ? "老爺人家還沒好，請敬請期待"
        : "目前未開播 · 主頁仍會顯示");
  return (
    <Pressable
      disabled={busy || !isLive}
      onPress={() => onEnter(table)}
      style={[
        s.liveCard,
        desktop && s.liveCardDesktop,
        (busy || !isLive) && { opacity: isLive ? 0.55 : 0.88 },
      ]}
    >
      <View style={s.liveCardMedia}>
        {table.dealerPhoto ? (
          Platform.OS === "web" ? (
            // RN Web Image paints via background-image and ignores objectPosition;
            // use a real <img> so cover + top-center keeps faces in frame.
            createElement("img" as any, {
              src: table.dealerPhoto,
              alt: "",
              draggable: false,
              style: {
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "center top",
                opacity: isLive ? 1 : 0.55,
              },
            })
          ) : (
            <Image
              source={{ uri: table.dealerPhoto }}
              resizeMode="cover"
              style={[s.liveCardPhoto, !isLive && s.liveCardPhotoOff]}
            />
          )
        ) : (
          <>
            <View style={s.liveCardGlow} />
            <MaterialIcons
              name={comingSoon ? "favorite-border" : "videocam"}
              size={desktop ? 34 : 28}
              color="#7EE0D2"
            />
            {comingSoon ? (
              <Text style={s.liveCardSoonText}>敬請期待</Text>
            ) : null}
          </>
        )}
        <View style={[s.liveBadge, !isLive && s.liveBadgeOff]}>
          {isLive ? <View style={s.liveBadgeDot} /> : null}
          <Text style={s.liveBadgeText}>{badge}</Text>
        </View>
      </View>
      <View style={s.liveCardBody}>
        <Text numberOfLines={1} style={s.liveCardTitle}>
          {table.name}
        </Text>
        <Text numberOfLines={2} style={s.liveCardMeta}>
          {meta}
        </Text>
        <View style={[s.liveCardCta, !isLive && s.liveCardCtaOff]}>
          <MaterialIcons
            name={isLive ? "play-circle-filled" : "schedule"}
            size={14}
            color={isLive ? "#E8FFF9" : "#9BB8B0"}
          />
          <Text style={[s.liveCardCtaText, !isLive && s.liveCardCtaTextOff]}>
            {cta}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const MemoLiveStreamCard = memo(LiveStreamCard);

const FloatingOrb = memo(function FloatingOrb({
  position,
  responder,
  size,
  iconSize,
  connected,
  insideMt = false,
  platform = "MT",
}: {
  position: Animated.ValueXY;
  responder: ReturnType<typeof PanResponder.create>;
  size: number;
  iconSize: number;
  connected: boolean;
  insideMt?: boolean;
  platform?: PlatformKey;
}) {
  return (
    <Animated.View
      style={[
        s.orb,
        { width: size, height: size, borderRadius: size / 2 },
        insideMt && s.orbMt,
        { transform: position.getTranslateTransform() },
      ]}
      {...responder.panHandlers}
    >
      <MatrixMark size={Math.max(30, iconSize * 1.35)} brand={platform} />
      <View
        pointerEvents="none"
        style={[
          s.orbStatus,
          {
            width: Math.max(8, size * 0.16),
            height: Math.max(8, size * 0.16),
            borderRadius: size * 0.08,
            right: size * 0.08,
            top: size * 0.08,
            backgroundColor: connected ? "#36C46B" : "#788C9B",
          },
        ]}
      />
    </Animated.View>
  );
});

async function loginToPlatformFromBrowser(
  platform: "TZ" | "OFA",
  username: string,
  password: string,
  deviceId: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const base =
    platform === "OFA" ? "https://www.ofa1188.net" : "https://www.tz6868.cc";
  try {
    const response = await fetch(`${base}/api/v1/login`, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
      },
      body: JSON.stringify({ username, password, device_id: deviceId }),
      signal: controller.signal,
    });
    const text = await response.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    const token =
      data?.data?.token ??
      data?.token ??
      data?.data?.access_token ??
      data?.access_token;
    if (!response.ok || !token) {
      const msg = String(
        data?.message ?? data?.msg ?? data?.error ?? "",
      ).trim();
      if (
        response.status === 401 ||
        response.status === 422 ||
        /帳號|密碼|password|account|login/i.test(msg)
      )
        throw new Error(msg || "TZ 帳號或密碼不正確");
      throw new Error(msg || `登入驗證失敗 (${response.status || "NETWORK"})`);
    }
    return String(token);
  } catch (error: any) {
    if (error?.name === "AbortError")
      throw new Error("登入驗證逾時，請稍後再試");
    if (error instanceof TypeError)
      throw new Error("瀏覽器無法連到登入驗證服務，請確認網路後再試");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function platformApiBase(platform: "TZ" | "OFA") {
  return platform === "OFA" ? "https://www.ofa1188.net" : "https://www.tz6868.cc";
}

function providerDisplayName(
  provider: string,
  platformKey?: PlatformKey,
) {
  const code = String(provider || "").trim().toUpperCase();
  if (platformKey === "SA") return "SA";
  if (platformKey === "MV") return "美女直播";
  if (code === "DGLI") return "DG";
  if (code === "MTLI") return "MT";
  return code || "平台";
}

/** MT/DG: token. SA: username+token (or token). 美女直播: userid+time+sign (LIVE77) or uid+userid. */
function gameLoginCredentialOk(
  url: URL,
  platformKey?: PlatformKey,
) {
  const q = url.searchParams;
  const token = !!q.get("token");
  const sessionId = !!q.get("sessionId");
  const params = !!q.get("params");
  const username = !!q.get("username");
  const uid = !!q.get("uid");
  const userid = !!q.get("userid");
  const sign = !!q.get("sign");
  const time = !!q.get("time");
  const host = url.hostname.toLowerCase();

  if (platformKey === "MV" || /score777/i.test(host))
    // TZ LIVE77 → /live/home/registerAndLogin?userid=&time=&sign=
    return (userid && sign) || (userid && time) || (uid && userid) || userid || uid;
  if (platformKey === "SA" || /labplatform|sagaming|saplay/i.test(host))
    return (username && token) || token || sessionId || username;
  if (platformKey === "MT" || platformKey === "DG") return token;
  return token || sessionId || params || (uid && userid) || (username && token);
}

function pickGameLoginUrl(
  data: any,
  platformKey?: PlatformKey,
) {
  const rawCandidates: any[] = [
    data?.data?.game_url,
    data?.data?.url,
    data?.raw?.url,
    data?.raw?.game_url,
    typeof data?.raw === "string" ? data.raw : undefined,
  ];
  const cleaned = rawCandidates
    .filter((v) => typeof v === "string" && v.trim())
    .map((v) =>
      String(v)
        .trim()
        .replace(/\\\//g, "/")
        .replace(/^['"]|['"]$/g, ""),
    );
  for (const candidate of cleaned) {
    try {
      const u = new URL(candidate);
      if (u.protocol === "https:" && gameLoginCredentialOk(u, platformKey))
        return u.toString();
    } catch {}
  }
  // Relative path + absolute origin from another field.
  const absolute = cleaned.find((v) => {
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  });
  const relative = cleaned.find((v) =>
    /[?&](token|sessionId|params|uid|userid|username)=/i.test(v),
  );
  if (absolute && relative) {
    try {
      const u = new URL(relative, new URL(absolute).origin);
      if (gameLoginCredentialOk(u, platformKey)) return u.toString();
    } catch {}
  }
  return "";
}

async function getGameLoginUrlFromPlatform(
  platform: "TZ" | "OFA",
  token: string,
  provider: string,
  device: "Desktop" | "Mobile" = "Desktop",
  platformKey?: PlatformKey,
) {
  if (Platform.OS !== "web")
    throw new Error("自動取得平台 Token 目前僅支援網站版");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const base = platformApiBase(platform);
  const code = String(provider || "").trim();
  if (!code) throw new Error("缺少遊戲代碼");
  const request = async (withAuth: boolean) => {
    const headers: any = {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
    };
    if (withAuth && token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${base}/api/v2/game/${encodeURIComponent(code)}/login`, {
      method: "POST",
      mode: "cors",
      headers,
      body: JSON.stringify({
        game_return_url: base,
        game_kind: "",
        game_type: "",
        device,
        game_device: device,
      }),
      signal: controller.signal,
    });
  };
  try {
    // Keep the original probe-then-auth order so existing TZ/OFA CORS behavior
    // stays the same. Only retry with Bearer when the first response is 401/403.
    let response = await request(false);
    let data: any = null;
    try {
      data = await response.json();
    } catch {}
    const firstCode = Number(data?.code);
    if (
      token &&
      (response.status === 401 ||
        response.status === 403 ||
        firstCode === 401 ||
        firstCode === 403)
    ) {
      response = await request(true);
      data = null;
      try {
        data = await response.json();
      } catch {}
    }
    const providerName = providerDisplayName(code, platformKey);
    if (!response.ok || Number(data?.code) !== 200)
      throw new Error(
        String(data?.message ?? data?.msg ?? `取得 ${providerName} 授權失敗`),
      );

    const gameUrl = pickGameLoginUrl(data, platformKey);
    if (!gameUrl) throw new Error(`找不到 ${providerName} 有效授權網址`);
    return gameUrl;
  } finally {
    clearTimeout(timeout);
  }
}

async function getMtLoginUrlFromPlatform(
  platform: "TZ" | "OFA",
  token: string,
) {
  return getGameLoginUrlFromPlatform(platform, token, "MTLI", "Desktop", "MT");
}
async function getDgLoginUrlFromPlatform(
  platform: "TZ" | "OFA",
  token: string,
) {
  return getGameLoginUrlFromPlatform(platform, token, "DGLI", "Desktop", "DG");
}

async function platformWalletRequest(
  platform: "TZ" | "OFA",
  token: string,
  method: "GET" | "POST",
  body?: any,
  timeoutMs = 8000,
) {
  if (Platform.OS !== "web") throw new Error("轉點目前僅支援網站版");
  const base = platformApiBase(platform);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const request = async (withAuth: boolean) => {
    const headers: any = { Accept: "application/json, text/plain, */*" };
    if (method === "POST") headers["Content-Type"] = "application/json";
    if (withAuth && token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${base}/api/v1/user/wallet`, {
      method,
      mode: "cors",
      credentials: "omit",
      headers,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      signal: controller.signal,
    });
  };
  try {
    let response = token ? await request(true) : await request(false);
    let text = await response.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    return { response, data };
  } catch (error: any) {
    if (error?.name === "AbortError")
      throw new Error("轉點服務逾時，請稍後再試");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPlatformGamesList(
  platform: "TZ" | "OFA",
  token?: string,
) {
  if (Platform.OS !== "web") return [];
  const base = platformApiBase(platform);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const headers: any = { Accept: "application/json, text/plain, */*" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${base}/api/v1/games`, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      headers,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    return Array.isArray(data?.data) ? data.data : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function transferAllToMainWallet(
  platform: "TZ" | "OFA",
  token: string,
  opts?: { skipEmptyCheck?: boolean; timeoutMs?: number },
) {
  const result = await platformWalletRequest(
    platform,
    token,
    "POST",
    {
      s: "all",
      t: 0,
    },
    opts?.timeoutMs ?? 8000,
  );
  const ok = result.response.ok && Number(result.data?.code) === 200;
  if (ok)
    return {
      ok: true,
      empty: false,
      message: String(result.data?.message ?? "轉回成功"),
    };

  if (opts?.skipEmptyCheck)
    return { ok: false, empty: true, message: String(result.data?.message ?? "轉回失敗") };

  // TZ 在沒有可轉回點數時可能只回 422/9999「失敗」。
  // 再讀一次遊戲錢包；如果所有遊戲錢包都是 0，就顯示成「目前無可轉回點數」。
  try {
    const wallet = await platformWalletRequest(platform, token, "GET", undefined, 6000);
    const rows = Array.isArray(wallet.data?.data) ? wallet.data.data : [];
    const transferable = rows
      .filter((x: any) => String(x?.game_code || "").trim())
      .reduce((sum: number, x: any) => sum + (Number(x?.game_balance) || 0), 0);
    if (transferable <= 0.000001)
      return { ok: false, empty: true, message: "目前無可轉回點數" };
  } catch {}
  const message = String(
    result.data?.message ??
      result.data?.msg ??
      result.data?.error ??
      `轉回失敗 (${result.response.status})`,
  ).replace(/^"|"$/g, "");
  return { ok: false, empty: false, message: message || "轉回失敗" };
}

async function readGameWalletLeftover(
  platform: "TZ" | "OFA",
  token: string,
) {
  const wallet = await platformWalletRequest(platform, token, "GET", undefined, 6000);
  const rows = Array.isArray(wallet.data?.data) ? wallet.data.data : [];
  return rows
    .filter((x: any) => String(x?.game_code || "").trim())
    .reduce((sum: number, x: any) => sum + (Number(x?.game_balance) || 0), 0);
}

/** One POST {s:all,t:0} — used before enter so users are not stuck on multi-step sweep. */
async function quickSweepToMain(platform: "TZ" | "OFA", token: string) {
  try {
    return await transferAllToMainWallet(platform, token, {
      skipEmptyCheck: true,
      timeoutMs: 6000,
    });
  } catch (error: any) {
    return {
      ok: false,
      empty: true,
      message: String(error?.message || "轉點逾時"),
    };
  }
}

/** POST {s:"all", t:0}. If TZ still shows game balances, retry leftovers in parallel. */
async function pullAllGameWalletsToMain(
  platform: "TZ" | "OFA",
  token: string,
) {
  const first = await transferAllToMainWallet(platform, token, {
    skipEmptyCheck: true,
    timeoutMs: 8000,
  });
  let leftover = 0;
  let rows: any[] = [];
  try {
    const wallet = await platformWalletRequest(platform, token, "GET", undefined, 6000);
    rows = Array.isArray(wallet.data?.data) ? wallet.data.data : [];
    leftover = rows
      .filter((x: any) => String(x?.game_code || "").trim())
      .reduce((sum: number, x: any) => sum + (Number(x?.game_balance) || 0), 0);
  } catch {}
  if (leftover > 0.000001) {
    await Promise.all(
      rows.map(async (row: any) => {
        const code = String(row?.game_code || "").trim();
        const bal = Number(row?.game_balance) || 0;
        if (!code || bal <= 0.000001) return;
        try {
          await platformWalletRequest(platform, token, "POST", { s: code, t: 0 }, 5000);
        } catch {}
      }),
    );
    await transferAllToMainWallet(platform, token, {
      skipEmptyCheck: true,
      timeoutMs: 6000,
    });
    try {
      leftover = await readGameWalletLeftover(platform, token);
    } catch {
      leftover = 0;
    }
  }
  if (first.ok || leftover <= 0.000001)
    return leftover <= 0.000001 && !first.ok
      ? { ok: false, empty: true, message: first.message }
      : { ok: true, empty: false, message: first.message || "轉回成功" };
  return { ok: false, empty: false, message: first.message || "轉回失敗" };
}

const GAME_WALLET_CODE: Record<PlatformKey, string> = {
  MT: "MTLI",
  DG: "DGLI",
  // SALI follows MTLI/DGLI live naming; wallet/games list can override.
  SA: "SALI",
  // User-captured TZ code: POST /api/v2/game/LIVE77/login → registerAndLogin URL.
  MV: "LIVE77",
};

const GAME_WALLET_LABEL: Record<PlatformKey, string> = {
  MT: "MT",
  DG: "DG",
  SA: "SA",
  MV: "美女直播",
};

/** Demo / fallback only. Real enter uses TZ `/api/v2/game/{code}/login`. */
const EXTERNAL_PLATFORM_URL: Record<"SA" | "MV", string> = {
  SA: "https://ws2.labplatformplus.com/rm/featured",
  MV: "https://tz02.score777.net/",
};

/** Homepage live rooms for 美女直播 — streamer cards (name / photo / status). */
type MvRoomDto = {
  id: string;
  uid?: string;
  name: string;
  title: string;
  live: boolean;
  avatar: string;
  roomUrl?: string;
  comingSoon?: boolean;
};

const MV_LIVE_ROOM_FALLBACK: MvRoomDto[] = [
  {
    id: "MV-YUNXI",
    name: "沄曦",
    title: "跟著沄曦走 荷包一直有 ~",
    live: false,
    avatar: "/mv-hosts/6a1d3ce1e6aa9.jpg",
  },
  {
    id: "MV-LAOYE",
    name: "老爺",
    title: "老爺人家還沒好，請敬請期待",
    live: false,
    avatar: "",
    comingSoon: true,
  },
  {
    id: "MV-1161",
    uid: "1161",
    name: "雙雙",
    title: "雙雙 GAME TIME 跟著雙雙一起贏大錢~",
    live: false,
    avatar: "/mv-hosts/69fe0d3d9793a.jpg",
  },
  {
    id: "MV-QIANQIAN",
    name: "淺淺",
    title: "淺淺 9/21 GAME TIME",
    live: false,
    avatar: "/mv-hosts/69fe0d210ae8a.jpg",
  },
  {
    id: "MV-MATCH",
    name: "賽事直播",
    title: "9/21 2:45 法甲 馬賽vs巴黎聖爾曼",
    live: false,
    avatar: "/mv-hosts/69fe0caf8fa97.jpg",
  },
];

function mvRoomToTable(room: MvRoomDto): TableData {
  return {
    id: room.id,
    apiId: room.id,
    game: "直播",
    name: room.name,
    players: room.comingSoon
      ? "敬請期待"
      : room.live
        ? "直播中"
        : "休息中",
    shoe: "—",
    round: 0,
    banker: 0,
    player: 0,
    tie: 0,
    results: [],
    trend: room.title,
    live: room.live,
    roomId: room.uid || room.name,
    category: room.comingSoon ? "comingSoon" : "直播",
    dealerPhoto: room.avatar || undefined,
    streamUrl: room.live ? room.roomUrl : undefined,
  };
}

const MV_LIVE_ROOMS: TableData[] = MV_LIVE_ROOM_FALLBACK.map(mvRoomToTable);

const EXTERNAL_GAME_CODE_CANDIDATES: Record<"SA" | "MV", string[]> = {
  SA: ["SALI", "SA", "SA01", "SAGAME", "SAG"],
  // LIVE77 first (user-captured TZ login). Keep older guesses as fallbacks.
  MV: [
    "LIVE77",
    "GIRL",
    "GIRLS",
    "SEXY",
    "MVLI",
    "SALIVE",
    "TZGIRL",
    "LIVE",
    "MZLI",
  ],
};

function platformDisplayName(key: PlatformKey) {
  return GAME_WALLET_LABEL[key] || key;
}

function isDemoPlatformToken(token: string) {
  const t = String(token || "").trim().toLowerCase();
  return !t || t === "demo" || t === "demo-local-token";
}

function openExternalPlatformTab(url: string) {
  if (!url) return false;
  if (Platform.OS === "web") {
    try {
      const win = window.open(url, "_blank", "noopener,noreferrer");
      return !!win;
    } catch {
      return false;
    }
  }
  void Linking.openURL(url).catch(() => undefined);
  return true;
}

function walletRowLooksLikeGame(
  row: any,
  gameCode: string,
  key?: PlatformKey,
) {
  const code = String(row?.game_code ?? "").trim().toUpperCase();
  const name = String(row?.name ?? row?.game_name ?? row?.title ?? "").trim();
  const wanted = String(gameCode).trim().toUpperCase();
  if (code && wanted && code === wanted) return true;
  const hay = `${code} ${name}`;
  if (key === "DG" || wanted === "DGLI")
    return (
      code === "DGLI" ||
      code === "DG" ||
      /dg真人|dgli/i.test(hay) ||
      /^dg$/i.test(name)
    );
  if (key === "MT" || wanted === "MTLI")
    return (
      code === "MTLI" ||
      code === "MT" ||
      /mt真人|mtli/i.test(hay) ||
      /^mt$/i.test(name)
    );
  if (key === "SA" || wanted === "SALI" || wanted === "SA" || wanted === "SA01")
    return (
      code === "SALI" ||
      code === "SA" ||
      code === "SA01" ||
      code === "SAGAME" ||
      code === "SAG" ||
      /sa真人|沙龍|salon|sagaming|labplatform|^sa$/i.test(hay)
    );
  if (key === "MV" || wanted === "LIVE77")
    return (
      code === "LIVE77" ||
      !!EXTERNAL_GAME_CODE_CANDIDATES.MV.includes(code) ||
      /美女|直播|girl|score777|tz.?girl|sexy|live77|^mv$/i.test(hay)
    );
  return false;
}

function uniqueNonEmptyCodes(codes: Array<string | undefined | null>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of codes) {
    const code = String(raw || "").trim();
    if (!code) continue;
    const key = code.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(code);
  }
  return out;
}

async function resolveExternalGameCodes(
  platform: "TZ" | "OFA",
  token: string,
  key: "SA" | "MV",
) {
  const preferred = GAME_WALLET_CODE[key];
  const seeds = uniqueNonEmptyCodes([
    preferred,
    ...EXTERNAL_GAME_CODE_CANDIDATES[key],
  ]);
  const found: string[] = [];
  try {
    const wallet = await platformWalletRequest(platform, token, "GET");
    const rows = Array.isArray(wallet.data?.data) ? wallet.data.data : [];
    for (const row of rows) {
      if (!walletRowLooksLikeGame(row, preferred || seeds[0] || "", key)) continue;
      const code = String(row?.game_code || "").trim();
      if (code) found.push(code);
    }
  } catch {}
  try {
    const games = await fetchPlatformGamesList(platform, token);
    for (const row of games) {
      if (!walletRowLooksLikeGame(row, preferred || seeds[0] || "", key)) continue;
      const code = String(row?.game_code || "").trim();
      if (code) found.push(code);
    }
  } catch {}
  return uniqueNonEmptyCodes([...found, ...seeds]);
}

async function getExternalLoginUrlFromPlatform(
  platform: "TZ" | "OFA",
  token: string,
  key: "SA" | "MV",
) {
  const codes = await resolveExternalGameCodes(platform, token, key);
  if (!codes.length)
    throw new Error(`找不到 ${platformDisplayName(key)} 遊戲代碼`);
  let lastError: any = null;
  for (const code of codes) {
    try {
      return await getGameLoginUrlFromPlatform(
        platform,
        token,
        code,
        "Desktop",
        key,
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw (
    lastError ||
    new Error(`取得 ${platformDisplayName(key)} 授權失敗`)
  );
}

async function resolveWalletGameCode(
  platform: "TZ" | "OFA",
  token: string,
  gameCode: string,
  key?: PlatformKey,
) {
  const wallet = await platformWalletRequest(platform, token, "GET");
  const rows = Array.isArray(wallet.data?.data) ? wallet.data.data : [];
  const hit = rows.find((row: any) => walletRowLooksLikeGame(row, gameCode, key));
  const resolved = String(hit?.game_code || "").trim();
  return resolved || gameCode;
}

async function transferIntoGameWallet(
  platform: "TZ" | "OFA",
  token: string,
  gameCode: string,
  key?: PlatformKey,
) {
  const postIn = async (code: string) => {
    const result = await platformWalletRequest(platform, token, "POST", {
      s: code,
      t: 1,
    });
    const ok = result.response.ok && Number(result.data?.code) === 200;
    const message = String(
      result.data?.message ??
        result.data?.msg ??
        result.data?.error ??
        `轉入失敗 (${result.response.status})`,
    ).replace(/^"|"$/g, "");
    return { ok, message: message || (ok ? "轉入成功" : "轉入失敗"), result };
  };
  const first = await postIn(gameCode);
  if (first.ok)
    return { ok: true, empty: false, message: first.message };
  let realCode = gameCode;
  try {
    realCode = await resolveWalletGameCode(platform, token, gameCode, key);
  } catch {}
  if (realCode && realCode !== gameCode) {
    const retry = await postIn(realCode);
    if (retry.ok)
      return { ok: true, empty: false, message: retry.message };
    const empty = /不足|無可|沒有|0/.test(retry.message);
    return { ok: false, empty, message: retry.message || "轉入失敗" };
  }
  const empty = /不足|無可|沒有|0/.test(first.message);
  return { ok: false, empty, message: first.message || "轉入失敗" };
}

function getTzLoginDeviceId() {
  if (typeof window === "undefined") return "web";
  const key = "mt_tz_device_id";
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
    window.localStorage.setItem(key, id);
  }
  return id;
}

function AccessScreen({
  onAuthenticated,
  notice,
}: {
  onAuthenticated: (
    sessionId: string,
    platformToken: string,
    platform: "TZ" | "OFA",
  ) => void;
  notice?: string;
}) {
  const { width } = useWindowDimensions();
  const desktop = width >= 1000;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const playCount = useRef(0);
  const webVideoRef = useRef<any>(null);
  const player = useVideoPlayer({ uri: "/poker.mp4" }, (p) => {
    if (Platform.OS !== "web") {
      p.loop = false;
      p.muted = true;
      p.play();
    }
  });
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = player.addListener("playToEnd", () => {
      playCount.current += 1;
      if (playCount.current < 2) {
        player.currentTime = 0;
        player.play();
      } else player.pause();
    });
    return () => sub.remove();
  }, [player]);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    playCount.current = 0;
    const video = webVideoRef.current;
    if (!video) return;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = false;
    const start = () => {
      try {
        const promise = video.play?.();
        if (promise?.catch) promise.catch(() => undefined);
      } catch {}
    };
    start();
    const t1 = setTimeout(start, 120);
    const t2 = setTimeout(start, 600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
  const login = trpc.trackerAccess.login.useMutation();
  const resolvePlatform = trpc.trackerAccess.resolvePlatform.useMutation();
  const submit = async () => {
    if (!username.trim() || !password) {
      setError("請輸入 TZ 帳號與密碼");
      return;
    }
    setError("");
    try {
      const deviceId = getTzLoginDeviceId();
      // 白名單只判斷「登入帳號」是否存在，不儲存平台與密碼。
      const resolved: any = await resolvePlatform.mutateAsync({
        username: username.trim(),
      });
      if (!resolved?.found) {
        const messages: any = {
          not_whitelisted: "此登入帳號尚未取得使用權限",
          database_unavailable: "授權服務暫時無法使用",
        };
        setError(messages[resolved?.reason] || "登入驗證失敗");
        return;
      }

      // 平台由實際帳密登入結果判斷，不再寫進白名單。
      // 先試 TZ；若不是 TZ 帳號，再自動試 OFA。
      let platform: "TZ" | "OFA" = "TZ";
      let platformToken = "";
      let tzError: any = null;
      try {
        platformToken = await loginToPlatformFromBrowser(
          "TZ",
          username.trim(),
          password,
          deviceId,
        );
      } catch (error: any) {
        tzError = error;
        try {
          platformToken = await loginToPlatformFromBrowser(
            "OFA",
            username.trim(),
            password,
            deviceId,
          );
          platform = "OFA";
        } catch {
          throw tzError;
        }
      }
      const access = await login.mutateAsync({
        username: username.trim(),
        tzToken: platformToken,
        deviceId,
        platform,
      });
      if (!access.success) {
        const reason = (access as any).reason;
        const messages: any = {
          not_whitelisted: "此登入帳號尚未取得使用權限",
          database_unavailable: "授權服務暫時無法使用",
        };
        setError(messages[reason] || "登入驗證失敗");
        return;
      }
      // 登入 MT Assistant 只建立 TZ/OFA 授權工作階段。
      // 不在登入時呼叫 MTLI/login 或 DGLI/login，避免平台的自動轉點被提前觸發。
      setError("");
      onAuthenticated(access.sessionId, platformToken, platform);
    } catch (error: any) {
      setError(error?.message || "登入工作階段建立失敗，請重試");
    }
  };
  return (
    <ScreenContainer
      edges={["top", "left", "right", "bottom"]}
      containerClassName="bg-[#020A12]"
      className="bg-[#020A12]"
    >
      <View style={s.loginScreen}>
        {Platform.OS === "web" ? (
          createElement("video" as any, {
            ref: (node: any) => {
              webVideoRef.current = node;
            },
            src: "/poker.mp4",
            autoPlay: true,
            muted: true,
            defaultMuted: true,
            playsInline: true,
            preload: "auto",
            controls: false,
            disablePictureInPicture: true,
            style: {
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              pointerEvents: "none",
            },
            onLoadedData: (e: any) => {
              const v = e.currentTarget;
              v.muted = true;
              v.defaultMuted = true;
              void v.play?.().catch?.(() => undefined);
            },
            onCanPlay: (e: any) => {
              const v = e.currentTarget;
              v.muted = true;
              void v.play?.().catch?.(() => undefined);
            },
            onEnded: (e: any) => {
              const v = e.currentTarget;
              playCount.current += 1;
              if (playCount.current < 2) {
                v.currentTime = 0;
                void v.play?.().catch?.(() => undefined);
              } else {
                v.pause();
                try {
                  v.currentTime = Math.max(0, (v.duration || 0) - 0.05);
                } catch {}
              }
            },
          })
        ) : (
          <VideoView
            player={player}
            style={s.loginVideo}
            contentFit="cover"
            nativeControls={false}
          />
        )}
        <View style={s.loginShade} />
        <View style={s.loginPanel}>
          <View style={s.loginTopline}>
            <Text style={s.loginTopText}>MT ASSISTANT · ACCESS</Text>
            <Text style={s.loginSafe}>● 安全驗證</Text>
          </View>
          <View style={[s.loginHero, !desktop ? s.loginHeroMobile : null]}>
            <View style={[s.loginBrand, !desktop ? s.loginBrandMobile : null]}>
              <View style={[s.loginIcon, !desktop ? s.loginIconMobile : null]}>
                <MatrixMark size={desktop ? 42 : 32} />
              </View>
              <View style={s.loginBrandCopy}>
                {desktop ? (
                  <Text style={s.loginKicker}>REAL-TIME CONTROL ROOM</Text>
                ) : null}
                <Text
                  style={[s.loginTitle, !desktop ? s.loginTitleMobile : null]}
                  numberOfLines={1}
                >
                  即時多桌牌路
                </Text>
                <Text
                  style={[s.loginSub, !desktop ? s.loginSubMobile : null]}
                  numberOfLines={1}
                >
                  安全登入後進入牌路控制台
                </Text>
              </View>
            </View>
            <View style={s.loginHeroDivider} />
            <View
              style={[s.threadsCard, !desktop ? s.threadsCardMobile : null]}
            >
              <View style={s.threadsHead}>
                <View style={s.threadsLogo}>
                  <Text style={s.threadsLogoText}>@</Text>
                </View>
                <Text style={s.threadsLabel}>THREADS</Text>
              </View>
              <Text style={s.threadsName}>MT工程師</Text>
              <Text style={s.threadsAccount}>@uss0857</Text>
              <Pressable
                style={({ pressed }: any) => [
                  s.threadsFollow,
                  pressed && s.threadsFollowPressed,
                ]}
                onPress={openThreads}
              >
                <MaterialIcons name="add" size={16} color="#EAF8FF" />
                <Text style={s.threadsFollowText}>FOLLOW</Text>
              </Pressable>
            </View>
          </View>
          <View style={s.loginDivider} />
          <View style={s.loginHintRow}>
            <Text style={s.loginHint} numberOfLines={1}>
              請輸入登入帳號與密碼，驗證成功即可進入。
            </Text>
            <Pressable
              style={({ pressed }: any) => [
                s.registerBtn,
                pressed && s.registerBtnPressed,
              ]}
              onPress={openTzRegister}
            >
              <Text style={s.registerBtnText}>註冊帳號</Text>
            </Pressable>
          </View>
          {notice ? <Text style={s.kickNotice}>⚠ {notice}</Text> : null}
          <Text style={s.loginLabel}>登入帳號</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="輸入登入帳號"
            placeholderTextColor="#63798B"
            autoCapitalize="none"
            autoCorrect={false}
            style={s.loginInput}
          />
          <Text style={s.loginLabel}>登入密碼</Text>
          <View style={s.passwordWrap}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="輸入密碼"
              placeholderTextColor="#63798B"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              style={s.passwordInput}
              onSubmitEditing={submit}
            />
            <Pressable
              style={s.eyeBtn}
              onPress={() => setShowPassword((v) => !v)}
            >
              <MaterialIcons
                name={showPassword ? "visibility-off" : "visibility"}
                size={19}
                color="#6F8CA1"
              />
            </Pressable>
          </View>
          <Pressable style={s.loginBtn} onPress={submit}>
            <MaterialIcons name="verified-user" size={18} color="#fff" />
            <Text style={s.loginBtnText}>
              {login.isPending ? "驗證中" : "安全登入"}
            </Text>
          </Pressable>
          {error ? <Text style={s.error}>{error}</Text> : null}
          <View style={s.loginFooterRow}>
            <View style={s.loginFooterLeft}>
              <MaterialIcons name="lock" size={11} color="#8EA4B4" />
              <Text style={s.loginFoot}>密碼只會用於本次登入驗證</Text>
            </View>
            <Text style={s.loginFooterDivider}>|</Text>
            <Pressable onPress={openLineContact}>
              <Text style={s.loginHelp}>需要協助？LINE 聯絡</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </ScreenContainer>
  );
}

function applyDealerRealtime(current: TableData[], payload: any): TableData[] {
  const body = payload?.body ?? payload?.msg ?? payload?.data ?? payload ?? {};
  const tableId = String(
    body?.table_id ?? body?.id ?? body?.room_id ?? "",
  ).toUpperCase();
  if (!current.some((table) => (table.apiId ?? table.id) === tableId))
    return current;

  const dealer = body?.dealer ?? body?.dealer_info ?? body?.dealerInfo ?? {};
  const dealerName =
    dealer?.nick_name ??
    dealer?.nickname ??
    dealer?.name ??
    dealer?.username ??
    body?.dealer_name ??
    body?.dealerName;
  const dealerPhoto =
    body?.dealer_image ??
    body?.dealer_image_url ??
    body?.dealerPhoto ??
    dealer?.avatar_url ??
    dealer?.image ??
    dealer?.avatar;

  if (!dealerName && !dealerPhoto) return current;

  return current.map((table) => {
    if ((table.apiId ?? `BAG${table.id}`) !== tableId) return table;
    return {
      ...table,
      name: dealerName ? String(dealerName) : table.name,
      dealerPhoto: dealerPhoto ? String(dealerPhoto) : table.dealerPhoto,
      lastUpdated: Date.now(),
    };
  });
}

function eventName(payload: any) {
  return typeof payload?.action === "string"
    ? payload.action
    : (payload?.action?.name ??
        payload?.action?.path ??
        payload?.path ??
        payload?.name ??
        "");
}
function eventTables(payload: any): any[] | null {
  const c = [
    payload?.msg?.tables?.tables,
    payload?.msg?.tables,
    payload?.data?.tables?.tables,
    payload?.data?.tables,
    payload?.tables?.tables,
    payload?.tables,
  ];
  return c.find(Array.isArray) ?? null;
}
function reconcileCurrentMtTables(
  current: TableData[],
  sources: any[],
  retainedIds: readonly string[] = [],
): TableData[] {
  const seen = new Set<string>();
  const active = sources.filter(isMtBaccaratTable).filter((source) => {
    const id = getApiTableId(source);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const activeById = new Map(
    active.map((source) => [getApiTableId(source), source]),
  );
  const keep = new Set([...activeById.keys(), ...retainedIds]);
  const orderedIds = [
    ...current
      .map((table) => String(table.apiId ?? table.id).toUpperCase())
      .filter((id) => keep.has(id)),
    ...active
      .map(getApiTableId)
      .filter(
        (id) =>
          !current.some(
            (table) => String(table.apiId ?? table.id).toUpperCase() === id,
          ),
      ),
  ];
  const seeded = orderedIds.map((apiId) => {
    const source = activeById.get(apiId);
    const existing = current.find(
      (table) => (table.apiId ?? table.id) === apiId,
    );
    if (existing) return existing;
    return {
      id: String(source?.table_name ?? apiId),
      apiId,
      game: "百家樂",
      name: "—",
      players: "—",
      roomId: String(source?.room_id ?? "—"),
      tableBadge: String(source?.orderState ?? "—"),
      shoe: "—",
      round: 0,
      banker: 0,
      player: 0,
      tie: 0,
      results: [],
      trend: "",
      live: false,
    } as TableData;
  });
  return applyTablesSameShoe(seeded, active);
}
function extractMtUrlToken(value: string) {
  try {
    return new URL(value.trim()).searchParams.get("token")?.trim() ?? "";
  } catch {
    return value.trim().replace(/^token=/i, "");
  }
}
function readonlyConnectionUrl(value: string) {
  if (!value) return "自動取得中";
  try {
    const u = new URL(value);
    const queryKeys = [...u.searchParams.keys()];
    const maskedQuery = queryKeys.length
      ? `?${queryKeys.map((k) => `${encodeURIComponent(k)}=********`).join("&")}`
      : "";
    const maskedPath = u.pathname && u.pathname !== "/" ? "/********" : "/";
    return `${u.protocol}//********${maskedPath}${maskedQuery}`;
  } catch {
    return "********";
  }
}
async function stopDgRelayServer(sessionId: string) {
  if (!sessionId) return;
  try {
    await fetch("/api/dg/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
      keepalive: true,
    });
  } catch {}
}
async function stopSaRelayServer(sessionId: string) {
  if (!sessionId) return;
  try {
    await fetch("/api/sa/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
      keepalive: true,
    });
  } catch {}
}
/** Stop background SA WS before iframe login (ERR26). Works for proxy + direct. */
async function enterSaBridgeServer(sessionId: string, gameUrl: string) {
  if (!sessionId) return;
  try {
    await fetch("/api/sa/bridge/enter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, gameUrl }),
    });
  } catch {}
}
async function leaveSaBridgeServer(
  sessionId: string,
  opts?: { restoreRelay?: boolean },
) {
  if (!sessionId) return;
  try {
    await fetch("/api/sa/bridge/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        restoreRelay: opts?.restoreRelay !== false,
      }),
    });
  } catch {}
}
function resultKeyFromPayload(payload: any) {
  const b = payload?.body ?? payload?.msg ?? payload?.data ?? {};
  // SA GameResult hand serial (gameId) is the stable settle key when present.
  if (b?.game_sn != null && String(b.game_sn)) return `gs:${String(b.game_sn)}`;
  if (b?.result_key != null && String(b.result_key)) return String(b.result_key);
  return `${String(b?.shoe ?? "")}|${String(b?.round ?? "")}`;
}

function extractTableStreamUrl(source: any): string {
  const found: string[] = [];
  const walk = (value: any) => {
    if (typeof value === "string") {
      if (/^https?:\/\/.+\.flv(?:[?#].*)?$/i.test(value.trim()))
        found.push(value.trim());
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(
    source?.video ??
      source?.videos ??
      source?.stream ??
      source?.streams ??
      source?.live_video ??
      source?.liveVideo,
  );
  return found.find((x) => x.includes("pull.bighit888.com")) ?? found[0] ?? "";
}

/**
 * Keep exactly one shoe per table.
 * MT tables/tablesvg snapshots are the authoritative road for the current shoe.
 * show_win is only a fast incremental update while waiting for the next snapshot.
 * A shoe-id change OR an explicit round rollback starts a fresh road.
 * This keeps bead/big/derived roads and Banker/Player/Tie counts scoped to one shoe.
 */
function applyTablesSameShoe(
  current: TableData[],
  sources: any[],
): TableData[] {
  const next = applyLiveTables(current, sources) as TableData[];
  return next.map((table) => {
    const prev = current.find(
      (x) => (x.apiId ?? `BAG${x.id}`) === (table.apiId ?? `BAG${table.id}`),
    );
    if (!prev) return table;

    const source = sources.find((item) => {
      const sourceId = getApiTableId(item);
      const tableId = table.apiId ?? `BAG${table.id}`;
      return (
        sourceId === tableId || String(item?.table_name ?? "") === table.id
      );
    });
    const streamUrl = extractTableStreamUrl(source);
    const trend = source?.trend ?? {};
    const explicitShoe =
      trend?.current_shoe ??
      trend?.currentShoe ??
      source?.current_shoe ??
      source?.currentShoe ??
      source?.shoe ??
      source?.shoe_id ??
      source?.shoeId;
    const explicitRound =
      trend?.current_round ??
      trend?.currentRound ??
      source?.current_round ??
      source?.currentRound ??
      source?.round ??
      source?.round_no ??
      source?.roundNo;
    const parsedRound = Number(explicitRound);
    const tableWithStream = {
      ...table,
      ...(streamUrl ? { streamUrl } : {}),
      ...(explicitShoe !== undefined &&
      explicitShoe !== null &&
      String(explicitShoe) !== ""
        ? { shoe: String(explicitShoe) }
        : {}),
      ...(Number.isFinite(parsedRound) && parsedRound >= 0
        ? { round: parsedRound }
        : {}),
    };

    const prevShoe = String(prev.shoe ?? "");
    const nextShoe = String(tableWithStream.shoe ?? "");
    const prevRound = Number(prev.round) || 0;
    const nextRound = Number.isFinite(parsedRound)
      ? parsedRound
      : Number(tableWithStream.round) || 0;
    const shoeChanged = !!(
      prevShoe &&
      prevShoe !== "—" &&
      nextShoe &&
      nextShoe !== "—" &&
      prevShoe !== nextShoe
    );
    const roundRolledBack =
      prevRound > 0 && nextRound >= 0 && nextRound < prevRound;
    const countCurrentShoe = (t: TableData) => {
      const banker = t.results.filter((r) => r === "莊").length;
      const player = t.results.filter((r) => r === "閒").length;
      const tie = t.results.filter((r) => r === "和").length;
      return { ...t, banker, player, tie };
    };

    // New shoe: NEVER carry the previous shoe's results forward.
    // If the packet already contains a current-shoe snapshot, use it immediately;
    // otherwise clear now and let show_win / the next snapshot build from zero.
    if (shoeChanged || roundRolledBack) {
      const rawNewSnapshot =
        trend?.bead_plate2 ?? trend?.bead_plate ?? source?.bead_plate2;
      const hasNewSnapshot = Array.isArray(rawNewSnapshot)
        ? rawNewSnapshot.length > 0
        : typeof rawNewSnapshot === "string" &&
          rawNewSnapshot.replace(/[^0-9]/g, "").length >= 1;
      if (hasNewSnapshot)
        return countCurrentShoe({
          ...tableWithStream,
          results: [...tableWithStream.results],
        });
      // MT international tables briefly publish a new shoe/round with an empty
      // road before the first real bead arrives. Keep the last painted road for
      // that transition packet so the card never flashes completely blank.
      // The first non-empty authoritative snapshot above switches to the new
      // shoe atomically.
      return countCurrentShoe({
        ...tableWithStream,
        shoe: prev.shoe,
        round: prev.round,
        results: [...prev.results],
      });
    }

    // Same shoe: never let a stale/short snapshot roll the visible road backward.
    // show_win appends immediately; a later full snapshot may extend/correct it,
    // but a shorter same-shoe snapshot must not erase already visible history.
    const rawSnapshot =
      trend?.bead_plate2 ?? trend?.bead_plate ?? source?.bead_plate2;
    const hasSnapshot = Array.isArray(rawSnapshot)
      ? rawSnapshot.length > 0
      : typeof rawSnapshot === "string" &&
        rawSnapshot.replace(/[^0-9]/g, "").length >= 2;

    if (hasSnapshot) {
      // Full/equal snapshot is safe. A shorter same-shoe snapshot is stale: keep
      // the current road while still accepting fresh metadata from the packet.
      if (tableWithStream.results.length >= prev.results.length)
        return countCurrentShoe(tableWithStream);
      return countCurrentShoe({
        ...tableWithStream,
        results: [...prev.results],
      });
    }

    // If this packet has no road snapshot at all, do not erase the live road.
    return countCurrentShoe({ ...tableWithStream, results: [...prev.results] });
  });
}

function resetRoadForNewShoePayload(
  current: TableData[],
  payload: any,
): TableData[] {
  const body = payload?.body ?? payload?.msg ?? payload?.data ?? payload ?? {};
  const tableId = String(body?.table_id ?? body?.tableId ?? "").toUpperCase();
  if (!tableId) return current;
  const incomingRoundRaw = body?.round ?? body?.round_no ?? body?.roundNo;
  const incomingRound = Number(incomingRoundRaw);
  const incomingShoeRaw = body?.shoe ?? body?.shoe_id ?? body?.shoeId;
  const incomingShoe = incomingShoeRaw == null ? "" : String(incomingShoeRaw);
  return current.map((table) => {
    const id = String(table.apiId ?? `BAG${table.id}`).toUpperCase();
    if (id !== tableId) return table;
    const prevRound = Number(table.round) || 0;
    const prevShoe = String(table.shoe ?? "");
    const roundRolledBack =
      Number.isFinite(incomingRound) &&
      prevRound > 0 &&
      incomingRound >= 0 &&
      incomingRound < prevRound;
    const shoeChanged = !!(
      incomingShoe &&
      incomingShoe !== "—" &&
      prevShoe &&
      prevShoe !== "—" &&
      incomingShoe !== prevShoe
    );
    // If round already rolled back and the shoe id arrives late, do not erase the
    // first results of the new shoe a second time.
    const delayedShoeMetadata =
      shoeChanged &&
      !roundRolledBack &&
      Number.isFinite(incomingRound) &&
      prevRound <= 5 &&
      incomingRound >= prevRound;
    if (!roundRolledBack && (!shoeChanged || delayedShoeMetadata)) return table;
    return {
      ...table,
      ...(incomingShoe ? { shoe: incomingShoe } : {}),
      ...(Number.isFinite(incomingRound) ? { round: incomingRound } : {}),
      results: [],
      banker: 0,
      player: 0,
      tie: 0,
    };
  });
}

type V38Side = "莊" | "閒" | "觀望";
type V38PokerState = {
  tableId: string;
  shoe: string;
  round: number;
  result: number[];
  player: string[];
  banker: string[];
  playerPoint: number;
  bankerPoint: number;
  complete: boolean;
  settled: boolean;
  updatedAt: number;
  formulas: { A: V38Side; B: V38Side; MUL: V38Side; ADD: V38Side };
  recommendation: V38Side;
};

function mtCardRank(cardId: number): string | null {
  if (!Number.isFinite(cardId) || cardId <= 0) return null;
  const rank = ((Math.trunc(cardId) - 1) % 13) + 1;
  if (rank === 1) return "A";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  return String(rank);
}
function terminalParityFaceValue(card: string) {
  if (card === "A") return 1;
  if (card === "J") return 11;
  if (card === "Q") return 12;
  if (card === "K") return 13;
  const n = Number(card);
  return Number.isFinite(n) && n >= 2 && n <= 10 ? n : 0;
}
function terminalParityResult(cards: string[]) {
  const values = cards.map(terminalParityFaceValue);
  const total = values.reduce((sum, n) => sum + n, 0);
  const first = Math.floor(total / 10) + (total % 10);
  const finalValue = first >= 10 ? first % 10 : first;
  return {
    values,
    total,
    first,
    finalValue,
    side: (finalValue % 2 === 0 ? "莊" : "閒") as V38Side,
  };
}
function baccaratCardValue(card: string) {
  if (card === "A") return 1;
  const n = Number(card);
  return Number.isFinite(n) && n >= 2 && n <= 9 ? n : 0;
}
function baccaratPoint(cards: string[]) {
  return cards.reduce((sum, c) => sum + baccaratCardValue(c), 0) % 10;
}
function isBaccaratPokerComplete(player: string[], banker: string[]) {
  if (player.length < 2 || banker.length < 2) return false;
  const playerInitial = baccaratPoint(player.slice(0, 2)),
    bankerInitial = baccaratPoint(banker.slice(0, 2));
  if (playerInitial >= 8 || bankerInitial >= 8) return true;
  const playerDraws = playerInitial <= 5;
  if (playerDraws && player.length < 3) return false;
  const bankerDraws = (() => {
    if (!playerDraws) return bankerInitial <= 5;
    const third = baccaratCardValue(player[2]);
    if (bankerInitial <= 2) return true;
    if (bankerInitial === 3) return third !== 8;
    if (bankerInitial === 4) return third >= 2 && third <= 7;
    if (bankerInitial === 5) return third >= 4 && third <= 7;
    if (bankerInitial === 6) return third === 6 || third === 7;
    return false;
  })();
  return !bankerDraws || banker.length >= 3;
}
function v38RawFormulas(banker: string[], player: string[]) {
  const sum = [...banker, ...player].reduce(
    (n, c) => n + baccaratCardValue(c),
    0,
  );
  const pb = baccaratPoint(banker),
    pp = baccaratPoint(player);
  const formulas = {
    A: (sum % 3 === 0 ? "莊" : "閒") as V38Side,
    B: (sum % 2 === 0 ? "莊" : "閒") as V38Side,
    MUL: ((pb * pp) % 2 === 0 ? "莊" : "閒") as V38Side,
    ADD: ((pb + pp) % 2 === 0 ? "莊" : "閒") as V38Side,
  };
  const votes = Object.values(formulas);
  const b = votes.filter((x) => x === "莊").length,
    p = votes.filter((x) => x === "閒").length;
  return {
    formulas,
    recommendation: (b === p ? "觀望" : b > p ? "莊" : "閒") as V38Side,
  };
}
function v38PacketRoots(payload: any): any[] {
  const roots: any[] = [],
    queue = [payload],
    seen = new Set<any>();
  while (queue.length && roots.length < 24) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    roots.push(value);
    for (const key of [
      "body",
      "msg",
      "data",
      "span",
      "payload",
      "game",
      "poker",
    ]) {
      const child = value?.[key];
      if (child && typeof child === "object") queue.push(child);
    }
  }
  return roots;
}
function normalizeV38Result(raw: any): number[] | null {
  if (Array.isArray(raw)) return raw.map((x: any) => Number(x));
  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) return null;
    try {
      return normalizeV38Result(JSON.parse(value));
    } catch {}
    const values = value
      .split(/[^0-9.-]+/)
      .filter(Boolean)
      .map(Number);
    return values.length ? values : null;
  }
  if (raw && typeof raw === "object")
    for (const key of ["result", "cards", "card", "values", "poker"]) {
      const value = normalizeV38Result(raw[key]);
      if (value?.length) return value;
    }
  return null;
}
function parseV38ShowPoker(payload: any): V38PokerState | null {
  const roots = v38PacketRoots(payload);
  const cardRoot =
    roots.find((x) => normalizeV38Result(x?.result)?.length) || {};
  const metaRoot =
    roots.find((x) => x?.table_id != null || x?.tableId != null) || cardRoot;
  const result = normalizeV38Result(cardRoot?.result);
  const tableId = String(
    metaRoot?.table_id ??
      metaRoot?.tableId ??
      cardRoot?.table_id ??
      cardRoot?.tableId ??
      "",
  ).toUpperCase();
  if (!tableId || !result || result.length < 4) return null;
  const player = [result[0], result[2], result[4]]
    .map(mtCardRank)
    .filter((x): x is string => !!x);
  const banker = [result[1], result[3], result[5]]
    .map(mtCardRank)
    .filter((x): x is string => !!x);
  const calculatedPlayer = baccaratPoint(player),
    calculatedBanker = baccaratPoint(banker);
  const serverPlayer = Number(result[8]),
    serverBanker = Number(result[9]);
  const fourCards = player.length >= 2 && banker.length >= 2;
  const hasServerPoints =
    result.length >= 10 &&
    Number.isFinite(serverPlayer) &&
    Number.isFinite(serverBanker);
  const pointsAgree =
    fourCards &&
    (!hasServerPoints ||
      (serverPlayer === calculatedPlayer && serverBanker === calculatedBanker));
  const { formulas, recommendation } = v38RawFormulas(banker, player);
  const shoeRoot = roots.find((x) => x?.shoe != null),
    roundRoot = roots.find((x) => x?.round != null);
  return {
    tableId,
    shoe: String(shoeRoot?.shoe ?? "—"),
    round: Number(roundRoot?.round) || 0,
    result,
    player,
    banker,
    playerPoint: calculatedPlayer,
    bankerPoint: calculatedBanker,
    complete: pointsAgree && isBaccaratPokerComplete(player, banker),
    settled: false,
    updatedAt: Date.now(),
    formulas,
    recommendation,
  };
}
function mergeV38PokerState(
  previous: V38PokerState | undefined,
  incoming: V38PokerState,
): V38PokerState {
  if (!previous || previous.tableId !== incoming.tableId) return incoming;
  const previousHasShoe = !!previous.shoe && previous.shoe !== "—",
    incomingHasShoe = !!incoming.shoe && incoming.shoe !== "—";
  const sameShoe =
    !previousHasShoe || !incomingHasShoe || previous.shoe === incoming.shoe;
  const previousHasRound = previous.round > 0,
    incomingHasRound = incoming.round > 0;
  if (
    !sameShoe ||
    (previousHasRound && incomingHasRound && previous.round !== incoming.round)
  )
    return incoming;
  const size = Math.max(previous.result.length, incoming.result.length);
  const result = Array.from({ length: size }, (_, i) => {
    const next = Number(incoming.result[i]);
    return i < 6
      ? Number.isFinite(next) && next > 0
        ? next
        : Number(previous.result[i]) || 0
      : Number.isFinite(next)
        ? next
        : Number(previous.result[i]) || 0;
  });
  const player = [result[0], result[2], result[4]]
    .map(mtCardRank)
    .filter((x): x is string => !!x);
  const banker = [result[1], result[3], result[5]]
    .map(mtCardRank)
    .filter((x): x is string => !!x);
  const playerPoint = baccaratPoint(player),
    bankerPoint = baccaratPoint(banker);
  const { formulas, recommendation } = v38RawFormulas(banker, player);
  // Card reception and settlement are deliberately independent. MT international
  // rooms reveal one baccarat hand through several show_poker packets. show_win
  // can race the last card packet, so a settled flag must never freeze or erase a
  // later non-zero slot belonging to the same table/shoe/round.
  return {
    ...incoming,
    shoe: incomingHasShoe ? incoming.shoe : previous.shoe,
    round: incomingHasRound ? incoming.round : previous.round,
    result,
    player,
    banker,
    playerPoint,
    bankerPoint,
    complete: isBaccaratPokerComplete(player, banker),
    settled: previous.settled,
    formulas,
    recommendation,
  };
}

function tableIdKeys(table: { id?: string; apiId?: string; tableBadge?: string; roomId?: string }) {
  return [table.apiId, table.id, table.tableBadge, table.roomId]
    .map((x) => String(x ?? "").trim())
    .filter((x) => x && x !== "undefined");
}
function tableMatchesAssistId(table: { id?: string; apiId?: string; tableBadge?: string; roomId?: string }, assistId: string) {
  const want = String(assistId ?? "").trim();
  if (!want) return false;
  return tableIdKeys(table).includes(want);
}
function assistRoomTitle(
  table?: {
    apiId?: string;
    id?: string;
    roomId?: string;
    tableBadge?: string;
    name?: string;
  } | null,
  platform?: PlatformKey,
) {
  if (!table) return "";
  const id = String(table.apiId ?? table.id ?? "").trim();
  const room = String(table.roomId ?? "").trim();
  if (platform === "SA") {
    // Prefer official D01/C01 label — never bare numeric hostId in float/選桌.
    const label =
      String(table.tableBadge ?? "").trim() ||
      String(table.name ?? "").trim() ||
      (room ? saTableLabel(room) : "") ||
      String(table.id ?? "").trim();
    if (label && !/^\d+$/.test(label)) return label;
    if (room && /[\u4e00-\u9fff]/.test(room)) return room;
    return label || room || id;
  }
  if (platform === "MV") {
    if (room && /[\u4e00-\u9fff]/.test(room)) return room;
    return room || id;
  }
  if (platform === "DG") {
    if (room && room !== "—" && !/^\d+$/.test(room)) return room;
    return id;
  }
  return id;
}
function vendorRowUnchanged(a?: TableData, b?: TableData) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.apiId === b.apiId &&
    a.round === b.round &&
    a.poker === b.poker &&
    a.countdown === b.countdown &&
    a.name === b.name &&
    a.roomId === b.roomId &&
    a.players === b.players &&
    a.shoe === b.shoe &&
    a.banker === b.banker &&
    a.player === b.player &&
    a.tie === b.tie &&
    a.results.length === b.results.length &&
    a.results[a.results.length - 1] === b.results[b.results.length - 1]
  );
}
function mergeVendorTables(prev: TableData[], next: TableData[]) {
  if (prev === next) return prev;
  if (prev.length === next.length && prev.every((row, i) => vendorRowUnchanged(row, next[i]))) return prev;
  const byId = new Map(prev.map((row) => [row.apiId, row]));
  let changed = prev.length !== next.length;
  const out = next.map((row) => {
    const old = byId.get(row.apiId);
    if (old && vendorRowUnchanged(old, row)) return old;
    changed = true;
    return row;
  });
  return changed ? out : prev;
}

function parsePokerFace(token: string): string | null {
  const value = String(token || "").trim().toUpperCase();
  if (!value) return null;
  if (value === "A" || value === "J" || value === "Q" || value === "K") return value;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 13) return mtCardRank(n);
  if (n === 1) return "A";
  if (n === 11) return "J";
  if (n === 12) return "Q";
  if (n === 13) return "K";
  return String(n);
}

function parseDgV38Poker(table: DgTableData): V38PokerState | null {
  if (!table?.poker) return null;
  try {
    const poker = JSON.parse(table.poker);
    const player = String(poker?.player ?? "")
      .split("-")
      .map(parsePokerFace)
      .filter((x): x is string => !!x)
      .slice(0, 3);
    const banker = String(poker?.banker ?? "")
      .split("-")
      .map(parsePokerFace)
      .filter((x): x is string => !!x)
      .slice(0, 3);
    if (!player.length && !banker.length) return null;
    const playerPoint = baccaratPoint(player),
      bankerPoint = baccaratPoint(banker);
    const result = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      playerPoint,
      bankerPoint,
    ];
    const complete = isBaccaratPokerComplete(player, banker);
    const { formulas, recommendation } = v38RawFormulas(banker, player);
    return {
      tableId: table.apiId,
      shoe: table.shoe,
      round: table.round,
      result,
      player,
      banker,
      playerPoint,
      bankerPoint,
      complete,
      settled: false,
      updatedAt: Date.now(),
      formulas,
      recommendation,
    };
  } catch {
    return null;
  }
}

function isPhoneWebClient(width: number) {
  if (width < 1000) return true;
  if (Platform.OS !== "web") return false;
  try {
    return /Mobi|Android|iPhone|iPod|iPad|webOS/i.test(String(navigator.userAgent || ""));
  } catch {
    return false;
  }
}

export default function HomeScreen() {
  const { width, height } = useWindowDimensions();
  const desktop = width >= 1000;
  const tablet = width >= 700 && width < 1000;
  const orbSize = desktop
    ? Math.max(68, Math.min(90, width * 0.045))
    : tablet
      ? 60
      : Math.max(48, Math.min(56, width * 0.13));
  const orbIconSize = Math.round(orbSize * 0.44);
  const panelDesktopWidth = 560;
  // Mobile keeps a full, roomy desktop-like canvas and scales the WHOLE canvas down.
  // This prevents the three cards/text from being flex-squeezed just to fit the phone.
  // Mobile uses the SAME 560px desktop canvas. Only the outer canvas is scaled.
  // This keeps desktop typography/card proportions instead of shrinking a wider 660px canvas.
  const panelMobileCanvasWidth = panelDesktopWidth;
  const panelMobileTargetWidth = Math.min(width * 0.9, 520);
  const panelBaseWidth = desktop ? panelDesktopWidth : panelMobileCanvasWidth;
  const panelMobileScale = Math.min(
    1,
    panelMobileTargetWidth / panelMobileCanvasWidth,
  );
  const [accessGranted, setAccessGranted] = useState(false);
  const [accessSessionId, setAccessSessionId] = useState("");
  const [accessNotice, setAccessNotice] = useState("");
  const accessSessionCheck = trpc.trackerAccess.checkSession.useQuery(
    { sessionId: accessSessionId },
    {
      enabled: accessGranted && !!accessSessionId,
      refetchInterval: 3000,
      retry: false,
    },
  );
  const logoutAccess = trpc.trackerAccess.logout.useMutation();
  // Local demo: http://127.0.0.1:3847/?demo=1 — skips TZ login for UI checks only.
  // Optional: &platform=MV|SA|DG|MT to land on that tab after demo enter.
  useEffect(() => {
    if (accessGranted || Platform.OS !== "web") return;
    let cancelled = false;
    let demoPlatform: PlatformKey | null = null;
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get("demo") !== "1") return;
      const host = u.hostname;
      if (host !== "localhost" && host !== "127.0.0.1") return;
      const p = String(u.searchParams.get("platform") || "")
        .trim()
        .toUpperCase();
      if (p === "MT" || p === "DG" || p === "SA" || p === "MV")
        demoPlatform = p;
    } catch {
      return;
    }
    void fetch("/api/demo/enter", { method: "POST" })
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (cancelled || !data?.ok || !data?.sessionId) return;
        setAccessSessionId(String(data.sessionId));
        platformTokenRef.current = String(data.platformToken || "demo");
        setLoginPlatform("TZ");
        setLoginSweepDone(true);
        loginSweepDoneRef.current = true;
        if (demoPlatform) {
          setActivePlatform(demoPlatform);
          setActiveCategory("一般");
        }
        setAccessGranted(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [accessGranted]);
  useEffect(() => {
    if (!accessGranted || !accessSessionId) return;
    if (accessSessionCheck.data && !accessSessionCheck.data.valid) {
      const staleSessionId = accessSessionId;
      void stopDgRelayServer(staleSessionId);
      setAccessGranted(false);
      setAccessSessionId("");
      const reason = (accessSessionCheck.data as any)?.reason;
      const notices: any = {
        disabled: "此 TZ 帳號授權已被管理員停用。",
        expired: "此 TZ 帳號授權已到期。",
        not_whitelisted: "此 TZ 帳號已不在授權白名單。",
        database_unavailable: "授權服務暫時無法使用。",
        session_expired: "連線已中斷，請重新登入。",
        session_invalid: "此帳號已於其他裝置登入，本裝置已自動登出。",
      };
      setAccessNotice(notices[reason] || "此帳號授權已失效，請重新登入。");
      try {
        socketRef.current?.close();
      } catch {}
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
      try {
        dgControllerRef.current?.close();
      } catch {}
      dgControllerRef.current = null;
      setDgConnected(false);
      setDgStatus("未連線");
      dgGameUrlRef.current = "";
      dgAuthPromiseRef.current = null;
      dgLastAuthAtRef.current = 0;
      dgSameTokenRetryRef.current = 0;
      setDgGameUrl("");
      setDgTables([]);
      platformTokenRef.current = "";
      setActivePlatform("MT");
      setToken("");
      setMtUrl("");
      lockedMtUrlRef.current = "";
      setHasEnteredGame(false);
      setDgWasOpened(false);
      gameViewUrlRef.current = "";
      setGameViewUrl("");
      setPlatformLaunching(false);
      setWalletTransferOpen(false);
      setWalletTransferBusy(false);
      walletTransferBusyRef.current = false;
      enteringGameWalletRef.current = false;
      loginSweepDoneRef.current = false;
      setLoginSweepDone(false);
      setDgNeedsRecovery(false);
      dgHasConnectedRef.current = false;
      dgForegroundRecoveryAttemptRef.current = 0;
      dgBridgeActiveRef.current = false;
      suppressDgRecoveryRef.current = false;
      roadConnectBusyRef.current = false;
      setFloatingOpen(false);
      setMtOpen(false);
      currentBalanceRef.current = null;
      setCurrentBalance(null);
      setStopLossOpen(false);
      setStopLossAlertOpen(false);
      setStopLossEnabled(false);
      setStopLossTriggered(false);
      setStopLossPrincipal("");
      setStopLossPercent(20);
    }
  }, [
    accessGranted,
    accessSessionId,
    accessSessionCheck.data?.valid,
    (accessSessionCheck.data as any)?.reason,
  ]);

  const [connectionOpen, setConnectionOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [analysisTable, setAnalysisTable] = useState<TableData | null>(null);
  const [radarOpen, setRadarOpen] = useState(false);
  const [radarDetailId, setRadarDetailId] = useState<string | null>(null);
  const [mtOpen, setMtOpen] = useState(false);
  const [gameViewPlatform, setGameViewPlatform] = useState<PlatformKey>("MT");
  const [gameViewUrl, setGameViewUrl] = useState("");
  const gameViewUrlRef = useRef("");
  const [platformLaunching, setPlatformLaunching] = useState(false);
  const [hasEnteredGame, setHasEnteredGame] = useState(false);
  const [dgWasOpened, setDgWasOpened] = useState(false);
  const [walletTransferOpen, setWalletTransferOpen] = useState(false);
  const [walletTransferBusy, setWalletTransferBusy] = useState(false);
  const walletTransferBusyRef = useRef(false);
  const enteringGameWalletRef = useRef(false);
  /** Animated trailing dots for「轉點中...」while login sweep runs. */
  const [transferDots, setTransferDots] = useState(".");
  const [loginSweepDone, setLoginSweepDone] = useState(false);
  const loginSweepDoneRef = useRef(false);
  /** After「轉點中...」finishes, open the platform once without a second click. */
  const pendingAutoEnterRef = useRef(false);
  const openCurrentPlatformRef = useRef<(table?: TableData) => Promise<void>>(
    async () => {},
  );
  const [floatingOpen, setFloatingOpen] = useState(false);
  const [roomDropdownOpen, setRoomDropdownOpen] = useState(false);
  const roomDropdownOpenRef = useRef(false);
  // Freeze the room menu while it is open so live table updates cannot reset its scroll position.
  const [roomMenuTables, setRoomMenuTables] = useState<TableData[]>([]);
  const [assistPage, setAssistPage] = useState(0);
  const [assistTableId, setAssistTableId] = useState("BAG01");
  const [connected, setConnected] = useState(false);
  const [activePlatform, setActivePlatform] = useState<PlatformKey>("MT");
  const [activeCategory, setActiveCategory] = useState("一般");
  const [dgConnected, setDgConnected] = useState(false);
  const [dgStatus, setDgStatus] = useState("未連線");
  const [dgGameUrl, setDgGameUrl] = useState("");
  const dgGameUrlRef = useRef("");
  const dgAuthPromiseRef = useRef<Promise<string> | null>(null);
  const dgLastAuthAtRef = useRef(0);
  const dgSameTokenRetryRef = useRef(0);
  // After a sweep-to-main, block DG recovery from issuing a new DGLI/login
  // that would pull the main-wallet balance back into DG.
  const dgFreshAuthorizationRequiredRef = useRef(false);
  const [dgNeedsRecovery, setDgNeedsRecovery] = useState(false);
  const dgBridgeActiveRef = useRef(false);
  const [dgConnectEpoch, setDgConnectEpoch] = useState(0);
  const dgHasConnectedRef = useRef(false);
  const dgForegroundRecoveryAttemptRef = useRef(0);
  const [dgTables, setDgTables] = useState<TableData[]>([]);
  const [mvLiveRooms, setMvLiveRooms] = useState<TableData[]>(MV_LIVE_ROOMS);
  const [saConnected, setSaConnected] = useState(false);
  const [saStatus, setSaStatus] = useState("未連線");
  const [saGameUrl, setSaGameUrl] = useState("");
  const saGameUrlRef = useRef("");
  const saAuthPromiseRef = useRef<Promise<string> | null>(null);
  const [saTables, setSaTables] = useState<TableData[]>([]);
  const saControllerRef = useRef<{ close: () => void } | null>(null);
  const saHasConnectedRef = useRef(false);
  const [saConnectEpoch, setSaConnectEpoch] = useState(0);
  const saBridgeActiveRef = useRef(false);
  const dgControllerRef = useRef<{ close: () => void } | null>(null);
  const activePlatformRef = useRef<PlatformKey>("MT");
  const mtOpenRef = useRef(false);
  const gameViewPlatformRef = useRef<PlatformKey>("MT");
  useEffect(() => {
    activePlatformRef.current = activePlatform;
  }, [activePlatform]);
  useEffect(() => {
    mtOpenRef.current = mtOpen;
  }, [mtOpen]);
  useEffect(() => {
    gameViewPlatformRef.current = gameViewPlatform;
  }, [gameViewPlatform]);
  const platformTokenRef = useRef("");
  const roadConnectBusyRef = useRef(false);
  const suppressDgRecoveryRef = useRef(false);
  const dgLiveHoldRef = useRef(false);
  const [loginPlatform, setLoginPlatform] = useState<"TZ" | "OFA">("TZ");
  const [token, setToken] = useState("");
  const [mtUrl, setMtUrl] = useState("");
  // Authoritative MT launch URL for this TZ login session. UI fields are display-only.
  const lockedMtUrlRef = useRef("");
  const [wsUrl] = useState("wss://a1.ofalive99.net/game/ws");
  const [socket, setSocket] = useState<WebSocket | null>(null);
  // Single authoritative game socket. State is only for UI; lifecycle uses this ref.
  const socketRef = useRef<WebSocket | null>(null);
  const socketGenerationRef = useRef(0);
  const reconnectingRef = useRef(false);
  const reconnectCooldownUntilRef = useRef(0);
  const awaitingFreshSnapshotRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roomDropdownScrollRef = useRef<ScrollView | null>(null);
  const roomDropdownOffsetRef = useRef(0);
  const [mtTables, setMtTables] = useState<TableData[]>([]);
  const [mtSnapshotReady, setMtSnapshotReady] = useState(false);
  // WebSocket packets are processed immediately into this ref. React painting is
  // committed at most once per animation frame, so the socket frequency is NOT
  // reduced while drag gestures no longer fight dozens of synchronous renders.
  const liveTablesRef = useRef<TableData[]>(initialTables);
  const confirmedMtTableIdsRef = useRef<string[]>([]);
  const tablesFrameRef = useRef<number | null>(null);
  const updateLiveTables = (updater: (current: TableData[]) => TableData[]) => {
    const current = liveTablesRef.current;
    const next = updater(current);
    if (next === current) return;
    liveTablesRef.current = next;
    if (tablesFrameRef.current == null) {
      tablesFrameRef.current = requestAnimationFrame(() => {
        tablesFrameRef.current = null;
        setMtTables(liveTablesRef.current);
      });
    }
  };
  const allActiveTables: TableData[] =
    activePlatform === "DG"
      ? dgTables.length
        ? dgTables
        : dgPlaceholderTables
      : activePlatform === "MV"
        ? mvLiveRooms
        : activePlatform === "SA"
          ? // Only SA 「開桌」— never invent empty D01..N / 百家樂 1..N placeholders.
            saTables.filter(isSaOpenTable)
          : mtSnapshotReady
            ? mtTables
            : initialTables;
  const tables: TableData[] = allActiveTables;
  // Float / 選桌: same open-only SA list.
  const assistPool: TableData[] = tables;
  const availableTableCount =
    activePlatform === "DG"
      ? dgTables.length
      : activePlatform === "MV"
        ? mvLiveRooms.length
        : activePlatform === "SA"
          ? tables.length
          : mtSnapshotReady
            ? mtTables.length
            : 0;
  const activeConnected =
    activePlatform === "DG"
      ? dgConnected || dgTables.length > 0
      : activePlatform === "SA"
        ? saConnected || saTables.length > 0
        : activePlatform === "MV"
          ? false
          : connected;
  const [events, setEvents] = useState<string[]>([]);
  const [toast, setToast] = useState("");
  const [bankroll, setBankroll] = useState(100000);
  const [initialBankroll, setInitialBankroll] = useState(100000);
  const [baseBet, setBaseBet] = useState(1000);
  const [strategy, setStrategy] = useState<StrategyName>("馬丁");
  const [strategyLevel, setStrategyLevel] = useState(0);
  const strategyRef = useRef<StrategyName>("馬丁");
  const baseBetRef = useRef(baseBet);
  useEffect(() => {
    strategyRef.current = strategy;
  }, [strategy]);
  useEffect(() => {
    baseBetRef.current = baseBet;
  }, [baseBet]);
  const [todayPnl, setTodayPnl] = useState<number | null>(null);
  const [dgTodayPnl, setDgTodayPnl] = useState<DgDailyPnl | null>(null);
  // SA 今日輸贏 / 輸贏報表 — isolated bucket (report.pnl.SA / report.history.SA).
  const [saReport, setSaReport] = useState<PlatformReportBucket>(() => {
    const loaded = loadPlatformReport("SA");
    // Ensure SA 今日輸贏 starts at 0 for today (isolated; never MT/DG).
    if (!loaded.pnl) return resetPlatformReport("SA");
    return loaded;
  });
  const saReportRef = useRef(saReport);
  saReportRef.current = saReport;
  const pnlPlatform =
    mtOpen && gameViewPlatform ? gameViewPlatform : activePlatform;
  const activeTodayPnl = selectPlatformTodayPnl(pnlPlatform, {
    mt: todayPnl,
    dg: dgTodayPnl,
    sa: saReport.pnl,
  });
  const todayPnlRef = useRef<number | null>(null);
  // Independent stop-loss reminder. It reads the official MT balance from the existing
  // authenticated game WebSocket and never changes the locked 今日輸贏 logic.
  const [currentBalance, setCurrentBalance] = useState<number | null>(null);
  const currentBalanceRef = useRef<number | null>(null);
  const [stopLossOpen, setStopLossOpen] = useState(false);
  const [stopLossPrincipal, setStopLossPrincipal] = useState("");
  const [stopLossPercent, setStopLossPercent] = useState(20);
  const [stopLossEnabled, setStopLossEnabled] = useState(false);
  const [stopLossTriggered, setStopLossTriggered] = useState(false);
  const [stopLossAlertOpen, setStopLossAlertOpen] = useState(false);
  const [labSequence, setLabSequence] = useState<number[]>([1, 2, 3, 4]);
  const [pendingBet, setPendingBet] = useState<PendingBet>(null);
  const pendingBetRef = useRef<PendingBet>(null);
  useEffect(() => {
    pendingBetRef.current = pendingBet;
  }, [pendingBet]);
  const [records, setRecords] = useState<BetRecord[]>([]);
  const [peakBankroll, setPeakBankroll] = useState(100000);
  const lastBetReportOrderRef = useRef<string>("");
  const betReportBaselineReadyRef = useRef(false);
  // v27: 記住「這次主連線開始追蹤」的本機時間。
  // created_at 是秒級 Unix time；orderTimeOf() 已統一轉成毫秒。
  // 因此即使第一包 /bet/history 晚到，連線後才建立的下注也不能被當成歷史基準吃掉。
  const betTrackingStartedAtRef = useRef(0);
  const processedBetSnRef = useRef<Set<string>>(new Set());
  const pendingSettlementGameSnRef = useRef<Set<string>>(new Set());
  // v26: show_win/end 若帶 game_sn，先鎖定該局；正式 /bet/history 再以相同 gameSn 結算。
  // v25: gameSn 是正式結算追蹤的主鍵；betSn 只作同一 gameSn 下的二次去重。
  // 不依賴 iframe /bet Request，直接由正式 /bet/history 建立並追蹤 gameSn。
  const processedGameSnRef = useRef<Set<string>>(new Set());
  const lastBetReportGameSnRef = useRef<string>("");
  const orbPosition = useRef(new Animated.ValueXY()).current;
  const panelPosition = useRef(new Animated.ValueXY()).current;
  const radarPosition = useRef(new Animated.ValueXY()).current;
  // Independent V38 calculator floating window. Existing assistant state/drag logic is untouched.
  const [v38Open, setV38Open] = useState(false);
  const [v38DetailOpen, setV38DetailOpen] = useState(false);
  const [v38ByTable, setV38ByTable] = useState<Record<string, V38PokerState>>(
    {},
  );
  const v38ByTableRef = useRef<Record<string, V38PokerState>>({});
  const v38Position = useRef(new Animated.ValueXY()).current;
  const v38DraggingRef = useRef(false);
  // Independent Terminal Parity Model. It passively reuses the existing show_poker state.
  const [terminalParityOpen, setTerminalParityOpen] = useState(false);
  const terminalParityPosition = useRef(new Animated.ValueXY()).current;
  const terminalParityDraggingRef = useRef(false);
  const panelSizeRef = useRef({ width: panelBaseWidth, height: 245 });
  const orbDraggingRef = useRef(false);
  const panelDraggingRef = useRef(false);
  const radarDraggingRef = useRef(false);
  const appendEvent = (x: string) =>
    setEvents((e) =>
      [`[${new Date().toLocaleTimeString()}] ${x}`, ...e].slice(0, 40),
    );
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = (x: string, ms = 1800) => {
    setToast(x);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), ms);
  };
  const stopLossPrincipalValue = useMemo(() => {
    const value = Number(
      String(stopLossPrincipal || "")
        .replace(/,/g, "")
        .trim(),
    );
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [stopLossPrincipal]);
  const stopLossThreshold = useMemo(
    () =>
      stopLossPrincipalValue > 0
        ? stopLossPrincipalValue * (1 - stopLossPercent / 100)
        : 0,
    [stopLossPrincipalValue, stopLossPercent],
  );
  useEffect(() => {
    if (
      !stopLossEnabled ||
      stopLossTriggered ||
      currentBalance === null ||
      stopLossThreshold <= 0
    )
      return;
    if (currentBalance <= stopLossThreshold) {
      setStopLossTriggered(true);
      setStopLossAlertOpen(true);
    }
  }, [currentBalance, stopLossEnabled, stopLossThreshold, stopLossTriggered]);
  const openStopLossSettings = () => {
    if (
      !stopLossPrincipalValue &&
      currentBalance !== null &&
      Number.isFinite(currentBalance)
    )
      setStopLossPrincipal(String(currentBalance));
    setStopLossOpen(true);
  };
  const useCurrentBalanceAsPrincipal = () => {
    if (currentBalance === null || !Number.isFinite(currentBalance)) {
      notify("尚未取得 MT 目前餘額");
      return;
    }
    setStopLossPrincipal(String(currentBalance));
  };
  const enableStopLoss = () => {
    if (stopLossPrincipalValue <= 0) {
      notify("請先設定本金");
      return;
    }
    setStopLossTriggered(false);
    setStopLossEnabled(true);
    setStopLossOpen(false);
    notify(`止損提醒已開啟｜${stopLossPercent}%`);
  };
  const resetStopLossForLogout = () => {
    currentBalanceRef.current = null;
    setCurrentBalance(null);
    setStopLossOpen(false);
    setStopLossAlertOpen(false);
    setStopLossEnabled(false);
    setStopLossTriggered(false);
    setStopLossPrincipal("");
    setStopLossPercent(20);
  };
  const nextAmount = Math.max(
    0,
    Math.round(strategyAmount(strategy, baseBet, strategyLevel, labSequence)),
  );
  // Floating assistant always reads the current live table object.
  // roomMenuTables is only a frozen dropdown snapshot and must never drive dealer display.
  const assistTable = useMemo(
    () =>
      assistPool.find((t) => tableMatchesAssistId(t, assistTableId)) ??
      assistPool[0],
    [assistPool, assistTableId],
  );
  const liveV38 = useMemo(() => {
    if (activePlatform !== "MT" && assistTable) {
      return parseDgV38Poker(assistTable as DgTableData) || undefined;
    }
    return (
      v38ByTable[assistTableId] ||
      (assistTable
        ? tableIdKeys(assistTable)
            .map((id) => v38ByTable[id])
            .find(Boolean)
        : undefined)
    );
  }, [activePlatform, assistTable, assistTableId, v38ByTable]);
  const latest = assistTable?.results.at(-1);
  const recommendation = recommendSide(assistTable?.results ?? []);
  const assistDecision = roadDecision(assistTable?.results ?? []);
  const assistConfidence = confidencePercent(
    assistDecision.scoreBanker,
    assistDecision.scorePlayer,
  );
  const assistConfidenceState = confidenceState(assistConfidence);
  const radarSignals = useMemo(
    () =>
      assistPool.map((table) => {
        const results = table.results ?? [];
        const ready = roadSides(results).length >= 3;
        const decision = roadDecision(results);
        const confidence = ready
          ? confidencePercent(decision.scoreBanker, decision.scorePlayer)
          : 0;
        return {
          table,
          id: table.apiId ?? `BAG${table.id}`,
          ready,
          decision,
          confidence,
        };
      }),
    [assistPool],
  );
  const bestRadar = radarSignals
    .filter((x) => x.ready)
    .reduce<(typeof radarSignals)[number] | null>(
      (best, item) =>
        !best || item.confidence > best.confidence ? item : best,
      null,
    );
  const radarDetailTable = radarDetailId
    ? (assistPool.find((t) => tableMatchesAssistId(t, radarDetailId)) ?? null)
    : null;
  const radarDetailDecision = roadDecision(radarDetailTable?.results ?? []);
  const radarDetailConfidence = radarDetailTable
    ? confidencePercent(
        radarDetailDecision.scoreBanker,
        radarDetailDecision.scorePlayer,
      )
    : 0;

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    document.title = "MT Assistant";
    let homeTitle = document.querySelector(
      'meta[name="apple-mobile-web-app-title"]',
    ) as HTMLMetaElement | null;
    if (!homeTitle) {
      homeTitle = document.createElement("meta");
      homeTitle.name = "apple-mobile-web-app-title";
      document.head.appendChild(homeTitle);
    }
    homeTitle.content = "多平台百家輔助";
    const scrollbarStyleId = "mt-hidden-scrollbar";
    if (!document.getElementById(scrollbarStyleId)) {
      const style = document.createElement("style");
      style.id = scrollbarStyleId;
      style.textContent = `
        html,body,#root{
          scrollbar-width:none !important;
          -ms-overflow-style:none !important;
        }
        html::-webkit-scrollbar,
        body::-webkit-scrollbar,
        #root::-webkit-scrollbar{
          width:0 !important;
          height:0 !important;
          display:none !important;
        }
      `;
      document.head.appendChild(style);
      const skinStyleId = "mt-ui-skin-v1";
      if (!document.getElementById(skinStyleId)) {
        const skin = document.createElement("style");
        skin.id = skinStyleId;
        skin.textContent = `
          :root{
            --mt-bg:#070d15;
            --mt-panel:#0b1623;
            --mt-line:rgba(94,142,181,.32);
            --mt-text:#edf6ff;
          }
          html,body,#root{
            background:
              radial-gradient(circle at 50% -15%,rgba(31,91,137,.13),transparent 34%),
              linear-gradient(180deg,#08111c 0%,#070d15 58%,#060b12 100%) !important;
          }
          button,[role="button"]{
            transition:filter .16s ease,box-shadow .16s ease,transform .16s ease;
          }
          button:hover,[role="button"]:hover{
            filter:brightness(1.08);
          }
          img,video{
            image-rendering:auto;
          }
          *{
            -webkit-tap-highlight-color:transparent;
          }
        `;
        document.head.appendChild(skin);
        const scrollbarFixId = "mt-scrollbar-fix-v7";
        if (!document.getElementById(scrollbarFixId)) {
          const sb = document.createElement("style");
          sb.id = scrollbarFixId;
          sb.textContent = `
        html,body,#root,*{
          scrollbar-width:none !important;
          -ms-overflow-style:none !important;
        }
        html::-webkit-scrollbar,
        body::-webkit-scrollbar,
        #root::-webkit-scrollbar,
        *::-webkit-scrollbar{
          width:0 !important;
          height:0 !important;
          display:none !important;
          background:transparent !important;
        }
      `;
          document.head.appendChild(sb);
        }
        const skinV6Id = "mt-ui-skin-v6";
        if (!document.getElementById(skinV6Id)) {
          const v6 = document.createElement("style");
          v6.id = skinV6Id;
          v6.textContent = `
          /* MT COMMAND CENTER v6 — visual treatment only */
          body{
            background:
              radial-gradient(900px 360px at 50% -120px,rgba(40,116,170,.16),transparent 70%),
              radial-gradient(700px 300px at 8% 25%,rgba(25,79,116,.07),transparent 72%),
              linear-gradient(180deg,#07101a 0%,#060c13 100%) !important;
          }
          button,[role="button"]{
            border-color:rgba(117,173,213,.34) !important;
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.06),
              0 1px 3px rgba(0,0,0,.22);
          }
          button:hover,[role="button"]:hover{
            filter:brightness(1.11) saturate(1.03);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.09),
              0 0 0 1px rgba(111,180,229,.10),
              0 3px 10px rgba(0,0,0,.24);
          }
          button:active,[role="button"]:active{
            filter:brightness(.97);
          }
          video{
            filter:saturate(.98) contrast(1.02);
          }
          ::selection{
            background:rgba(45,139,203,.30);
          }
        `;
          document.head.appendChild(v6);
        }
      }
    }
    let link = document.querySelector(
      'link[rel="apple-touch-icon"]',
    ) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.rel = "apple-touch-icon";
      document.head.appendChild(link);
    }
    link.href = "/apple-touch-icon.png";
    let favicon = document.querySelector(
      'link[rel="icon"]',
    ) as HTMLLinkElement | null;
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      document.head.appendChild(favicon);
    }
    favicon.href = "/apple-touch-icon.png";
  }, []);
  // Unmount only: close the one authoritative socket. Do not tie cleanup to React state changes.
  useEffect(
    () => () => {
      socketGenerationRef.current += 1;
      const ws = socketRef.current;
      socketRef.current = null;
      try {
        ws?.close();
      } catch {}
    },
    [],
  );
  useEffect(
    () => () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    },
    [],
  );
  useEffect(
    () => () => {
      if (tablesFrameRef.current != null)
        cancelAnimationFrame(tablesFrameRef.current);
    },
    [],
  );
  useEffect(() => {
    setPeakBankroll((p) => Math.max(p, bankroll));
  }, [bankroll]);
  useEffect(() => {
    roomDropdownOpenRef.current = roomDropdownOpen;
  }, [roomDropdownOpen]);

  const clampOrbPosition = () => {
    const baseLeft = Math.max(0, width - orbSize - 16);
    const baseTop = Math.max(0, height - orbSize - (mtOpen ? 34 : 24));
    const minX = -baseLeft;
    const maxX = Math.max(minX, width - orbSize - baseLeft);
    const minY = -baseTop;
    const maxY = Math.max(minY, height - orbSize - baseTop);
    orbPosition.stopAnimation((v: any) =>
      orbPosition.setValue({
        x: Math.max(minX, Math.min(maxX, Number(v?.x) || 0)),
        y: Math.max(minY, Math.min(maxY, Number(v?.y) || 0)),
      }),
    );
  };
  const clampPanelPosition = () => {
    // Mobile Safari: keep the panel where the finger releases it.
    // Only keep a small grab area visible instead of snapping to the default position.
    const scale = desktop ? 1 : panelMobileScale;
    const visualWidth = Math.max(1, panelSizeRef.current.width * scale);
    const visualHeight = Math.max(1, panelSizeRef.current.height * scale);
    // floatPanelMobile is anchored at left:18/top:170; desktop uses right/bottom.
    // Clamp against the *visual* scaled rectangle, not the unscaled 560px canvas.
    const baseLeft = desktop ? Math.max(8, width - 74 - visualWidth) : 18;
    const baseTop = desktop ? Math.max(8, height - 22 - visualHeight) : 170;
    const keepX = Math.min(96, visualWidth);
    const headerGrab = Math.min(34 * scale, visualHeight);
    const keepY = Math.max(18, headerGrab);
    const minX = 8 - visualWidth + keepX - baseLeft;
    const maxX = width - 8 - keepX - baseLeft;
    // Never allow the header/grab strip to disappear above the viewport.
    const minY = 8 - baseTop;
    const maxY = height - 8 - keepY - baseTop;
    panelPosition.stopAnimation((v: any) =>
      panelPosition.setValue({
        x: Math.max(minX, Math.min(maxX, Number(v?.x) || 0)),
        y: Math.max(minY, Math.min(maxY, Number(v?.y) || 0)),
      }),
    );
  };

  const orbResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) >= 1 || Math.abs(g.dy) >= 1,
        onMoveShouldSetPanResponderCapture: () => false,
        onPanResponderGrant: () => {
          orbDraggingRef.current = false;
          orbPosition.stopAnimation(() => orbPosition.extractOffset());
        },
        onPanResponderMove: (_, g) => {
          if (Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2)
            orbDraggingRef.current = true;
          orbPosition.setValue({ x: g.dx, y: g.dy });
        },
        onPanResponderRelease: (_, g) => {
          orbPosition.flattenOffset();
          clampOrbPosition();
          if (!orbDraggingRef.current && Math.hypot(g.dx, g.dy) < 6)
            setFloatingOpen((v) => !v);
          orbDraggingRef.current = false;
        },
        onPanResponderTerminate: () => {
          orbPosition.flattenOffset();
          clampOrbPosition();
          orbDraggingRef.current = false;
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [orbPosition, width, height, orbSize, mtOpen],
  );
  const panelDrag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, g) =>
          !roomDropdownOpenRef.current &&
          (Math.abs(g.dx) >= 2 || Math.abs(g.dy) >= 2),
        onMoveShouldSetPanResponderCapture: () => false,
        onPanResponderGrant: () => {
          if (roomDropdownOpenRef.current) return;
          panelDraggingRef.current = true;
          panelPosition.stopAnimation(() => panelPosition.extractOffset());
        },
        onPanResponderMove: (_, g) => {
          if (roomDropdownOpenRef.current) return;
          panelPosition.setValue({ x: g.dx, y: g.dy });
        },
        onPanResponderRelease: () => {
          if (!panelDraggingRef.current) return;
          panelPosition.flattenOffset();
          // Clamp using the scaled visual box on both desktop and mobile.
          // This guarantees the header remains reachable after dragging upward/off-screen.
          clampPanelPosition();
          panelDraggingRef.current = false;
        },
        onPanResponderTerminate: () => {
          if (panelDraggingRef.current) {
            panelPosition.flattenOffset();
            clampPanelPosition();
            panelDraggingRef.current = false;
          }
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [panelPosition, width, height, desktop, panelBaseWidth],
  );
  const clampV38Position = () => {
    const boxW = desktop ? 360 : Math.min(340, width - 24),
      boxH = 285;
    const baseLeft = desktop ? Math.max(12, width - boxW - 88) : 12;
    const baseTop = desktop ? 120 : 115;
    const minX = 8 - baseLeft,
      maxX = Math.max(minX, width - 8 - boxW - baseLeft);
    const minY = 8 - baseTop,
      maxY = Math.max(minY, height - 36 - baseTop);
    v38Position.stopAnimation((v: any) =>
      v38Position.setValue({
        x: Math.max(minX, Math.min(maxX, Number(v?.x) || 0)),
        y: Math.max(minY, Math.min(maxY, Number(v?.y) || 0)),
      }),
    );
  };
  const v38Drag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) >= 2 || Math.abs(g.dy) >= 2,
        onPanResponderGrant: () => {
          v38DraggingRef.current = true;
          v38Position.stopAnimation(() => v38Position.extractOffset());
        },
        onPanResponderMove: (_, g) =>
          v38Position.setValue({ x: g.dx, y: g.dy }),
        onPanResponderRelease: () => {
          if (v38DraggingRef.current) {
            v38Position.flattenOffset();
            clampV38Position();
            v38DraggingRef.current = false;
          }
        },
        onPanResponderTerminate: () => {
          if (v38DraggingRef.current) {
            v38Position.flattenOffset();
            clampV38Position();
            v38DraggingRef.current = false;
          }
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [v38Position, width, height, desktop],
  );

  const clampTerminalParityPosition = () => {
    const boxW = desktop ? 300 : Math.min(300, width - 24),
      boxH = 205;
    const baseLeft = desktop ? Math.max(12, width - boxW - 88) : 12;
    const baseTop = desktop ? 120 : 115;
    const minX = 8 - baseLeft,
      maxX = Math.max(minX, width - 8 - boxW - baseLeft);
    const minY = 8 - baseTop,
      maxY = Math.max(minY, height - 36 - baseTop);
    terminalParityPosition.stopAnimation((v: any) =>
      terminalParityPosition.setValue({
        x: Math.max(minX, Math.min(maxX, Number(v?.x) || 0)),
        y: Math.max(minY, Math.min(maxY, Number(v?.y) || 0)),
      }),
    );
  };
  const terminalParityDrag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) >= 2 || Math.abs(g.dy) >= 2,
        onPanResponderGrant: () => {
          terminalParityDraggingRef.current = true;
          terminalParityPosition.stopAnimation(() =>
            terminalParityPosition.extractOffset(),
          );
        },
        onPanResponderMove: (_, g) =>
          terminalParityPosition.setValue({ x: g.dx, y: g.dy }),
        onPanResponderRelease: () => {
          if (terminalParityDraggingRef.current) {
            terminalParityPosition.flattenOffset();
            clampTerminalParityPosition();
            terminalParityDraggingRef.current = false;
          }
        },
        onPanResponderTerminate: () => {
          if (terminalParityDraggingRef.current) {
            terminalParityPosition.flattenOffset();
            clampTerminalParityPosition();
            terminalParityDraggingRef.current = false;
          }
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [terminalParityPosition, width, height, desktop],
  );

  // React Native Web's PanResponder can miss its release event when the mouse
  // leaves the drag header/window before the button is released. In that case
  // the responder keeps consuming mouse movement and the floating panel appears
  // glued to the cursor. Finish every desktop panel drag at the browser level.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const finishDesktopFloatingDrag = () => {
      if (panelDraggingRef.current) {
        panelPosition.flattenOffset();
        clampPanelPosition();
        panelDraggingRef.current = false;
      }
      if (v38DraggingRef.current) {
        v38Position.flattenOffset();
        clampV38Position();
        v38DraggingRef.current = false;
      }
      if (terminalParityDraggingRef.current) {
        terminalParityPosition.flattenOffset();
        clampTerminalParityPosition();
        terminalParityDraggingRef.current = false;
      }
    };
    window.addEventListener("pointerup", finishDesktopFloatingDrag, true);
    window.addEventListener("pointercancel", finishDesktopFloatingDrag, true);
    window.addEventListener("mouseup", finishDesktopFloatingDrag, true);
    window.addEventListener("blur", finishDesktopFloatingDrag, true);
    return () => {
      window.removeEventListener("pointerup", finishDesktopFloatingDrag, true);
      window.removeEventListener(
        "pointercancel",
        finishDesktopFloatingDrag,
        true,
      );
      window.removeEventListener("mouseup", finishDesktopFloatingDrag, true);
      window.removeEventListener("blur", finishDesktopFloatingDrag, true);
    };
  }, [
    panelPosition,
    v38Position,
    terminalParityPosition,
    width,
    height,
    desktop,
    panelMobileScale,
  ]);

  // 圖2 電腦／圖3 手機：首頁嵌 overview；進桌浮層用較保守右上
  const radarLauncherWidth = desktop ? 210 : 188;
  const radarRightGap = desktop ? 14 : 8;
  const radarBaseTop = desktop ? 100 : 100;
  const clampRadarPosition = () => {
    const launcherWidth = radarLauncherWidth;
    const launcherHeight = 32;
    // Anchor from the right edge (same as radarLauncher style) so a wide
    // useWindowDimensions width cannot shove the chip past the viewport.
    const baseLeft = Math.max(8, width - launcherWidth - radarRightGap);
    const baseTop = radarBaseTop;
    const minX = 8 - baseLeft;
    const maxX = Math.max(minX, width - 8 - launcherWidth - baseLeft);
    const minY = 8 - baseTop;
    const maxY = Math.max(minY, height - 8 - launcherHeight - baseTop);
    radarPosition.stopAnimation((v: any) =>
      radarPosition.setValue({
        x: Math.max(minX, Math.min(maxX, Number(v?.x) || 0)),
        y: Math.max(minY, Math.min(maxY, Number(v?.y) || 0)),
      }),
    );
  };
  const radarLayoutKeyRef = useRef(desktop ? "d" : "m");
  useEffect(() => {
    const key = desktop ? "d" : "m";
    if (radarLayoutKeyRef.current === key) return;
    radarLayoutKeyRef.current = key;
    radarPosition.setValue({ x: 0, y: 0 });
  }, [desktop, radarPosition]);
  const radarResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) >= 1 || Math.abs(g.dy) >= 1,
        onMoveShouldSetPanResponderCapture: () => false,
        onPanResponderGrant: () => {
          radarDraggingRef.current = false;
          radarPosition.stopAnimation(() => radarPosition.extractOffset());
        },
        onPanResponderMove: (_, g) => {
          if (Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2)
            radarDraggingRef.current = true;
          radarPosition.setValue({ x: g.dx, y: g.dy });
        },
        onPanResponderRelease: (_, g) => {
          radarPosition.flattenOffset();
          clampRadarPosition();
          if (!radarDraggingRef.current && Math.hypot(g.dx, g.dy) < 6)
            setRadarOpen(true);
          radarDraggingRef.current = false;
        },
        onPanResponderTerminate: () => {
          radarPosition.flattenOffset();
          clampRadarPosition();
          radarDraggingRef.current = false;
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [radarPosition, width, height, desktop, radarBaseTop, radarRightGap, radarLauncherWidth],
  );

  const pageSwipe = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, g) =>
          !roomDropdownOpen &&
          Math.abs(g.dx) >= 6 &&
          Math.abs(g.dx) > Math.abs(g.dy) * 1.12,
        onMoveShouldSetPanResponderCapture: () => false,
        onPanResponderRelease: (_, g) => {
          if (roomDropdownOpen) return;
          if (g.dx <= -24) setAssistPage((p) => Math.min(2, p + 1));
          if (g.dx >= 24) setAssistPage((p) => Math.max(0, p - 1));
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [roomDropdownOpen],
  );

  const settlePending = (actual: Result, payload: any) => {
    setPendingBet((pending) => {
      if (!pending) return pending;
      // SA 輸贏報表 settles only from sa-relay GameResult → SA bucket.
      if (pending.reportPlatform === "SA") return pending;
      const body = payload?.body ?? payload?.msg ?? payload?.data ?? {};
      const tableId = String(body?.table_id ?? "");
      if (tableId && tableId !== pending.tableId) {
        // SA aliases: D01 / SA901 / roomId — accept any key that matches pending.
        const keys = Array.isArray(body?.table_keys)
          ? body.table_keys.map((x: unknown) => String(x ?? "").trim()).filter(Boolean)
          : [];
        if (!keys.includes(pending.tableId)) return pending;
      }
      const key = resultKeyFromPayload(payload);
      if (pending.resultKey && pending.resultKey === key) return pending;
      let pnl = 0;
      let outcome: "win" | "loss" | "push" = "push";
      if (pending.side === "和") {
        if (actual === "和") {
          pnl = pending.amount * 8;
          outcome = "win";
        } else {
          pnl = -pending.amount;
          outcome = "loss";
        }
      } else if (actual === "和") {
        pnl = 0;
        outcome = "push";
      } else if (actual === pending.side) {
        pnl = pending.side === "莊" ? pending.amount * 0.95 : pending.amount;
        outcome = "win";
      } else {
        pnl = -pending.amount;
        outcome = "loss";
      }
      setBankroll((v) => Math.round(v + pnl));
      setRecords((r) =>
        [
          {
            side: pending.side,
            result: actual,
            amount: pending.amount,
            pnl: Math.round(pnl),
            at: Date.now(),
          },
          ...r,
        ].slice(0, 30),
      );
      if (outcome !== "push") {
        setStrategyLevel((level) => {
          if (strategy === "馬丁") return level; // v21: 馬丁只由正式 /bet/history 的最新本注結算推進
          if (strategy === "達朗貝爾")
            return outcome === "loss"
              ? Math.min(level + 1, 20)
              : Math.max(0, level - 1);
          if (strategy === "Fibonacci")
            return outcome === "loss"
              ? Math.min(level + 1, 10)
              : Math.max(0, level - 2);
          if (strategy === "Paroli")
            return outcome === "win" ? (level >= 2 ? 0 : level + 1) : 0;
          if (strategy === "1-3-2-6")
            return outcome === "win" ? (level >= 3 ? 0 : level + 1) : 0;
          if (strategy === "Oscar's Grind")
            return outcome === "win" ? Math.min(level + 1, 20) : level;
          return 0;
        });
        if (strategy === "Labouchere")
          setLabSequence((seq) => {
            const q = seq.length ? seq : [1, 2, 3, 4];
            if (outcome === "win")
              return q.length <= 2 ? [1, 2, 3, 4] : q.slice(1, -1);
            const stake = q.length === 1 ? q[0] : q[0] + q[q.length - 1];
            return [...q, stake];
          });
      }
      appendEvent(
        `統計結算 ${pending.tableId}：押${pending.side} ${pending.amount}，開${actual}，損益 ${Math.round(pnl)}`,
      );
      return null;
    });
  };

  /** SA-only: GameResult → 立刻寫入懸浮「今日輸贏」(report.pnl.SA)。
   * 跟 DG 一樣：結算當下浮窗就要動。之後官方 BetRecord 心跳再覆寫成報表總計。 */
  const settleSaFromGameResult = (ev: SaWinReportResult) => {
    const pending = pendingBetRef.current;
    if (!pending) return;
    if (pending.reportPlatform && pending.reportPlatform !== "SA") return;
    if (
      !saResultMatchesPending(ev, pending.tableId) &&
      !saWinReportTableMatches(ev, pending.tableId)
    ) {
      return;
    }
    const key = `gs:${ev.gameId}`;
    if (pending.resultKey && pending.resultKey === key) return;
    const { pnl, outcome } = computeBaccaratBetPnl(
      pending.side,
      ev.road,
      pending.amount,
    );
    const entry = {
      side: pending.side,
      result: ev.road as Result,
      amount: pending.amount,
      pnl,
      at: Date.now(),
      tableId: pending.tableId,
      resultKey: key,
      gameId: ev.gameId,
    };
    const next = applySaReportSettlement(saReportRef.current, entry);
    saReportRef.current = next;
    // Clear pending first so a duplicate GameResult cannot double-settle.
    pendingBetRef.current = null;
    setPendingBet(null);
    // Immediate float update — same tick as GameResult (DG-like).
    setSaReport(next);
    setBankroll((v) => Math.round(v + pnl));
    if (outcome !== "push") {
      setStrategyLevel((level) => {
        if (strategy === "馬丁") return level;
        if (strategy === "達朗貝爾")
          return outcome === "loss"
            ? Math.min(level + 1, 20)
            : Math.max(0, level - 1);
        if (strategy === "Fibonacci")
          return outcome === "loss"
            ? Math.min(level + 1, 10)
            : Math.max(0, level - 2);
        if (strategy === "Paroli")
          return outcome === "win" ? (level >= 2 ? 0 : level + 1) : 0;
        if (strategy === "1-3-2-6")
          return outcome === "win" ? (level >= 3 ? 0 : level + 1) : 0;
        return level;
      });
    }
    const total = next.pnl?.value ?? 0;
    appendEvent(
      `SA 今日輸贏即時更新｜${pending.tableId} 押${pending.side} 開${ev.road} 損益 ${pnl}｜今日 ${total > 0 ? "+" : ""}${total}`,
    );
    void saWinReportToSettleBody(ev, pending.tableId);
  };
  const settleSaFromGameResultRef = useRef(settleSaFromGameResult);
  settleSaFromGameResultRef.current = settleSaFromGameResult;

  const settlePendingRef = useRef(settlePending);
  settlePendingRef.current = settlePending;

  const readBetReportOrders = (payload: any): any[] => {
    const roots = [
      payload?.body,
      payload?.data,
      payload?.msg,
      payload?.body?.data,
      payload?.data?.data,
      payload?.msg?.data,
      payload?.body?.result,
      payload?.data?.result,
    ];
    for (const root of roots) {
      if (!root) continue;
      if (Array.isArray(root)) return root;
      for (const key of ["orders", "list", "rows", "records", "items"]) {
        if (Array.isArray(root?.[key])) return root[key];
      }
    }
    return [];
  };
  const isBetReportPayload = (payload: any) => {
    const name = eventName(payload);
    if (name.includes("/bet/history")) return true;
    // Official 投注報表今日總計 — even if action name is stripped/aliased.
    const totalW =
      payload?.msg?.total?.all?.w ??
      payload?.data?.total?.all?.w ??
      payload?.body?.total?.all?.w ??
      payload?.msg?.data?.total?.all?.w ??
      payload?.data?.msg?.total?.all?.w ??
      payload?.body?.msg?.total?.all?.w;
    if (totalW != null && String(totalW).trim() !== "") return true;
    const orders = readBetReportOrders(payload);
    if (!orders.length) return false;
    return orders.some(
      (o: any) =>
        o &&
        (o.betSn != null ||
          o.bet_sn != null ||
          o.bet_total != null ||
          o.win_total != null ||
          Array.isArray(o.slips)),
    );
  };
  const orderTimeOf = (o: any) => {
    const raw = o?.created_at ?? o?.settled_at ?? o?.updated_at ?? o?.time ?? 0;
    if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n > 1e12 ? n : n * 1000;
    const d = Date.parse(String(raw ?? ""));
    return Number.isFinite(d) ? d : 0;
  };
  const orderIdOf = (o: any) =>
    String(
      o?.betSn ??
        o?.bet_sn ??
        o?.no ??
        o?.order_no ??
        o?.orderNumber ??
        o?.id ??
        "",
    );
  const mainBetSlipsOf = (o: any) =>
    Array.isArray(o?.slips)
      ? o.slips.filter((x: any) => {
          // v17: identify the Baccarat main bet by the report's actual label.
          // Exact equality is intentional: 莊對子 / 閒對子 / 龍寶 / 和 etc. must never affect Martingale.
          const name = String(x?.content_name ?? x?.contentName ?? "").trim();
          return name === "莊" || name === "閒";
        })
      : [];
  const orderPnlOf = (o: any) => {
    const main = mainBetSlipsOf(o);
    if (main.length) {
      let bet = 0,
        refund = 0;
      for (const x of main) {
        const b = Number(String(x?.bet ?? 0).replace(/,/g, ""));
        const r = Number(String(x?.refund ?? x?.win ?? 0).replace(/,/g, ""));
        if (Number.isFinite(b)) bet += b;
        if (Number.isFinite(r)) refund += r;
      }
      return refund - bet;
    }
    const bet = Number(String(o?.bet_total ?? "").replace(/,/g, ""));
    const win = Number(String(o?.win_total ?? "").replace(/,/g, ""));
    return Number.isFinite(bet) && Number.isFinite(win) ? win - bet : null;
  };
  const orderBetOf = (o: any) => {
    const main = mainBetSlipsOf(o);
    if (main.length)
      return main.reduce((sum: number, x: any) => {
        const n = Number(String(x?.bet ?? 0).replace(/,/g, ""));
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
    const n = Number(String(o?.bet_total ?? 0).replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const orderSettled = (o: any) => {
    const raw = o?.status ?? o?.state ?? o?.settle_status;
    if (Number(raw) === 3) return true;
    const status = String(raw ?? "").toLowerCase();
    return /settled|finished|completed|done|結算完成|已派彩/.test(status);
  };
  const readTodayPnl = (payload: any) => {
    const toNumber = (raw: any) => {
      if (raw == null || raw === "") return null;
      const n = Number(String(raw).replace(/,/g, "").trim());
      return Number.isFinite(n) ? n : null;
    };
    const fromTotalNode = (node: any) => {
      if (!node || typeof node !== "object") return null;
      // 只要官方「今日／總計」total.all.w，絕不用 page 小計。
      return toNumber(node?.total?.all?.w ?? node?.total?.all?.win);
    };
    const unwrap = (node: any) => {
      if (node == null) return null;
      if (typeof node === "string") {
        const t = node.trim();
        if (!(t.startsWith("{") || t.startsWith("[")) || t.length > 200000)
          return null;
        try {
          return JSON.parse(t);
        } catch {
          return null;
        }
      }
      return typeof node === "object" ? node : null;
    };
    // 今日輸贏 = 官方投注報表「今日／總計」→ total.all.w（不是小計 page.w）。
    const candidates = [
      payload?.msg?.total?.all?.w,
      payload?.data?.total?.all?.w,
      payload?.body?.total?.all?.w,
      payload?.msg?.data?.total?.all?.w,
      payload?.data?.msg?.total?.all?.w,
      payload?.body?.msg?.total?.all?.w,
      payload?.msg?.total?.all?.win,
      payload?.data?.total?.all?.win,
      payload?.body?.total?.all?.win,
    ];
    for (const raw of candidates) {
      const n = toNumber(raw);
      if (n !== null) return n;
    }
    // Shallow unwrap only — never walk into orders[]（單筆 total 會蓋掉總計）.
    const roots = [
      payload?.msg,
      payload?.data,
      payload?.body,
      payload?.msg?.data,
      payload?.data?.msg,
      payload?.body?.msg,
      payload?.result,
      payload?.response,
      payload,
    ];
    for (const root of roots) {
      const node = unwrap(root);
      if (!node) continue;
      const direct = fromTotalNode(node);
      if (direct !== null) return direct;
      for (const key of ["msg", "data", "body", "result", "response"]) {
        const child = unwrap(node?.[key]);
        const n = fromTotalNode(child);
        if (n !== null) return n;
      }
    }
    return null;
  };
  const gameSnOf = (o: any) => String(o?.gameSn ?? o?.game_sn ?? "").trim();
  const applyBetReport = (payload: any) => {
    // v25：gameSn 精準追蹤。只看正式 /bet/history 的莊/閒本注結算。
    // gameSn 判斷「哪一局」，betSn 只負責同局二次去重；不猜 play_id / winner。
    const allOrders = readBetReportOrders(payload);
    if (!allOrders.length) return;

    const settledMainOrders = [...allOrders]
      // betSn/order id is enough to track a settled main bet. Some current MT
      // /bet/history packets do not expose gameSn at order level; requiring it
      // caused valid Banker/Player settlements to be discarded before Martingale ran.
      .filter(
        (o) =>
          !!orderIdOf(o) && orderSettled(o) && mainBetSlipsOf(o).length > 0,
      )
      .sort((a, b) => orderTimeOf(a) - orderTimeOf(b)); // 舊 → 新，避免短時間多筆結算漏階
    if (!settledMainOrders.length) return;

    // 第一次收到正式報表：把「當下已存在」的本注全部設為基準。
    // 之後只處理真正新出現的 betSn，絕不把歷史下注拿來升降階。
    if (!betReportBaselineReadyRef.current) {
      betReportBaselineReadyRef.current = true;
      // 若基準報表剛好撞上 show_win/end：pending gameSn 不能被吃成歷史基準。
      // 其餘既有結算才標記為歷史。
      for (const o of settledMainOrders) {
        const id = orderIdOf(o);
        const gs = gameSnOf(o);
        const createdMs = orderTimeOf(o);
        const createdAfterTrackingStarted =
          betTrackingStartedAtRef.current > 0 &&
          createdMs >= betTrackingStartedAtRef.current;
        // 兩種情況都不能吃成歷史：
        // 1) show_win/end 已鎖到這個 gameSn；
        // 2) 這筆下注 created_at 明確是在本次連線開始追蹤之後。
        if (
          (gs && pendingSettlementGameSnRef.current.has(gs)) ||
          createdAfterTrackingStarted
        )
          continue;
        if (id) processedBetSnRef.current.add(id);
        if (gs) processedGameSnRef.current.add(gs);
      }
      const latest = settledMainOrders[settledMainOrders.length - 1];
      lastBetReportOrderRef.current = orderIdOf(latest);
      lastBetReportGameSnRef.current = gameSnOf(latest);
      appendEvent(
        `馬丁 gameSn 基準完成｜${processedGameSnRef.current.size} 局`,
      );
    }

    // 優先處理 show_win/end 已鎖定的 gameSn；同時保留「基準後新出現 gameSn」作安全網。
    const freshOrders = settledMainOrders.filter((o) => {
      const id = orderIdOf(o);
      const gs = gameSnOf(o);
      if (!id || processedBetSnRef.current.has(id)) return false;
      if (gs && processedGameSnRef.current.has(gs)) return false;
      // Prefer show_win/end gameSn matching when available. If MT omits gameSn
      // from the history order, betSn remains the authoritative de-duplication key.
      return (
        (gs && pendingSettlementGameSnRef.current.has(gs)) ||
        betReportBaselineReadyRef.current
      );
    });
    if (!freshOrders.length) return;

    for (const target of freshOrders) {
      const betSn = orderIdOf(target);
      const gameSn = gameSnOf(target);
      if (
        !betSn ||
        processedBetSnRef.current.has(betSn) ||
        (gameSn && processedGameSnRef.current.has(gameSn))
      )
        continue;

      const mainSlip = mainBetSlipsOf(target)[0];
      if (!mainSlip) continue;
      const contentName = String(
        mainSlip?.content_name ?? mainSlip?.contentName ?? "",
      ).trim();
      if (contentName !== "莊" && contentName !== "閒") continue;

      const side: BetSide = contentName === "閒" ? "閒" : "莊";
      const amount = Number(String(mainSlip?.bet ?? "").replace(/,/g, ""));
      const refund = Number(
        String(mainSlip?.refund ?? mainSlip?.win ?? "").replace(/,/g, ""),
      );
      if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(refund)) {
        appendEvent(`馬丁略過 ${gameSn || betSn}｜本注金額解析失敗`);
        continue;
      }

      // 先去重；status=3 已由 orderSettled 過濾。
      processedBetSnRef.current.add(betSn);
      if (gameSn) processedGameSnRef.current.add(gameSn);
      if (gameSn) pendingSettlementGameSnRef.current.delete(gameSn);
      lastBetReportOrderRef.current = betSn;
      lastBetReportGameSnRef.current = gameSn;

      const pnl = refund - amount;
      appendEvent(
        `馬丁結算｜${gameSn ? `gameSn ${gameSn}` : `betSn ${betSn}`}｜${side}｜下注 ${Math.round(amount)}｜返還 ${Math.round(refund)}｜本注 ${pnl > 0 ? "+" : ""}${Math.round(pnl)}`,
      );

      // 和局/退注：refund === bet，階級完全不變。
      if (Math.abs(pnl) < 0.000001) {
        appendEvent(`馬丁｜和局/退注｜階級維持`);
        continue;
      }

      const win = pnl > 0;
      setBankroll((v) => Math.round(v + pnl));
      setRecords((r) =>
        [
          {
            side,
            result: (win ? side : side === "閒" ? "莊" : "閒") as Result,
            amount: Math.round(amount),
            pnl: Math.round(pnl),
            at: Date.now(),
          },
          ...r,
        ].slice(0, 30),
      );

      if (strategyRef.current === "馬丁") {
        setStrategyLevel((level) => {
          const nextLevel = win ? 0 : level + 1;
          const nextStake =
            baseBetRef.current * (Math.pow(2, nextLevel + 1) - 1);
          appendEvent(
            `馬丁階級｜第 ${level + 1} 階 → 第 ${nextLevel + 1} 階｜下一注 ${Math.round(nextStake).toLocaleString()}`,
          );
          return nextLevel;
        });
      }
    }
  };

  const startConnection = (
    autoReason?: string,
    tokenSourceOverride?: string,
  ) => {
    // Once TZ is authenticated, the game socket may ONLY use the MT URL obtained
    // from that TZ session. Manual/state-edited tokens are never accepted.
    const tokenSource = accessGranted
      ? lockedMtUrlRef.current
      : tokenSourceOverride || token || mtUrl;
    const authToken = extractMtUrlToken(tokenSource);
    if (!authToken) {
      notify("請貼登入後含 token 的 MT 網址");
      reconnectingRef.current = false;
      return;
    }
    if (autoReason) {
      // Snapshot/封包可能短暫亂序：只記錄差異，絕不因此斷線重連。
      appendEvent(`牌路同步差異：${autoReason}（保持連線）`);
      reconnectingRef.current = false;
      awaitingFreshSnapshotRef.current = false;
      return;
    }
    // 主頁登入後會自動建立主 WS；若主線仍 OPEN / CONNECTING，直接沿用，禁止重複建立。
    const activeSocket = socketRef.current;
    if (
      activeSocket &&
      (activeSocket.readyState === WebSocket.OPEN ||
        activeSocket.readyState === WebSocket.CONNECTING)
    ) {
      appendEvent("主連線仍有效，不重複連線");
      return;
    }
    awaitingFreshSnapshotRef.current = true;
    // v27: 在 WebSocket 建立前就開始計時。第一包報表即使晚到，
    // 只要下注 created_at >= 這個時間，就必須當成新單結算馬丁。
    betTrackingStartedAtRef.current = Date.now();
    // New manual main-WS session: reset report baseline timing, but keep already processed order IDs.
    betReportBaselineReadyRef.current = false;
    processedGameSnRef.current.clear();
    pendingSettlementGameSnRef.current.clear();
    lastBetReportOrderRef.current = "";
    lastBetReportGameSnRef.current = "";
    const generation = ++socketGenerationRef.current;
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;
    setSocket(ws);
    let authenticated = false;
    let activeMtTableIds: string[] = [...confirmedMtTableIdsRef.current];
    let subscribedTableSignature = "";
    const requestTables = (quiet = false) => {
      if (authenticated && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            method: "GET",
            action: {
              name: "/api/v1/gametype/*/game/*/room/*/tables",
              data: { gametype_id: 3, game_id: 1, room_id: 1 },
            },
          }),
        );
        if (!quiet) appendEvent("已請求目前真人桌歷史牌局");
      }
    };
    const requestSvg = () =>
      authenticated &&
      ws.readyState === WebSocket.OPEN &&
      ws.send(
        JSON.stringify({
          method: "POST",
          action: { name: "/api/v1/gametype/*/game/*/room/*/tablesvg" },
        }),
      );
    const requestBalance = () => {
      if (!authenticated || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(
          JSON.stringify({
            method: "POST",
            action: { name: "/api/v1/member/me/balance" },
          }),
        );
      } catch {}
    };
    // 投注報表與牌路共用唯一已驗證的遊戲 WebSocket。
    // 同一 token 不再建立第二條 authenticate 連線，避免 MT 被伺服器踢下線。
    let dealerRefreshTimer: ReturnType<typeof setInterval> | null = null;
    let balanceRefreshTimer: ReturnType<typeof setInterval> | null = null;
    let betReportTimer: ReturnType<typeof setTimeout> | null = null;
    let dataSessionRefreshTimer: ReturnType<typeof setInterval> | null = null;
    let tablesRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let reportSettlementTimer: ReturnType<typeof setTimeout> | null = null;
    let reportSettlementFollowupTimer: ReturnType<typeof setTimeout> | null =
      null;
    let svgRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let pokerCardSyncTimer: ReturnType<typeof setTimeout> | null = null;
    let pokerCardSyncRun = 0;
    let subscribeTimer: ReturnType<typeof setTimeout> | null = null;
    let betReportInFlight = false;
    let betReportRequestAt = 0;
    // Taipei calendar day of the last applied MT 今日輸贏 (midnight → 0).
    let mtReportDayKey = mtTodayReportDay();
    // Short-lived settlement sync cycle. We cannot observe the cross-origin MT report UI
    // directly, so after show_win we query the SAME authenticated report endpoint
    // sequentially until its server-side aggregate/order data actually changes.
    let reportSyncActive = false;
    let reportSyncDeadline = 0;
    let reportSyncBaselinePnl: number | null = null;
    let reportSyncBaselineProcessed = 0;
    let reportSyncTimer: ReturnType<typeof setTimeout> | null = null;
    const memberWinSeen = new Set<string>();

    const isCurrentSocket = () =>
      socketGenerationRef.current === generation && socketRef.current === ws;
    const startBalanceRefresh = () => {
      if (balanceRefreshTimer) clearInterval(balanceRefreshTimer);
      balanceRefreshTimer = setInterval(() => {
        if (isCurrentSocket()) requestBalance();
      }, 5000);
    };
    const clearSocketTimers = () => {
      if (dealerRefreshTimer) clearInterval(dealerRefreshTimer);
      dealerRefreshTimer = null;
      if (balanceRefreshTimer) clearInterval(balanceRefreshTimer);
      balanceRefreshTimer = null;
      if (betReportTimer) clearTimeout(betReportTimer);
      betReportTimer = null;
      if (dataSessionRefreshTimer) clearInterval(dataSessionRefreshTimer);
      dataSessionRefreshTimer = null;
      if (tablesRefreshTimer) clearTimeout(tablesRefreshTimer);
      tablesRefreshTimer = null;
      if (reportSettlementTimer) clearTimeout(reportSettlementTimer);
      reportSettlementTimer = null;
      if (reportSettlementFollowupTimer)
        clearTimeout(reportSettlementFollowupTimer);
      reportSettlementFollowupTimer = null;
      if (reportSyncTimer) clearTimeout(reportSyncTimer);
      reportSyncTimer = null;
      reportSyncActive = false;
      if (svgRefreshTimer) clearTimeout(svgRefreshTimer);
      svgRefreshTimer = null;
      if (pokerCardSyncTimer) clearTimeout(pokerCardSyncTimer);
      pokerCardSyncTimer = null;
      pokerCardSyncRun++;
      if (subscribeTimer) clearTimeout(subscribeTimer);
      subscribeTimer = null;
    };
    // Collapse bursts from all currently available tables into one snapshot request.
    const scheduleTablesRefresh = (delay = 700) => {
      if (tablesRefreshTimer) clearTimeout(tablesRefreshTimer);
      tablesRefreshTimer = setTimeout(() => {
        tablesRefreshTimer = null;
        if (isCurrentSocket()) requestTables(true);
      }, delay);
    };
    const scheduleSvgRefresh = (delay = 350) => {
      if (svgRefreshTimer) clearTimeout(svgRefreshTimer);
      svgRefreshTimer = setTimeout(() => {
        svgRefreshTimer = null;
        if (isCurrentSocket()) requestSvg();
      }, delay);
    };
    const startPokerCardSync = () => {
      const run = ++pokerCardSyncRun;
      if (pokerCardSyncTimer) clearTimeout(pokerCardSyncTimer);
      const delays = [
        120, 280, 520, 900, 1400, 2000, 2700, 3500, 4400, 5400, 6500, 7700,
        9000, 10500, 12200, 14100, 16200, 18500,
      ];
      let index = 0;
      const next = () => {
        if (run !== pokerCardSyncRun || !isCurrentSocket() || !authenticated)
          return;
        // Low-impact fallback only. The authoritative final international-room
        // cards arrive through /summary and are consumed directly below, so do
        // not repeatedly rejoin tables or flood the heavier /tables endpoint.
        requestSvg();
        if (index >= delays.length - 1) {
          pokerCardSyncTimer = null;
          return;
        }
        const wait = delays[++index] - delays[index - 1];
        pokerCardSyncTimer = setTimeout(next, wait);
      };
      pokerCardSyncTimer = setTimeout(next, delays[0]);
    };

    const reportPayload = () => {
      const { begin_at, end_at } = mtTodayReportRange();
      return {
        method: "GET",
        action: {
          game_id: 1,
          gametype_id: 3,
          name: "/api/v1/gametype/*/game/*/bet/history",
          path: "/api/v1/gametype/3/game/1/bet/history",
        },
        body: {
          begin_at,
          cur: 1,
          end_at,
          room_id: 1,
          s: 8,
          table_id: 0,
        },
      };
    };

    const requestBetReport = () => {
      if (!authenticated || ws.readyState !== WebSocket.OPEN) return;
      // 只共用現有主 WS，不建立第二條線，也不重新驗證。
      // 報表請求序列化，避免大量請求干擾 MT。
      // 台北跨日：跟官方一樣歸 0，再用新的 begin_at/end_at 抓當天總計。
      const dayNow = mtTodayReportDay();
      if (mtReportDayKey !== dayNow) {
        mtReportDayKey = dayNow;
        todayPnlRef.current = 0;
        setTodayPnl(0);
        appendEvent(`MT 今日輸贏跨日歸零｜${dayNow}`);
      }
      if (betReportInFlight) {
        // Never stack report requests. A missing response may be retried after 2s.
        if (Date.now() - betReportRequestAt < 1500) return;
        betReportInFlight = false;
      }
      betReportInFlight = true;
      betReportRequestAt = Date.now();
      try {
        ws.send(JSON.stringify(reportPayload()));
      } catch {
        betReportInFlight = false;
        scheduleBetReportLoop(2000);
        return;
      }
      // Watchdog: if MT never replies, clear in-flight and keep 今日輸贏 polling alive.
      setTimeout(() => {
        if (!isCurrentSocket()) return;
        if (betReportInFlight && Date.now() - betReportRequestAt >= 7500) {
          betReportInFlight = false;
          appendEvent("今日輸贏報表逾時｜重試");
          scheduleBetReportLoop(1000);
        }
      }, 8000);
    };

    const scheduleBetReportLoop = (delay = 2000) => {
      if (betReportTimer) clearTimeout(betReportTimer);
      betReportTimer = setTimeout(
        () => {
          betReportTimer = null;
          if (isCurrentSocket() && authenticated && !betReportInFlight)
            requestBetReport();
        },
        Math.max(200, delay),
      );
    };

    const startBetReportRefresh = () => {
      if (betReportTimer) clearTimeout(betReportTimer);
      betReportTimer = null;
      // Heartbeat ~2s like DG: official /bet/history total.all.w → float 今日輸贏.
      requestBetReport();
      scheduleBetReportLoop(2000);
    };

    const scheduleSettlementReportProbe = (delay: number) => {
      if (reportSyncTimer) clearTimeout(reportSyncTimer);
      reportSyncTimer = setTimeout(() => {
        reportSyncTimer = null;
        if (!isCurrentSocket() || !reportSyncActive) return;
        if (Date.now() >= reportSyncDeadline) {
          reportSyncActive = false;
          return;
        }
        requestBetReport();
      }, delay);
    };

    const rememberSettlementGameSn = (packet: any) => {
      const roots = [
        packet,
        packet?.body,
        packet?.msg,
        packet?.data,
        packet?.body?.span,
        packet?.msg?.span,
      ];
      for (const x of roots) {
        const gs = String(x?.game_sn ?? x?.gameSn ?? "").trim();
        if (gs) {
          pendingSettlementGameSnRef.current.add(gs);
          return gs;
        }
      }
      return "";
    };
    const refreshBetReportAfterSettlement = (
      tableId?: string,
      packet?: any,
    ) => {
      const gs = packet ? rememberSettlementGameSn(packet) : "";
      appendEvent(
        `開牌${tableId ? ` ${tableId}` : ""}${gs ? `｜gameSn ${gs}` : ""} → 觸發正式報表同步`,
      );
      reportSyncActive = true;
      reportSyncDeadline = Date.now() + 12000;
      reportSyncBaselinePnl = todayPnlRef.current;
      reportSyncBaselineProcessed = processedBetSnRef.current.size;
      if (reportSyncTimer) clearTimeout(reportSyncTimer);
      reportSyncTimer = null;
      // Settlement: pull official today total immediately + short probes (DG-like cadence).
      betReportInFlight = false;
      requestBetReport();
      scheduleSettlementReportProbe(200);
      scheduleSettlementReportProbe(500);
      scheduleSettlementReportProbe(1000);
      scheduleSettlementReportProbe(2000);
      scheduleSettlementReportProbe(3500);
    };

    const refreshDataSession = () => {
      if (
        !isCurrentSocket() ||
        !authenticated ||
        ws.readyState !== WebSocket.OPEN
      )
        return;
      // Re-run post-auth DATA initialization on the SAME socket. Never reconnect/re-authenticate.
      requestTables(true);
      setTimeout(() => {
        if (isCurrentSocket() && authenticated) requestSvg();
      }, 25);
      setTimeout(() => {
        if (isCurrentSocket() && authenticated) subscribe(true);
      }, 50);
      setTimeout(() => {
        if (isCurrentSocket() && authenticated && !betReportInFlight)
          requestBetReport();
      }, 80);
      setTimeout(() => {
        if (isCurrentSocket() && authenticated) requestBalance();
      }, 120);
      setTimeout(() => {
        if (isCurrentSocket() && authenticated && !betReportInFlight)
          requestBetReport();
      }, 900);
    };

    const startDataSessionRefresh = () => {
      if (dataSessionRefreshTimer) clearInterval(dataSessionRefreshTimer);
      dataSessionRefreshTimer = setInterval(refreshDataSession, 15000);
    };
    const startDealerRefresh = () => {
      if (dealerRefreshTimer) clearInterval(dealerRefreshTimer);
      // Safety-net metadata refresh only. Live table events still update immediately.
      // 10s keeps membership, dealer metadata and roads current without hammering /tables.
      dealerRefreshTimer = setInterval(() => {
        if (isCurrentSocket()) requestTables(true);
      }, 10000);
    };
    const subscribe = (force = false) => {
      if (
        !authenticated ||
        ws.readyState !== WebSocket.OPEN ||
        !activeMtTableIds.length
      )
        return;
      const signature = activeMtTableIds.join(",");
      if (!force && signature === subscribedTableSignature) return;
      ws.send(
        JSON.stringify({
          method: "GET",
          action: {
            name: "/api/v1/gametype/*/game/*/room/*/mulitple_join",
            data: { table_id: signature },
          },
        }),
      );
      subscribedTableSignature = signature;
      appendEvent(`已訂閱目前 ${activeMtTableIds.length} 桌即時事件`);
    };
    const ingestV38TableSnapshots = (sources: any[]) => {
      let nextMap = v38ByTableRef.current,
        changed = false;
      for (const source of sources) {
        const raw = source?.game_data ?? source?.gameData;
        if (
          raw == null ||
          String(raw).trim() === "" ||
          String(raw).trim() === "0"
        )
          continue;
        const parsed = parseV38ShowPoker({
          body: {
            result: raw,
            table_id: getApiTableId(source),
            shoe: source?.shoe ?? source?.trend?.current_shoe,
            round: source?.round ?? source?.trend?.current_round,
          },
        });
        if (!parsed) continue;
        const prev = nextMap[parsed.tableId],
          next = mergeV38PokerState(prev, parsed);
        if (
          !prev ||
          next.result.join(",") !== prev.result.join(",") ||
          next.complete !== prev.complete ||
          next.round !== prev.round ||
          next.shoe !== prev.shoe
        ) {
          nextMap = { ...nextMap, [parsed.tableId]: next };
          changed = true;
        }
      }
      if (changed) {
        v38ByTableRef.current = nextMap;
        setV38ByTable(nextMap);
      }
    };
    ws.onopen = () => {
      if (!isCurrentSocket()) return;
      appendEvent("WebSocket 已連線，正在驗證");
      ws.send(
        JSON.stringify({
          method: "POST",
          action: {
            name: "/api/v1/authenticate",
            path: "/api/v1/authenticate",
          },
          body: { type: 3, token: authToken },
        }),
      );
    };
    ws.onmessage = (e) => {
      if (!isCurrentSocket()) return;
      try {
        const p = JSON.parse(e.data),
          name = eventName(p);
        // International MT rooms do not always publish the full hand through
        // show_poker. In some rounds the missing Banker cards / final third card
        // are supplied only by the settlement summary packet. Both packet types
        // must feed the exact same per-table, per-shoe, per-round merge state.
        const isPokerDelta = name.includes("/show_poker");
        const isPokerSummary = name.includes("/summary");
        if (isPokerDelta || isPokerSummary) {
          const parsed = parseV38ShowPoker(p);
          if (parsed) {
            const prev = v38ByTableRef.current[parsed.tableId];
            const merged = mergeV38PokerState(prev, parsed);
            // summary is MT's authoritative final card snapshot. Mark it settled
            // only after merging so settlement can never prevent late cards from
            // filling their original six result slots.
            const next = isPokerSummary
              ? { ...merged, settled: merged.complete }
              : merged;
            v38ByTableRef.current = {
              ...v38ByTableRef.current,
              [parsed.tableId]: next,
            };
            setV38ByTable(v38ByTableRef.current);
          }
        }
        if (name.includes("/api/v1/member/me/balance")) {
          const points = Number(
            p?.msg?.user?.points ??
              p?.body?.user?.points ??
              p?.data?.user?.points ??
              p?.msg?.points ??
              p?.body?.points ??
              p?.data?.points,
          );
          if (Number.isFinite(points)) {
            currentBalanceRef.current = points;
            setCurrentBalance(points);
          }
          return;
        }
        if (isBetReportPayload(p)) {
          betReportInFlight = false;
          const reportOrders = readBetReportOrders(p);
          const newest = reportOrders[0];
          appendEvent(
            `報表回傳｜${reportOrders.length} 筆${newest ? `｜最新 ${orderIdOf(newest) || "—"}｜status ${String(newest?.status ?? "—")}` : ""}`,
          );
          const reportTodayPnl = readTodayPnl(p);
          // Root rule: float 今日輸贏 = official total.all.w the moment it arrives.
          // Never invent 0 when the field is missing — that wiped live totals and
          // made the float lag/desync from 投注報表今日總計.
          if (reportTodayPnl !== null) {
            const changed = todayPnlRef.current !== reportTodayPnl;
            todayPnlRef.current = reportTodayPnl;
            setTodayPnl(reportTodayPnl);
            mtReportDayKey = mtTodayReportDay();
            if (changed)
              appendEvent(
                `今日輸贏即時更新｜${reportTodayPnl > 0 ? "+" : ""}${reportTodayPnl.toLocaleString()}`,
              );
          } else if (name.includes("/bet/history")) {
            appendEvent("今日輸贏同步｜此報表封包未找到 total.all.w（保留原值）");
          } else {
            appendEvent("今日輸贏同步｜此報表封包未找到 total.all.w");
          }
          const processedBefore = processedBetSnRef.current.size;
          applyBetReport(p);
          const processedAfter = processedBetSnRef.current.size;
          // Keep heartbeat alive from THIS reply (do not wait a long idle gap).
          scheduleBetReportLoop(reportSyncActive ? 400 : 2000);

          if (reportSyncActive) {
            const totalChanged =
              reportTodayPnl !== null &&
              reportSyncBaselinePnl !== null &&
              reportTodayPnl !== reportSyncBaselinePnl;
            // Only release the settlement lock when official total.all.w moved.
            // Stopping early when total is missing left the float frozen on the
            // pre-settle value (same class of bug as the SA revert lock).
            if (totalChanged) {
              reportSyncActive = false;
              if (reportSyncTimer) clearTimeout(reportSyncTimer);
              reportSyncTimer = null;
              appendEvent("結算報表已追上｜今日輸贏已同步");
              scheduleBetReportLoop(2000);
            } else if (Date.now() < reportSyncDeadline) {
              scheduleSettlementReportProbe(400);
            } else {
              reportSyncActive = false;
              scheduleBetReportLoop(2000);
            }
          }
          return;
        }
        if (name.includes("/api/v1/member/me/win")) {
          const span = p?.msg?.span ?? p?.body?.span ?? p?.span;
          if (span) {
            const tableId = String(span?.table_id ?? "").toUpperCase();
            const shoe = String(span?.shoe ?? "");
            const round = Number(span?.round) || 0;
            const points = Number(span?.points);
            const key = `${tableId}|${shoe}|${round}`;
            rememberSettlementGameSn(p);
            if (Number.isFinite(points) && !memberWinSeen.has(key)) {
              memberWinSeen.add(key);
              // Same pattern as SA/DG feel: bump float NOW from this round's
              // account P/L, then /bet/history total.all.w overwrites with 總計.
              // (Martingale still uses bet/history only — never this path.)
              const base =
                todayPnlRef.current === null ? 0 : Number(todayPnlRef.current);
              const next = Math.round(base + points);
              todayPnlRef.current = next;
              setTodayPnl(next);
              appendEvent(
                `MT 今日輸贏即時更新｜結算 ${points > 0 ? "+" : ""}${Math.round(points)} → ${next > 0 ? "+" : ""}${next.toLocaleString()}`,
              );
            }
            setTimeout(() => {
              if (isCurrentSocket()) {
                betReportInFlight = false;
                requestBetReport();
              }
            }, 80);
            setTimeout(() => {
              if (isCurrentSocket()) requestBalance();
            }, 120);
            setTimeout(() => {
              if (isCurrentSocket()) {
                betReportInFlight = false;
                requestBetReport();
              }
            }, 500);
            setTimeout(() => {
              if (isCurrentSocket()) {
                betReportInFlight = false;
                requestBetReport();
              }
            }, 1200);
            setTimeout(() => {
              if (isCurrentSocket()) requestBalance();
            }, 700);
          }
          return;
        }
        if (name.endsWith("/show_win") || name.includes("/show_win")) {
          startPokerCardSync();
          const winTableId = String(
            p?.table_id ?? p?.data?.table_id ?? p?.body?.table_id ?? "",
          ).toUpperCase();
          // Do not seal the poker state here. show_win may arrive before the
          // final international-room show_poker delta (most often the Banker's
          // third card). The hand remains mergeable until another shoe/round is
          // observed; recommendation dedupe is handled separately.
          refreshBetReportAfterSettlement(winTableId, p);
        }
        if (name.includes("/api/v1/authenticate")) {
          if (Number(p?.err) === 0) {
            authenticated = true;
            setConnected(true);
            appendEvent("authenticate 成功");
            // Float shows 0 immediately (DG-like), then bet/history overwrites with 總計.
            if (todayPnlRef.current === null) {
              todayPnlRef.current = 0;
              setTodayPnl(0);
              mtReportDayKey = mtTodayReportDay();
            }
            requestTables();
            requestBalance();
            startDealerRefresh();
            startBalanceRefresh();
            startBetReportRefresh();
            startDataSessionRefresh();
            svgRefreshTimer = setTimeout(() => {
              svgRefreshTimer = null;
              if (isCurrentSocket()) requestSvg();
            }, 200);
          } else {
            setConnected(false);
            appendEvent("authenticate 失敗");
          }
          return;
        }
        const src = eventTables(p);
        if (src && name.endsWith("/tables")) {
          const filtered = src.filter(isMtBaccaratTable);
          const retainedIds = collectConfirmedMtTableIds(
            confirmedMtTableIdsRef.current,
            filtered,
          );
          confirmedMtTableIdsRef.current = retainedIds;
          activeMtTableIds = [...retainedIds];
          setMtSnapshotReady(true);
          updateLiveTables((c) => {
            // The first complete snapshot after every connection/reconnection is the
            // confirmation source, exactly like a manual reconnect.
            if (awaitingFreshSnapshotRef.current) {
              awaitingFreshSnapshotRef.current = false;
              reconnectingRef.current = false;
              reconnectCooldownUntilRef.current = Date.now() + 8000;
              appendEvent("重新連線牌路確認完成");
              return reconcileCurrentMtTables(c, filtered, retainedIds);
            }

            // Same connection, same Shoe: reconcile in place. Never reconnect just because
            // a snapshot arrives out of order or is temporarily shorter.
            return reconcileCurrentMtTables(c, filtered, retainedIds);
          });
          ingestV38TableSnapshots(filtered);
          subscribe();
          return;
        }
        if (src && name.endsWith("/tablesvg")) {
          const filtered = src.filter(isMtBaccaratTable);
          const retainedIds = collectConfirmedMtTableIds(
            confirmedMtTableIdsRef.current,
            filtered,
          );
          confirmedMtTableIdsRef.current = retainedIds;
          activeMtTableIds = [...retainedIds];
          updateLiveTables((c) =>
            reconcileCurrentMtTables(c, filtered, retainedIds),
          );
          ingestV38TableSnapshots(filtered);
          if (retainedIds.length) setMtSnapshotReady(true);
          subscribe();
          return;
        }
        if (name.includes("/show_win")) {
          const actual = winnerToRoadResult(
            (p?.body ?? p?.msg ?? p?.data ?? {})?.winner,
          );
          if (actual) settlePending(actual, p);
          updateLiveTables((c) => {
            const reset = resetRoadForNewShoePayload(c, p);
            return applyDealerRealtime(applyLiveShowWin(reset, p), p);
          });
          scheduleTablesRefresh(1200);
          return;
        }
        if (
          name.includes("/table/") &&
          (name.endsWith("/wait") || name.endsWith("/end"))
        ) {
          if (name.endsWith("/end")) {
            const endTableId = String(
              p?.table_id ?? p?.data?.table_id ?? p?.body?.table_id ?? "",
            );
            refreshBetReportAfterSettlement(endTableId, p);
          }
          // wait/end are countdown lifecycle packets. International tables may
          // report round 0/1 before their new road snapshot is ready, so these
          // packets must never clear the currently painted road.
          updateLiveTables((c) =>
            applyDealerRealtime(applyLiveWait(c, p, activeMtTableIds), p),
          );
          return;
        }
      } catch {}
    };
    ws.onerror = () => {
      if (!isCurrentSocket()) return;
      setConnected(false);
      appendEvent("WebSocket 發生錯誤");
    };
    ws.onclose = () => {
      clearSocketTimers();
      betReportInFlight = false;
      if (!isCurrentSocket()) return;
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
      appendEvent("WebSocket 已中斷");
      // 主頁牌路維持自動連線。若是正常掉線，沿用既有 MT token 自動恢復；
      // stopConnection/logout 會先遞增 generation，因此不會誤觸這裡。
      if (accessGranted && lockedMtUrlRef.current) {
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          startConnection(undefined, lockedMtUrlRef.current);
        }, 1200);
      }
    };
  };

  const ensureDgAuthorization = async (force = false) => {
    const platformToken = platformTokenRef.current;
    if (!platformToken) throw new Error("登入授權已失效");
    if (!force && dgGameUrlRef.current) return dgGameUrlRef.current;
    if (dgAuthPromiseRef.current) return dgAuthPromiseRef.current;
    const promise = getDgLoginUrlFromPlatform(loginPlatform, platformToken)
      .then((url) => {
        if (platformTokenRef.current !== platformToken)
          throw new Error("登入工作階段已變更");
        dgGameUrlRef.current = url;
        dgLastAuthAtRef.current = Date.now();
        dgSameTokenRetryRef.current = 0;
        setDgGameUrl(url);
        if (!dgLiveHoldRef.current && !dgHasConnectedRef.current)
          setDgStatus("連線中");
        return url;
      })
      .finally(() => {
        if (dgAuthPromiseRef.current === promise)
          dgAuthPromiseRef.current = null;
      });
    dgAuthPromiseRef.current = promise;
    return promise;
  };

  const ensureSaAuthorization = async (force = false) => {
    const platformToken = platformTokenRef.current;
    if (!platformToken) throw new Error("登入授權已失效");
    if (!force && saGameUrlRef.current) return saGameUrlRef.current;
    if (saAuthPromiseRef.current) return saAuthPromiseRef.current;
    const promise = getExternalLoginUrlFromPlatform(
      loginPlatform,
      platformToken,
      "SA",
    )
      .then((url) => {
        if (platformTokenRef.current !== platformToken)
          throw new Error("登入工作階段已變更");
        saGameUrlRef.current = url;
        setSaGameUrl(url);
        if (!saHasConnectedRef.current) setSaStatus("連線中");
        return url;
      })
      .finally(() => {
        if (saAuthPromiseRef.current === promise)
          saAuthPromiseRef.current = null;
      });
    saAuthPromiseRef.current = promise;
    return promise;
  };

  const refreshMvLiveRooms = async () => {
    try {
      const r = await fetch("/api/mv/rooms");
      const data = await r.json();
      if (!data?.ok || !Array.isArray(data.rooms)) return;
      const next = (data.rooms as MvRoomDto[])
        .filter((room) => room?.name || room?.avatar)
        .map(mvRoomToTable);
      if (next.length) setMvLiveRooms(next);
      appendEvent(
        next.length
          ? `美女直播目錄已更新（${next.length} 間）`
          : "美女直播目錄更新失敗，沿用既有列表",
      );
    } catch {
      appendEvent("美女直播目錄更新失敗，沿用既有列表");
    }
  };

  const connectRoadDashboard = async (force = false) => {
    if (!accessGranted || !accessSessionId || roadConnectBusyRef.current)
      return;
    const platformToken = platformTokenRef.current;
    if (!platformToken) return;
    const dgForeground =
      dgBridgeActiveRef.current ||
      (mtOpenRef.current && gameViewPlatformRef.current === "DG");
    const saForeground =
      saBridgeActiveRef.current ||
      (mtOpenRef.current && gameViewPlatformRef.current === "SA");
    roadConnectBusyRef.current = true;
    if (!dgForeground) suppressDgRecoveryRef.current = false;
    if (force) {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      socketGenerationRef.current += 1;
      const old = socketRef.current;
      socketRef.current = null;
      try {
        old?.close();
      } catch {}
      setSocket(null);
      setConnected(false);
      if (!dgForeground) {
        try {
          dgControllerRef.current?.close();
        } catch {}
        dgControllerRef.current = null;
        await stopDgRelayServer(accessSessionId);
        setDgConnected(false);
        setDgStatus("連線中");
      }
      if (!saForeground) {
        try {
          saControllerRef.current?.close();
        } catch {}
        saControllerRef.current = null;
        await stopSaRelayServer(accessSessionId);
        setSaConnected(false);
        setSaStatus("連線中");
        saGameUrlRef.current = "";
        saAuthPromiseRef.current = null;
        saHasConnectedRef.current = false;
        setSaGameUrl("");
      }
      // 美女直播：重新拉取主播目錄（無 WS，目錄即連線狀態）
      void refreshMvLiveRooms();
    } else {
      if (!connected) setConnected(false);
      if (!dgForeground && !dgConnected) setDgStatus("連線中");
      if (!saForeground && !saConnected) setSaStatus("連線中");
    }
    const needMt = force || !lockedMtUrlRef.current || !connected;
    const needDg = !dgForeground && (force || !dgGameUrl || !dgConnected);
    const needSa = !saForeground && (force || !saGameUrl || !saConnected);
    const [mtResult, dgResult, saResult] = await Promise.allSettled([
      needMt
        ? getMtLoginUrlFromPlatform(loginPlatform, platformToken)
        : Promise.resolve(lockedMtUrlRef.current),
      needDg
        ? ensureDgAuthorization(force)
        : Promise.resolve(dgGameUrlRef.current || dgGameUrl),
      needSa
        ? ensureSaAuthorization(force)
        : Promise.resolve(saGameUrlRef.current || saGameUrl),
    ]);
    if (platformTokenRef.current !== platformToken) {
      roadConnectBusyRef.current = false;
      return;
    }
    if (mtResult.status === "fulfilled" && mtResult.value) {
      const url = mtResult.value;
      lockedMtUrlRef.current = url;
      setToken(url);
      setMtUrl(url);
      startConnection(undefined, url);
    } else if (mtResult.status === "rejected") {
      appendEvent(
        `MT 自動連線失敗：${String((mtResult.reason as any)?.message || mtResult.reason || "unknown")}`,
      );
    }
    if (dgResult.status === "fulfilled" && dgResult.value) {
      dgGameUrlRef.current = dgResult.value;
      setDgGameUrl(dgResult.value);
      setDgStatus("連線中");
    } else if (dgResult.status === "rejected") {
      setDgConnected(false);
      setDgStatus("連線中");
      appendEvent(
        `DG 自動連線失敗：${String((dgResult.reason as any)?.message || dgResult.reason || "unknown")}`,
      );
    }
    if (saResult.status === "fulfilled" && saResult.value) {
      saGameUrlRef.current = saResult.value;
      setSaGameUrl(saResult.value);
      setSaStatus("連線中");
      if (force && !saForeground) setSaConnectEpoch((v) => v + 1);
    } else if (saResult.status === "rejected") {
      setSaConnected(false);
      setSaStatus("連線中");
      appendEvent(
        `SA 自動連線失敗：${String((saResult.reason as any)?.message || saResult.reason || "unknown")}`,
      );
    }
    roadConnectBusyRef.current = false;
  };

  // DG-only same-session web proxy. When the real DG game opens we stop only
  // the competing Render Chromium transport, then load DG through our same-origin
  // proxy. The foreground game's own WebSocket is tunneled once and mirrored into
  // the existing DG relay, so the floating assistant keeps receiving the SAME data.
  const enterDgSameSessionProxy = async (gameUrl: string) => {
    if (!accessSessionId || !gameUrl) return "";
    try {
      const r = await fetch("/api/dg/proxy/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: accessSessionId, gameUrl }),
      });
      let data: any = null;
      try {
        data = await r.json();
      } catch {}
      if (!r.ok || !data?.ok || !data?.url)
        throw new Error(String(data?.error || "DG 單工作階段入口啟動失敗"));
      dgBridgeActiveRef.current = true;
      // Entering the foreground DG proxy reuses the existing relay/SSE.
      // Do not force the floating assistant offline here: its status must stay
      // driven by the relay's real connected/error/closed events.
      setDgNeedsRecovery(false);
      return String(data.url);
    } catch (error: any) {
      dgBridgeActiveRef.current = false;
      throw new Error(error?.message || "DG 單工作階段入口啟動失敗");
    }
  };


  const leaveDgSameSessionProxy = async () => {
    if (!dgBridgeActiveRef.current || !accessSessionId) return;
    dgBridgeActiveRef.current = false;
    // Leaving the game view does not close the background relay either. Keep
    // the last genuine SSE status until the relay reports a state transition.
    try {
      await fetch("/api/dg/proxy/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: accessSessionId }),
      });
    } catch {}
  };

  const extProxyActiveRef = useRef(false);
  const enterExternalSameOriginProxy = async (
    gameUrl: string,
    platform: "SA" | "MV",
  ) => {
    if (!accessSessionId || !gameUrl) return "";
    try {
      const r = await fetch("/api/ext/proxy/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: accessSessionId,
          gameUrl,
          platform,
        }),
      });
      let data: any = null;
      try {
        data = await r.json();
      } catch {}
      if (!r.ok || !data?.ok || !data?.url)
        throw new Error(String(data?.error || "同源代理啟動失敗"));
      extProxyActiveRef.current = true;
      // Like enterDgSameSessionProxy: do not force the floating assistant offline.
      // SA bridge status stays driven by relay connected/error/closed events.
      return String(data.url);
    } catch (error: any) {
      extProxyActiveRef.current = false;
      throw new Error(error?.message || "同源代理啟動失敗");
    }
  };

  const leaveExternalSameOriginProxy = async (opts?: {
    restoreRelay?: boolean;
  }) => {
    if (!extProxyActiveRef.current || !accessSessionId) return;
    const leavingSaBridge = saBridgeActiveRef.current;
    extProxyActiveRef.current = false;
    if (leavingSaBridge) saBridgeActiveRef.current = false;
    try {
      await fetch("/api/ext/proxy/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: accessSessionId,
          restoreRelay: opts?.restoreRelay !== false,
        }),
      });
    } catch {}
  };

  const enterSaForegroundBridge = async (gameUrl: string) => {
    if (!accessSessionId || !gameUrl) return;
    saBridgeActiveRef.current = true;
    await enterSaBridgeServer(accessSessionId, gameUrl);
  };

  const leaveSaForegroundBridge = async (opts?: { restoreRelay?: boolean }) => {
    if (!saBridgeActiveRef.current || !accessSessionId) return;
    saBridgeActiveRef.current = false;
    // Prefer proxy leave when an SA proxy session is active (it also leaves bridge).
    if (extProxyActiveRef.current) {
      await leaveExternalSameOriginProxy(opts);
      return;
    }
    await leaveSaBridgeServer(accessSessionId, opts);
  };

  const runAutoSweepToMain = async (opts?: {
    skipEmptyCheck?: boolean;
    silent?: boolean;
    force?: boolean;
  }) => {
    const platformToken = platformTokenRef.current;
    if (!platformToken || walletTransferBusyRef.current)
      return { ok: false, empty: true, message: "" };
    if (
      !opts?.force &&
      (mtOpenRef.current || enteringGameWalletRef.current)
    )
      return { ok: false, empty: true, message: "" };
    walletTransferBusyRef.current = true;
    walletTransferBusyRef.current = true;
    setWalletTransferBusy(true);
    try {
      const result = opts?.skipEmptyCheck
        ? await pullAllGameWalletsToMain(loginPlatform, platformToken)
        : await transferAllToMainWallet(loginPlatform, platformToken);
      if (result.ok) {
        suppressDgRecoveryRef.current = true;
        dgFreshAuthorizationRequiredRef.current = true;
        setDgNeedsRecovery(false);
        if (!opts?.silent) notify("已自動轉回主錢包");
      }
      return result;
    } catch {
      return { ok: false, empty: true, message: "自動轉回未完成" };
    } finally {
      walletTransferBusyRef.current = false;
      setWalletTransferBusy(false);
    }
  };

  // After TZ login: quick one-shot sweep unlocks enter ASAP; leftover cleanup
  // runs in the background so the user is not stuck on「轉點中」.
  useEffect(() => {
    if (!accessGranted || !accessSessionId) return;
    if (loginSweepDone) {
      let cancelled = false;
      let delayed: ReturnType<typeof setTimeout> | null = null;
      void (async () => {
        await connectRoadDashboard(false);
        if (cancelled) return;
        suppressDgRecoveryRef.current = true;
        dgFreshAuthorizationRequiredRef.current = true;
        delayed = setTimeout(() => {
          if (cancelled || mtOpenRef.current || enteringGameWalletRef.current)
            return;
          void runAutoSweepToMain({
            skipEmptyCheck: true,
            silent: true,
          }).then(() => {
            suppressDgRecoveryRef.current = true;
            dgFreshAuthorizationRequiredRef.current = true;
          });
        }, 1800);
      })();
      return () => {
        cancelled = true;
        if (delayed) clearTimeout(delayed);
      };
    }
    let cancelled = false;
    void (async () => {
      const platformToken = platformTokenRef.current;
      if (platformToken) {
        walletTransferBusyRef.current = true;
        setWalletTransferBusy(true);
        try {
          await quickSweepToMain(loginPlatform, platformToken);
        } catch {
        } finally {
          if (!cancelled) {
            walletTransferBusyRef.current = false;
            setWalletTransferBusy(false);
            loginSweepDoneRef.current = true;
            setLoginSweepDone(true);
          }
        }
        // Finish leftover cleanup in background; do not block enter again.
        void pullAllGameWalletsToMain(loginPlatform, platformToken).catch(
          () => {},
        );
      } else if (!cancelled) {
        loginSweepDoneRef.current = true;
        setLoginSweepDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessGranted, accessSessionId, loginPlatform, loginSweepDone]);

  // DG relay follows the automatically obtained background DG URL.
  useEffect(() => {
    if (!accessGranted) return;
    if (dgLiveHoldRef.current) return;
    if (!dgGameUrl) {
      if (!dgHasConnectedRef.current) setDgConnected(false);
      return;
    }
    let cancelled = false;
    try {
      dgControllerRef.current?.close();
    } catch {}
    dgControllerRef.current = null;
    if (!dgHasConnectedRef.current) {
      setDgConnected(false);
      setDgStatus("連線中");
    }
    connectDgLive(dgGameUrl, accessSessionId, {
      onPnl: (report) => {
        if (!cancelled) setDgTodayPnl(report);
      },
      onTables: (next: DgTableData[]) => {
        if (!cancelled) setDgTables(next as TableData[]);
      },
      onStatus: (status, message) => {
        if (cancelled) return;
        if (status === "connected") {
          dgHasConnectedRef.current = true;
          setDgConnected(true);
          setDgStatus("已連線");
          setDgNeedsRecovery(false);
          return;
        }
        if (status === "error" || status === "closed") {
          setDgNeedsRecovery(true);
          if (message) appendEvent(`DG 背景連線待恢復：${message}`);
          if (
            !dgHasConnectedRef.current &&
            !dgBridgeActiveRef.current &&
            !(mtOpenRef.current && gameViewPlatformRef.current === "DG")
          ) {
            setDgConnected(false);
            setDgStatus("連線中");
          }
        }
      },
      onEvent: (message) => {
        if (!cancelled) appendEvent(message);
      },
    })
      .then((controller) => {
        if (cancelled) {
          controller.close();
          return;
        }
        dgControllerRef.current = controller;
      })
      .catch((error: any) => {
        if (cancelled) return;
        setDgConnected(false);
        setDgStatus("連線中");
        setDgNeedsRecovery(true);
        appendEvent(`DG 背景連線待恢復：${error?.message || "unknown"}`);
      });
    return () => {
      cancelled = true;
      try {
        dgControllerRef.current?.close();
      } catch {}
      dgControllerRef.current = null;
    };
  }, [accessGranted, accessSessionId, dgGameUrl, dgConnectEpoch]);

  // SA relay follows the TZ/SALI launch URL (token query).
  useEffect(() => {
    if (!accessGranted) return;
    if (!saGameUrl) {
      if (!saHasConnectedRef.current) setSaConnected(false);
      return;
    }
    let cancelled = false;
    try {
      saControllerRef.current?.close();
    } catch {}
    saControllerRef.current = null;
    if (!saHasConnectedRef.current) {
      setSaConnected(false);
      setSaStatus("連線中");
    }
    connectSaLive(saGameUrl, accessSessionId, {
      // Official BetRecord → float 今日輸贏 (same number as SA 投注記錄).
      // Overwrites GameResult running total — DG-style: report is source of truth.
      onPnl: (report) => {
        if (cancelled) return;
        if (!Number.isFinite(report.value)) return;
        const next = applySaOfficialPnl(saReportRef.current, report.value);
        saReportRef.current = next;
        savePlatformReport("SA", next);
        setSaReport(next);
        appendEvent(
          `SA 今日輸贏即時更新｜官方報表 ${report.value > 0 ? "+" : ""}${report.value.toLocaleString()}`,
        );
      },
      // GameResult → immediate float bump (then official onPnl corrects).
      onResult: (ev: SaWinReportResult) => {
        if (cancelled || !ev?.road) return;
        settleSaFromGameResultRef.current(ev);
      },
      onTables: (next: SaTableData[]) => {
        if (cancelled) return;
        // Enforce official D01/C01 labels even if relay snapshot still has bare hostId.
        setSaTables(
          next.map((t) => {
            const hostKey = String(t.roomId || "").replace(/^SA/i, "") || String(t.apiId || "").replace(/^SA/i, "");
            const label = hostKey ? saTableLabel(hostKey) : "";
            if (!label || label === hostKey) return t as TableData;
            return {
              ...(t as TableData),
              id: label,
              name: label,
              tableBadge: label,
            };
          }),
        );
      },
      onStatus: (status, message) => {
        if (cancelled) return;
        if (status === "connected") {
          saHasConnectedRef.current = true;
          setSaConnected(true);
          setSaStatus("已連線");
          return;
        }
        if (status === "error" || status === "closed") {
          if (
            !saHasConnectedRef.current &&
            !saBridgeActiveRef.current &&
            !(mtOpenRef.current && gameViewPlatformRef.current === "SA")
          ) {
            setSaConnected(false);
            setSaStatus(message || "連線中");
          }
        } else if (status === "connecting" || status === "loading") {
          setSaStatus(message || "連線中");
        }
      },
      onEvent: (message) => {
        if (cancelled) return;
        appendEvent(message);
        if (message === "重複登入" || /重複登入/.test(String(message || "")))
          notify("重複登入：背景已讓出，請進入 SA，懸浮改吃遊戲資料", 4000);
      },
    })
      .then((controller) => {
        if (cancelled) {
          controller.close();
          return;
        }
        saControllerRef.current = controller;
      })
      .catch((error: any) => {
        if (cancelled) return;
        setSaConnected(false);
        setSaStatus("連線中");
        appendEvent(`SA 背景連線待恢復：${error?.message || "unknown"}`);
      });
    return () => {
      cancelled = true;
      try {
        saControllerRef.current?.close();
      } catch {}
      saControllerRef.current = null;
    };
  }, [accessGranted, accessSessionId, saGameUrl, saConnectEpoch]);


  // 如果 DG 原生遊戲把背景 relay 踢掉：先用「同一個已取得的 DG token」
  // 重掛一次背景 relay，不再呼叫 DGLI/login 取得第二組 token。這樣可避免
  // 因為新遊戲登入把原本牌路工作階段直接作廢。若同 token 仍被平台限制，
  // 遊戲開著時不無限互踢；回牌路後再走正式重新授權。
  // 回到牌路主頁後再自動重新授權並恢復。
  useEffect(() => {
    if (
      !accessGranted ||
      walletTransferBusy ||
      !dgNeedsRecovery ||
      suppressDgRecoveryRef.current ||
      dgBridgeActiveRef.current ||
      enteringGameWalletRef.current ||
      (mtOpen && gameViewPlatform === "DG")
    )
      return;
    if (!dgGameUrl) return;
    let cancelled = false;

    // 主頁斷線時先重用 SAME DG token，避免短時間內再次 DGLI/login
    // 產生另一組遊戲工作階段。只有同 token 已重試多次且原授權已超過
    // 冷卻時間，才允許真正重新授權。
    const authAge = Date.now() - dgLastAuthAtRef.current;
    const canFreshAuth = dgSameTokenRetryRef.current >= 3 && authAge > 90000;
    const retryDelay = Math.min(
      15000,
      2500 + dgSameTokenRetryRef.current * 2500,
    );
    const timer = setTimeout(() => {
      if (cancelled) return;
      setDgStatus("連線中");
      setDgNeedsRecovery(false);
      if (!canFreshAuth) {
        dgSameTokenRetryRef.current += 1;
        setDgConnectEpoch((v) => v + 1);
        appendEvent(
          `DG 使用原工作階段重連（${dgSameTokenRetryRef.current}/3）`,
        );
        return;
      }
      ensureDgAuthorization(true)
        .then(() => {
          if (cancelled) return;
          dgForegroundRecoveryAttemptRef.current = 0;
          setDgNeedsRecovery(false);
          setDgConnectEpoch((v) => v + 1);
          appendEvent("DG 原工作階段長時間無法恢復，已重新授權一次");
        })
        .catch((error: any) => {
          if (cancelled) return;
          setDgStatus("連線中");
          appendEvent(`DG 自動恢復失敗：${error?.message || "unknown"}`);
        });
    }, retryDelay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    accessGranted,
    mtOpen,
    gameViewPlatform,
    walletTransferBusy,
    dgNeedsRecovery,
    loginPlatform,
    dgGameUrl,
  ]);

  // Reuse the existing four-formula / parity tools with DG/SA live poker fields.
  // This only updates when the actual dealt cards change, not on every countdown packet.
  useEffect(() => {
    if (activePlatform !== "DG" && activePlatform !== "SA") return;
    const pokerTables =
      activePlatform === "DG" ? dgTables : (saTables as DgTableData[]);
    if (!pokerTables.length) return;
    let changed = false;
    const nextMap = { ...v38ByTableRef.current };
    for (const table of pokerTables as DgTableData[]) {
      const parsed = parseDgV38Poker(table);
      const keys = tableIdKeys(table);
      if (!parsed) {
        // SA: table.poker may briefly be absent while road/round still tick.
        // Keep last 算牌/奇偶 snapshot so floats do not drop to「等待完整 show_poker」
        // while the SA video still shows the dealt hand (MT/DG paths unchanged).
        if (activePlatform === "SA") continue;
        if (keys.some((k) => nextMap[k])) {
          for (const k of keys) delete nextMap[k];
          changed = true;
        }
        continue;
      }
      const prev = nextMap[parsed.tableId] || keys.map((k) => nextMap[k]).find(Boolean);
      const same =
        prev &&
        prev.shoe === parsed.shoe &&
        prev.round === parsed.round &&
        prev.player.join(",") === parsed.player.join(",") &&
        prev.banker.join(",") === parsed.banker.join(",");
      if (same) continue;
      nextMap[parsed.tableId] = {
        ...parsed,
        settled:
          prev?.shoe === parsed.shoe && prev?.round === parsed.round
            ? !!prev.settled
            : false,
      };
      if (table.id) nextMap[table.id] = nextMap[parsed.tableId];
      if (table.apiId) nextMap[table.apiId] = nextMap[parsed.tableId];
      if ((table as any).tableBadge) nextMap[String((table as any).tableBadge)] = nextMap[parsed.tableId];
      if (table.roomId) nextMap[table.roomId] = nextMap[parsed.tableId];
      changed = true;
    }
    if (changed) {
      v38ByTableRef.current = nextMap;
      setV38ByTable(nextMap);
    }
  }, [activePlatform, dgTables, saTables]);

  useEffect(() => {
    const exists = assistPool.some((t) => tableMatchesAssistId(t, assistTableId));
    if (!exists && assistPool.length)
      setAssistTableId(assistPool[0].apiId ?? assistPool[0].id);
  }, [activePlatform, assistPool.length]);
  const stopConnection = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectingRef.current = false;
    awaitingFreshSnapshotRef.current = false;
    socketGenerationRef.current += 1;
    const ws = socketRef.current;
    socketRef.current = null;
    try {
      ws?.close();
    } catch {}
    setSocket(null);
    setConnected(false);
    appendEvent("已手動中斷");
  };
  const logoutSession = () => {
    // Logout is intentionally synchronous on the client: switch to AccessScreen first.
    // Server session revocation is fire-and-forget so it can never block the screen change.
    const sessionToLogout = accessSessionId;
    void stopDgRelayServer(sessionToLogout);
    void stopSaRelayServer(sessionToLogout);
    setAccessGranted(false);
    setAccessSessionId("");
    setAccessNotice("");
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectingRef.current = false;
    awaitingFreshSnapshotRef.current = false;
    socketGenerationRef.current += 1;
    const ws = socketRef.current;
    socketRef.current = null;
    try {
      ws?.close();
    } catch {}
    setSocket(null);
    setConnected(false);
    try {
      dgControllerRef.current?.close();
    } catch {}
    dgControllerRef.current = null;
    setDgConnected(false);
    setDgStatus("未連線");
    dgGameUrlRef.current = "";
    dgAuthPromiseRef.current = null;
    dgLastAuthAtRef.current = 0;
    dgSameTokenRetryRef.current = 0;
    dgFreshAuthorizationRequiredRef.current = false;
    setDgGameUrl("");
    setDgTables([]);
    try {
      saControllerRef.current?.close();
    } catch {}
    saControllerRef.current = null;
    setSaConnected(false);
    setSaStatus("未連線");
    saGameUrlRef.current = "";
    saAuthPromiseRef.current = null;
    saHasConnectedRef.current = false;
    saBridgeActiveRef.current = false;
    setSaGameUrl("");
    setSaTables([]);
    platformTokenRef.current = "";
    setActivePlatform("MT");
    setConnectionOpen(false);
    setHelpOpen(false);
    setRadarOpen(false);
    setRadarDetailId(null);
    setAnalysisTable(null);
    setFloatingOpen(false);
    setMtOpen(false);
    resetStopLossForLogout();
    setToken("");
    setMtUrl("");
    lockedMtUrlRef.current = "";
    setHasEnteredGame(false);
    setDgWasOpened(false);
    gameViewUrlRef.current = "";
    setGameViewUrl("");
    setPlatformLaunching(false);
    setWalletTransferOpen(false);
    setWalletTransferBusy(false);
    setDgNeedsRecovery(false);
    dgHasConnectedRef.current = false;
    dgForegroundRecoveryAttemptRef.current = 0;
    dgBridgeActiveRef.current = false;
    suppressDgRecoveryRef.current = false;
    roadConnectBusyRef.current = false;
    // Revoke the server-side app session without awaiting it. The login screen is already active.
    if (sessionToLogout) {
      void logoutAccess
        .mutateAsync({ sessionId: sessionToLogout })
        .catch(() => {});
    }
  };
  const syncAssist = () => {
    if (activePlatform === "DG") {
      if (dgConnected) appendEvent("DG 懸浮輔助已同步即時資料");
      else notify("DG 尚未連線");
      return;
    }
    if (activePlatform === "MV") {
      notify("美女直播只開直播間，無牌路連線");
      return;
    }
    if (activePlatform === "SA") {
      if (saConnected || saTables.length > 0)
        appendEvent("SA 懸浮輔助已同步即時資料");
      else notify("SA 尚未連線");
      return;
    }
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          method: "POST",
          action: { name: "/api/v1/gametype/*/game/*/room/*/tablesvg" },
        }),
      );
      appendEvent("懸浮輔助已要求同步");
    } else notify("尚未連線");
  };

  useEffect(() => {
    if (activePlatform !== "MV") return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/mv/rooms");
        const data = await r.json();
        if (cancelled || !data?.ok || !Array.isArray(data.rooms)) return;
        const next = (data.rooms as MvRoomDto[])
          .filter((room) => room?.name || room?.avatar)
          .map(mvRoomToTable);
        if (next.length) setMvLiveRooms(next);
      } catch {
        // Keep seeded catalog.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePlatform]);

  const openCurrentPlatform = async (table?: TableData) => {
    if (table) setAssistTableId(table.apiId ?? table.id);
    if (platformLaunching) return;
    const platformToken = platformTokenRef.current;
    if (!platformToken) {
      notify("登入授權已失效，請重新登入");
      return;
    }
    // Gate (login / 回牌路) 轉點 must NOT open the game. Queue the enter
    // so when that gate ends we run the enter-time 轉點 and continue in.
    if (
      activePlatform !== "MV" &&
      (!loginSweepDoneRef.current || walletTransferBusyRef.current)
    ) {
      pendingAutoEnterRef.current = true;
      return;
    }
    setPlatformLaunching(true);
    const liveOnly = activePlatform === "MV";
    enteringGameWalletRef.current = !liveOnly;
    // Do not mark game open until enter-time 轉點 finishes — button stays「轉點中...」.
    try {
      if (!liveOnly) {
        // Max ~2s wait for any in-flight sweep; never block 25s on enter.
        const started = Date.now();
        while (
          walletTransferBusyRef.current &&
          Date.now() - started < 2000
        )
          await new Promise((resolve) => setTimeout(resolve, 100));
        // Enter-time 轉點: show「轉點中...」, then open the game in this same call.
        walletTransferBusyRef.current = true;
        setWalletTransferBusy(true);
        try {
          await quickSweepToMain(loginPlatform, platformToken);
          if (!loginSweepDoneRef.current) {
            loginSweepDoneRef.current = true;
            setLoginSweepDone(true);
          }
        } catch {
          // Still enter — platform login will handle wallet if main has balance.
        } finally {
          walletTransferBusyRef.current = false;
          setWalletTransferBusy(false);
        }
      }
      mtOpenRef.current = true;
      setMtOpen(true);
      if (activePlatform === "MT") {
        const url = await getMtLoginUrlFromPlatform(
          loginPlatform,
          platformToken,
        );
        // A fresh MTLI login can issue a new MT token. Replace the old main-data
        // socket instead of authenticating twice with two tokens.
        socketGenerationRef.current += 1;
        const old = socketRef.current;
        socketRef.current = null;
        try {
          old?.close();
        } catch {}
        setSocket(null);
        setConnected(false);
        lockedMtUrlRef.current = url;
        setToken(url);
        setMtUrl(url);
        startConnection(undefined, url);
        setGameViewPlatform("MT");
        gameViewUrlRef.current = url;
        setGameViewUrl(url);
      } else if (activePlatform === "DG") {
        // TZ 進遊戲才自動轉點：一次 DGLI/login。不要再打背景 start API，
        // 否則背景 WS 會跟 iframe 搶同一組 token，畫面會閃。
        gameViewPlatformRef.current = "DG";
        setGameViewPlatform("DG");
        suppressDgRecoveryRef.current = true;
        setDgNeedsRecovery(false);
        dgLiveHoldRef.current = true;
        if (dgBridgeActiveRef.current) await leaveDgSameSessionProxy();
        await stopDgRelayServer(accessSessionId);
        const url = await ensureDgAuthorization(true);
        dgForegroundRecoveryAttemptRef.current = 0;
        setDgWasOpened(true);
        const proxyUrl =
          Platform.OS === "web" ? await enterDgSameSessionProxy(url) : url;
        dgFreshAuthorizationRequiredRef.current = false;
        notify("已轉入DG");
        const nextUrl = proxyUrl || url;
        gameViewUrlRef.current = nextUrl;
        setGameViewUrl(nextUrl);
        dgLiveHoldRef.current = false;
        setDgConnectEpoch((v) => v + 1);
      } else if (activePlatform === "MV") {
        // Always open inside the app iframe — never window.open / 新分頁.
        // Only LIVE rooms enter; offline / 老爺 stay on homepage with 敬請期待.
        if (table && !table.live) {
          const comingSoon =
            table.category === "comingSoon" ||
            table.name === "老爺" ||
            /敬請期待|人家還沒好/.test(String(table.trend || ""));
          notify(
            comingSoon
              ? "老爺人家還沒好，請敬請期待"
              : "主播尚未開播，敬請期待",
            3500,
          );
          return;
        }
        // TZ LIVE77 registerAndLogin is one-time: proxy must NOT prefetch it
        // (see resolveLaunchUrl). Prefer proxy so cookies stick; else direct.
        if (isDemoPlatformToken(platformToken)) {
          notify(
            "演示模式無法開啟美女直播：請用真實 TZ 帳號登入後再進 LIVE77",
            5000,
          );
          gameViewUrlRef.current = "";
          setGameViewUrl("");
          setHasEnteredGame(false);
          mtOpenRef.current = false;
          setMtOpen(false);
          return;
        }
        const url = await getExternalLoginUrlFromPlatform(
          loginPlatform,
          platformToken,
          "MV",
        );
        gameViewPlatformRef.current = "MV";
        setGameViewPlatform("MV");
        if (extProxyActiveRef.current) await leaveExternalSameOriginProxy();
        let nextUrl = url;
        let via: "proxy" | "direct" = "direct";
        if (Platform.OS === "web") {
          try {
            const proxyUrl = await enterExternalSameOriginProxy(url, "MV");
            if (proxyUrl) {
              // Keep registerAndLogin as iframe src so TZ one-time auth runs
              // in the browser (proxy no longer prefetches/consumes it).
              nextUrl = proxyUrl;
              via = "proxy";
            }
          } catch {
            via = "direct";
            nextUrl = url;
          }
        }
        gameViewUrlRef.current = nextUrl;
        setGameViewUrl(nextUrl);
        setHasEnteredGame(true);
        setMtOpen(true);
        // After auth page loads, hop to the clicked room on the same proxy.
        const roomUid = String(
          table?.roomId ||
            table?.streamUrl?.match(/[?&]uid=([^&]+)/i)?.[1] ||
            "",
        ).trim();
        if (via === "proxy" && roomUid && /^\d+$/.test(roomUid)) {
          setTimeout(() => {
            if (gameViewPlatformRef.current !== "MV") return;
            const roomPath = `/live/home/indexView?uid=${encodeURIComponent(roomUid)}`;
            gameViewUrlRef.current = roomPath;
            setGameViewUrl(roomPath);
          }, 1600);
        }
        notify(
          via === "proxy"
            ? "已在程式內開啟美女直播"
            : "已在程式內開啟美女直播（直連 TZ 授權網址）",
        );
        return;
      } else if (activePlatform === "SA") {
        // Perfect match with DG enter (do not change DG):
        // 1) stop competing background relay
        // 2) one TZ/SALI launch for the game iframe
        // 3) same-origin proxy enterBridge — float does NOT login, only mirrors
        // 4) do NOT close SSE / force float offline — status stays relay-driven
        if (isDemoPlatformToken(platformToken)) {
          notify(
            "演示模式無法進入 SA 遊戲畫面：請用真實 TZ 帳號登入後取得 SALI 授權",
            5000,
          );
          gameViewUrlRef.current = "";
          setGameViewUrl("");
          setHasEnteredGame(false);
          mtOpenRef.current = false;
          setMtOpen(false);
          return;
        }
        gameViewPlatformRef.current = "SA";
        setGameViewPlatform("SA");
        if (extProxyActiveRef.current)
          await leaveExternalSameOriginProxy({ restoreRelay: false });
        // Do NOT stopSaRelayServer here. Homepage float already has live tables;
        // proxy enter → enterBridgeMode closes background PS_LOGIN (ERR26-safe)
        // but keeps the table cache so the float stays live until game mirrors.
        // (Stopping wiped the cache and left the float frozen on the last snapshot.)
        const url = await getExternalLoginUrlFromPlatform(
          loginPlatform,
          platformToken,
          "SA",
        );
        saGameUrlRef.current = url;
        let nextUrl = url;
        let usedProxy = false;
        if (Platform.OS === "web") {
          try {
            // /api/ext/proxy/enter → ensureSaRelayShell + enterBridgeMode (DG-equivalent).
            const proxyUrl = await enterExternalSameOriginProxy(url, "SA");
            if (proxyUrl) {
              nextUrl = proxyUrl;
              usedProxy = true;
              saBridgeActiveRef.current = true;
              appendEvent(
                "SA 單工作階段（同 DG）：遊戲登入，懸浮只鏡像遊戲封包",
              );
            }
          } catch (proxyErr: any) {
            usedProxy = false;
            saBridgeActiveRef.current = false;
            appendEvent(
              `SA 同源代理失敗：${proxyErr?.message || "unknown"}`,
            );
          }
        }
        if (!usedProxy) {
          // Without proxy there is no mirror path — play only (no second login).
          saBridgeActiveRef.current = true;
          await enterSaBridgeServer(accessSessionId, url);
          notify(
            "SA 未進入同源代理：可遊玩，但懸浮無法即時（與 DG 單工作階段相同限制）",
            7000,
          );
          gameViewUrlRef.current = nextUrl;
          setGameViewUrl(nextUrl);
          setSaGameUrl(url);
          setSaConnectEpoch((v) => v + 1);
          setHasEnteredGame(true);
          setMtOpen(true);
          return;
        }
        gameViewUrlRef.current = nextUrl;
        setGameViewUrl(nextUrl);
        setSaGameUrl(url);
        // Reconnect SSE to the bridged relay (tables already cached).
        setSaConnectEpoch((v) => v + 1);
        notify(`已轉入${platformDisplayName("SA")}`);
      } else {
        throw new Error(`不支援的平台：${activePlatform}`);
      }
      setHasEnteredGame(true);
      setMtOpen(true);
    } catch (error: any) {
      dgLiveHoldRef.current = false;
      enteringGameWalletRef.current = false;
      mtOpenRef.current = mtOpen;
      notify(error?.message || `取得 ${activePlatform} 平台授權失敗`);
    } finally {
      dgLiveHoldRef.current = false;
      setPlatformLaunching(false);
    }
  };
  openCurrentPlatformRef.current = openCurrentPlatform;
  const closeGameView = () => {
    const wasDg = gameViewPlatform === "DG";
    const wasMv = gameViewPlatform === "MV";
    const wasSa = gameViewPlatform === "SA";
    enteringGameWalletRef.current = false;
    mtOpenRef.current = false;
    setMtOpen(false);
    // 回牌路只關掉遊戲 iframe，背景 SSE／桌台不要整條拆掉重連。
    const leaveJobs: Promise<void>[] = [];
    if (wasDg) leaveJobs.push(leaveDgSameSessionProxy());
    if (wasSa) leaveJobs.push(leaveSaForegroundBridge());
    else if (wasMv && extProxyActiveRef.current)
      leaveJobs.push(leaveExternalSameOriginProxy());
    void Promise.all(leaveJobs);
    // 美女直播不轉點。
    if (wasMv) return;
    if (walletTransferBusyRef.current) return;
    const platformToken = platformTokenRef.current;
    if (!platformToken) return;
    // Same UI gate as login:「轉點中...」only — do NOT enter the game.
    // Enter happens only when user presses「進入平台」(that 轉點 then continues in).
    pendingAutoEnterRef.current = false;
    walletTransferBusyRef.current = true;
    setWalletTransferBusy(true);
    void quickSweepToMain(loginPlatform, platformToken)
      .then((result) => {
        if (result.ok) {
          suppressDgRecoveryRef.current = true;
          dgFreshAuthorizationRequiredRef.current = true;
          setDgNeedsRecovery(false);
          notify("已自動轉回主錢包");
        }
        // Background leftover cleanup — do not block UI.
        void pullAllGameWalletsToMain(loginPlatform, platformToken).catch(
          () => {},
        );
      })
      .catch(() => {})
      .finally(() => {
        walletTransferBusyRef.current = false;
        setWalletTransferBusy(false);
      });
  };

  const confirmTransferAll = () => {
    setWalletTransferOpen(true);
  };
  const executeTransferAll = async () => {
    if (walletTransferBusyRef.current) return;
    const platformToken = platformTokenRef.current;
    if (!platformToken) {
      notify("登入授權已失效，請重新登入");
      return;
    }
    walletTransferBusyRef.current = true;
    setWalletTransferBusy(true);
    try {
      const result = await transferAllToMainWallet(
        loginPlatform,
        platformToken,
      );
      if (result.ok) {
        // 轉回後不要關掉目前正在收牌路的 relay；只禁止「重新登入 DG」的自動恢復，
        // 避免剛轉回主錢包又因新的 DGLI/login 被平台自動轉回 DG。
        suppressDgRecoveryRef.current = true;
        dgFreshAuthorizationRequiredRef.current = true;
        setDgNeedsRecovery(false);
        notify("轉回成功");
        setWalletTransferOpen(false);
      } else if (result.empty) {
        notify("目前無可轉回點數");
        setWalletTransferOpen(false);
      } else notify(result.message || "轉回失敗");
    } catch (error: any) {
      notify(error?.message || "轉回失敗");
    } finally {
      walletTransferBusyRef.current = false;
      setWalletTransferBusy(false);
    }
  };
  const action = (kind: string, table: TableData) => {
    setAssistTableId(table.apiId ?? table.id);
    if (kind === "平台") void openCurrentPlatform(table);
    else if (kind === "分析") setAnalysisTable(table);
    else notify(`已關注百家樂 ${table.id}`);
  };
  const actionRef = useRef(action);
  actionRef.current = action;
  const stableTableAction = useMemo(
    () => (kind: string, table: TableData) => actionRef.current(kind, table),
    [],
  );
  const placeManualBet = (side: BetSide) => {
    if (pendingBet) {
      notify("上一筆仍在等待開獎");
      return;
    }
    if (nextAmount <= 0) {
      notify("請先設定基本單注");
      return;
    }
    const reportPlatform: ReportPlatformKey =
      activePlatform === "SA" ? "SA" : activePlatform === "DG" ? "DG" : "MT";
    setPendingBet({
      tableId: assistTableId,
      side,
      amount: nextAmount,
      reportPlatform,
    });
    appendEvent(`統計下注 ${assistTableId}：${side} ${nextAmount}`);
    setAssistPage(2);
  };
  const resetStats = () => {
    setBankroll(initialBankroll);
    setPeakBankroll(initialBankroll);
    setStrategyLevel(0);
    setLabSequence([1, 2, 3, 4]);
    setPendingBet(null);
    if (activePlatform === "SA") {
      const cleared = resetPlatformReport("SA");
      saReportRef.current = cleared;
      setSaReport(cleared);
    } else {
      setRecords([]);
    }
  };
  // 輸贏統計 history: SA uses isolated report.history.SA; MT/DG keep existing records.
  const statsRecords: BetRecord[] =
    activePlatform === "SA"
      ? saReport.history.map((h) => ({
          side: h.side,
          result: h.result,
          amount: h.amount,
          pnl: h.pnl,
          at: h.at,
        }))
      : records;
  const wins = statsRecords.filter((r) => r.pnl > 0).length,
    losses = statsRecords.filter((r) => r.pnl < 0).length,
    decisions = wins + losses;
  let streak = 0;
  if (statsRecords.length) {
    const win = statsRecords[0].pnl > 0,
      loss = statsRecords[0].pnl < 0;
    if (win || loss) {
      for (const r of statsRecords) {
        if ((win && r.pnl > 0) || (loss && r.pnl < 0)) streak++;
        else break;
      }
    }
  }
  const maxDrawdown = Math.max(0, peakBankroll - bankroll);

  const MultiTableRadar = ({ insideMt = false }: { insideMt?: boolean }) => {
    // Keep the current best table at the first position on both desktop and mobile.
    const signals = [...radarSignals].sort((a, b) => {
      if (a.id === bestRadar?.id) return -1;
      if (b.id === bestRadar?.id) return 1;
      return 0;
    });
    const renderRadarCard = (item: (typeof radarSignals)[number]) => {
      const best = item.id === bestRadar?.id;
      const state = confidenceState(item.confidence);
      return (
        <Pressable
          key={item.id}
          onPress={() => {
            setAssistTableId(item.id);
            setRadarDetailId(item.id);
          }}
          style={[
            s.radarCard,
            !desktop && s.radarCardMobile,
            best && s.radarCardBest,
          ]}
        >
          <View style={s.radarCardTop}>
            <Text style={s.radarRoom}>{item.id}</Text>
            {best ? <Text style={s.radarPick}>首選</Text> : null}
          </View>
          <View style={s.radarCardMain}>
            <View style={s.radarSideLine}>
              <View
                style={[
                  s.signalDot,
                  {
                    backgroundColor: item.ready ? state.color : "#5D6C78",
                    shadowColor: item.ready ? state.color : "transparent",
                  },
                ]}
              />
              <Text
                style={[
                  s.radarSide,
                  {
                    color: item.ready
                      ? resultColor(item.decision.side)
                      : "#7B8B96",
                  },
                ]}
              >
                {item.ready ? item.decision.side : "等待"}
              </Text>
            </View>
            <Text
              style={[
                s.radarConfidenceText,
                { color: item.ready ? state.color : "#687680" },
              ]}
            >
              {item.ready ? state.label : "等待"}
            </Text>
          </View>
        </Pressable>
      );
    };
    // 首頁：launcher 嵌在 overview（圖2/圖3）；進桌後才用絕對定位浮層。
    if (!radarOpen) {
      if (!insideMt) return null;
      const bestState = bestRadar
        ? confidenceState(bestRadar.confidence)
        : null;
      return (
        <Animated.View
          {...radarResponder.panHandlers}
          style={[
            s.radarLauncher,
            s.radarLauncherMt,
            !desktop && s.radarLauncherMobile,
            {
              top: radarBaseTop,
              right: radarRightGap,
              left: "auto" as any,
              width: radarLauncherWidth,
              transform: radarPosition.getTranslateTransform(),
            },
          ]}
        >
          <MaterialIcons name="radar" size={15} color="#63C7FF" />
          <Text style={s.radarLauncherText}>多桌雷達</Text>
          {bestRadar && bestState ? (
            <View style={s.radarLauncherBestWrap}>
              <View
                style={[
                  s.signalDotSmall,
                  {
                    backgroundColor: bestState.color,
                    shadowColor: bestState.color,
                  },
                ]}
              />
              <Text
                style={[
                  s.radarLauncherBest,
                  { color: resultColor(bestRadar.decision.side) },
                ]}
              >
                {bestRadar.id} · {bestRadar.decision.side}
              </Text>
            </View>
          ) : null}
        </Animated.View>
      );
    }
    const mobileColumns: Array<Array<(typeof radarSignals)[number]>> = [];
    if (!desktop) {
      for (let i = 0; i < signals.length; i += 2)
        mobileColumns.push(signals.slice(i, i + 2));
    }
    return (
      <View
        style={[
          s.radarPanel,
          insideMt && s.radarPanelMt,
          !desktop && s.radarPanelMobile,
        ]}
      >
        <View style={s.radarHead}>
          <View>
            <Text style={s.radarKicker}>MT MATRIX · MULTI-TABLE RADAR</Text>
            <Text style={s.radarTitle}>多桌雷達</Text>
          </View>
          <Pressable onPress={() => setRadarOpen(false)} style={s.radarClose}>
            <MaterialIcons name="keyboard-arrow-up" size={20} color="#DCEEFF" />
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[s.radarRail, !desktop && s.radarRailMobile]}
        >
          {desktop
            ? signals.map(renderRadarCard)
            : mobileColumns.map((column, i) => (
                <View key={`radar-col-${i}`} style={s.radarMobileColumn}>
                  {column.map(renderRadarCard)}
                </View>
              ))}
        </ScrollView>
      </View>
    );
  };

  const OverviewRadarLauncher = () => {
    if (radarOpen || mtOpen) return null;
    const bestState = bestRadar
      ? confidenceState(bestRadar.confidence)
      : null;
    return (
      <Pressable
        onPress={() => setRadarOpen(true)}
        style={[
          s.radarLauncherDocked,
          !desktop && s.radarLauncherDockedMobile,
        ]}
      >
        <MaterialIcons name="radar" size={15} color="#63C7FF" />
        <Text style={s.radarLauncherText}>多桌雷達</Text>
        {bestRadar && bestState ? (
          <View style={s.radarLauncherBestWrap}>
            <View
              style={[
                s.signalDotSmall,
                {
                  backgroundColor: bestState.color,
                  shadowColor: bestState.color,
                },
              ]}
            />
            <Text
              style={[
                s.radarLauncherBest,
                { color: resultColor(bestRadar.decision.side) },
              ]}
            >
              {bestRadar.id} · {bestRadar.decision.side}
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  const FloatingAssistant = ({ insideMt = false }: { insideMt?: boolean }) => {
    const glow = latest ? resultColor(latest) : "#5A6B78";
    const page1 = (
      <View {...pageSwipe.panHandlers} style={s.assistPage}>
        <View style={s.decisionRow}>
          <View style={s.decisionBox}>
            <Text style={s.smallLabel}>最近</Text>
            <View style={s.latestLine}>
              <View
                style={[
                  s.glowDot,
                  { backgroundColor: glow, shadowColor: glow },
                ]}
              />
              <Text style={[s.latestText, { color: glow }]}>
                {latest ?? "—"}
              </Text>
            </View>
          </View>
          <View style={s.decisionBox}>
            <Text style={s.smallLabel}>牌型</Text>
            <Text style={s.detectText}>
              {detectPattern(assistTable?.results ?? [])}
            </Text>
          </View>
          <View style={s.decisionBox}>
            <View style={s.recommendHeader}>
              <View style={s.recommendTitleConfidence}>
                <Text style={s.smallLabel}>推薦下注</Text>
                <View
                  style={[
                    s.signalDotSmall,
                    {
                      backgroundColor: assistConfidenceState.color,
                      shadowColor: assistConfidenceState.color,
                    },
                  ]}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    s.confidenceText,
                    {
                      color: assistConfidenceState.color,
                      textShadowColor: assistConfidenceState.color,
                    },
                  ]}
                >
                  {assistConfidenceState.label}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setStrategyLevel(0);
                  appendEvent(`${strategy}已手動重置至第 1 階`);
                }}
                style={s.martinResetMini}
              >
                <Text style={s.martinResetMiniText}>重置</Text>
              </Pressable>
            </View>
            <Text
              style={[s.recommendText, { color: resultColor(recommendation) }]}
            >
              {recommendation} {nextAmount.toLocaleString()}
            </Text>
            <View style={s.recommendMetaRow}>
              <Text style={[s.microText, s.recommendStrategyMeta]}>
                {strategy}｜第 {strategyLevel + 1} 階｜下一注{" "}
                {nextAmount.toLocaleString()}
              </Text>
            </View>
          </View>
        </View>
        <View style={s.todayPnlBox}>
          <Text style={s.smallLabel}>今日輸贏</Text>
          <Text
            style={[
              s.todayPnlValue,
              {
                color:
                  activeTodayPnl === null
                    ? "#FFFFFF"
                    : activeTodayPnl > 0
                      ? "#4ED58B"
                      : activeTodayPnl < 0
                        ? "#FF6973"
                        : "#FFFFFF",
              },
            ]}
          >
            {activeTodayPnl === null
              ? "—"
              : `${activeTodayPnl > 0 ? "+" : ""}${activeTodayPnl.toLocaleString()}`}
          </Text>
        </View>
        <View style={s.aiBox}>
          <View style={s.aiHead}>
            <Text style={s.aiTitle}>AI分析</Text>
            <Pressable
              style={({ pressed }: any) => [
                s.stopLossMiniBtn,
                pressed && s.stopLossMiniBtnPressed,
              ]}
              onPress={openStopLossSettings}
            >
              <Text style={s.stopLossMiniBtnText}>止損設定</Text>
            </Pressable>
          </View>
          <Text style={s.aiText}>{analysisText(assistTable)}</Text>
        </View>
      </View>
    );
    const page2 = (
      <View {...pageSwipe.panHandlers} style={s.assistPage}>
        <View style={s.moneyGrid}>
          <View style={s.fieldBox}>
            <Text style={s.smallLabel}>目前本金</Text>
            <TextInput
              keyboardType="numeric"
              value={String(bankroll)}
              onChangeText={(v) => {
                const n = Math.max(0, Number(v) || 0);
                setBankroll(n);
              }}
              style={s.moneyInput}
            />
          </View>
          <View style={s.fieldBox}>
            <Text style={s.smallLabel}>基本單注</Text>
            <TextInput
              keyboardType="numeric"
              value={String(baseBet)}
              onChangeText={(v) => setBaseBet(Math.max(0, Number(v) || 0))}
              style={s.moneyInput}
            />
          </View>
          <View style={s.fieldBox}>
            <Text style={s.smallLabel}>下一注</Text>
            <Text style={s.nextAmount}>{nextAmount.toLocaleString()}</Text>
          </View>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.strategyScroll}
          contentContainerStyle={s.strategyRow}
        >
          {strategies.map((x) => (
            <Pressable
              key={x}
              style={[s.strategyChip, strategy === x && s.strategyChipActive]}
              onPress={() => {
                setStrategy(x);
                setStrategyLevel(0);
              }}
            >
              <Text
                style={[
                  s.strategyChipText,
                  strategy === x && { color: "#fff" },
                ]}
              >
                {x}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={s.progressBox}>
          <Text style={s.smallLabel}>策略進度</Text>
          <Text style={s.progressText}>
            {strategy} · 第 {strategyLevel + 1} 階　→　下一注{" "}
            {nextAmount.toLocaleString()}
          </Text>
        </View>
      </View>
    );
    const page3 = (
      <View {...pageSwipe.panHandlers} style={s.assistPage}>
        <View style={s.betButtons}>
          <Pressable
            style={[s.betBtn, { backgroundColor: "#B8323B" }]}
            onPress={() => placeManualBet("莊")}
          >
            <Text style={s.betBtnText}>本局莊</Text>
          </Pressable>
          <Pressable
            style={[s.betBtn, { backgroundColor: "#1764C0" }]}
            onPress={() => placeManualBet("閒")}
          >
            <Text style={s.betBtnText}>本局閒</Text>
          </Pressable>
          <Pressable
            style={[s.betBtn, { backgroundColor: "#238A4B" }]}
            onPress={() => placeManualBet("和")}
          >
            <Text style={s.betBtnText}>和局</Text>
          </Pressable>
        </View>
        <View style={s.statsGrid}>
          <View>
            <Text style={s.smallLabel}>目前本金</Text>
            <Text style={s.statsValue}>{bankroll.toLocaleString()}</Text>
          </View>
          <View>
            <Text style={s.smallLabel}>總損益</Text>
            <Text
              style={[
                s.statsValue,
                {
                  color:
                    bankroll - initialBankroll >= 0 ? "#4ED58B" : "#FF6973",
                },
              ]}
            >
              {(bankroll - initialBankroll >= 0 ? "+" : "") +
                (bankroll - initialBankroll).toLocaleString()}
            </Text>
          </View>
          <View>
            <Text style={s.smallLabel}>勝 / 負</Text>
            <Text style={s.statsValue}>
              {wins} / {losses}
            </Text>
          </View>
          <View>
            <Text style={s.smallLabel}>勝率</Text>
            <Text style={s.statsValue}>
              {decisions ? ((wins / decisions) * 100).toFixed(1) : "0.0"}%
            </Text>
          </View>
        </View>
        <View style={s.recordBar}>
          <Text style={s.microText}>
            {pendingBet
              ? `等待開獎：${pendingBet.side} ${pendingBet.amount.toLocaleString()}`
              : `連${statsRecords[0]?.pnl > 0 ? "勝" : statsRecords[0]?.pnl < 0 ? "敗" : "續"} ${streak}　最大回撤 -${maxDrawdown.toLocaleString()}`}
          </Text>
          <Pressable onPress={resetStats}>
            <Text style={s.resetText}>重置統計</Text>
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.historyRow}
        >
          {statsRecords.slice(0, 8).map((r, i) => (
            <View key={i} style={s.historyChip}>
              <Text
                style={{
                  color: r.pnl >= 0 ? "#53D990" : "#FF7079",
                  fontSize: 9,
                  fontWeight: "800",
                }}
              >
                {r.side} {r.pnl >= 0 ? "+" : ""}
                {r.pnl.toLocaleString()}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>
    );
    if (!floatingOpen) return null;
    return (
      <Animated.View
        onLayout={(e: any) => {
          const l = e.nativeEvent?.layout;
          if (l?.width && l?.height) {
            panelSizeRef.current = { width: l.width, height: l.height };
          }
        }}
        style={[
          s.floatPanel,
          !desktop ? s.floatPanelMobile : null,
          { width: panelBaseWidth },
          insideMt ? s.floatPanelMt : null,
          Platform.OS === "web"
            ? ({
                overscrollBehavior: "contain",
                transformOrigin: "top left",
                pointerEvents: "auto",
              } as any)
            : null,
          {
            transform: !desktop
              ? [
                  ...panelPosition.getTranslateTransform(),
                  { scale: panelMobileScale },
                ]
              : panelPosition.getTranslateTransform(),
          },
        ]}
      >
        <View
          style={[
            s.floatHeader,
            Platform.OS === "web"
              ? ({
                  touchAction: "none",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                } as any)
              : null,
          ]}
          {...panelDrag.panHandlers}
        >
          <View style={s.floatHeadLeft}>
            <MatrixMark size={25} brand={activePlatform} />
            <View>
              <View style={s.floatBrandLine}>
                <Text style={s.floatTitle}>MATRIX ASSIST</Text>
                <Text style={s.floatStatus}>
                  {activeConnected
                    ? `● ${activePlatform} LIVE`
                    : `● ${activePlatform} OFFLINE`}
                </Text>
              </View>
              <ThreadsSignature />
            </View>
          </View>
          <View style={s.row}>
            <Pressable onPress={syncAssist} style={s.iconTextBtn}>
              <MaterialIcons name="sync" size={15} color="#fff" />
              <Text style={s.iconText}>同步</Text>
            </Pressable>
            <Pressable
              onPress={() => setV38Open((v) => !v)}
              style={[s.iconTextBtn, v38Open && s.v38LaunchActive]}
            >
              <MaterialIcons name="calculate" size={15} color="#fff" />
              <Text style={s.iconText}>算牌</Text>
            </Pressable>
            <Pressable
              onPress={() => setTerminalParityOpen((v) => !v)}
              style={[s.iconTextBtn, terminalParityOpen && s.v38LaunchActive]}
            >
              <MaterialIcons name="functions" size={15} color="#fff" />
              <Text style={s.iconText}>奇偶</Text>
            </Pressable>
            <Pressable onPress={() => setFloatingOpen(false)} style={s.iconBtn}>
              <MaterialIcons name="close" size={18} color="#fff" />
            </Pressable>
          </View>
        </View>
        <View style={s.selectorWrap}>
          <Pressable
            style={s.selector}
            onPress={() => {
              if (roomDropdownOpen) {
                roomDropdownOpenRef.current = false;
                setRoomDropdownOpen(false);
              } else {
                setRoomMenuTables(
                  assistPool.map((t) => ({ ...t, results: [...t.results] })),
                );
                roomDropdownOpenRef.current = true;
                setRoomDropdownOpen(true);
              }
            }}
          >
            <View style={s.selectorLeft}>
              <Text style={s.selectorValue}>{assistRoomTitle(assistTable, activePlatform) || assistTableId}</Text>
              <MaterialIcons
                name={
                  roomDropdownOpen ? "keyboard-arrow-up" : "keyboard-arrow-down"
                }
                size={18}
                color="#DCE8F0"
              />
            </View>
            <Text style={s.selectorMeta}>
              {activePlatform === "SA"
                ? `房型 ${assistTable?.roomId || assistTable?.id || "—"} · 荷官 ${
                    assistTable?.trend ||
                    (assistTable?.players !== "—" ? assistTable?.players : "—") ||
                    "—"
                  } · 第 ${assistTable?.round ?? 0} 局`
                : `荷官 ${assistTable?.name || "—"} · 第 ${assistTable?.round ?? 0} 局`}
            </Text>
          </Pressable>
          {roomDropdownOpen ? (
            <View style={s.roomDropdown}>
              <ScrollView
                ref={roomDropdownScrollRef}
                style={[
                  s.roomDropdownScroll,
                  Platform.OS === "web"
                    ? ({
                        overflowY: "auto",
                        overscrollBehavior: "contain",
                        touchAction: "pan-y",
                        WebkitOverflowScrolling: "touch",
                      } as any)
                    : null,
                ]}
                contentContainerStyle={s.roomDropdownContent}
                nestedScrollEnabled
                scrollEnabled
                directionalLockEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
                scrollEventThrottle={16}
                onScrollBeginDrag={() => {
                  roomDropdownOpenRef.current = true;
                }}
                onScroll={(e: any) => {
                  roomDropdownOffsetRef.current =
                    e.nativeEvent?.contentOffset?.y ??
                    roomDropdownOffsetRef.current;
                }}
                onWheel={(e: any) => {
                  e.stopPropagation?.();
                }}
              >
                {roomMenuTables.map((t) => {
                  const id = t.apiId ?? t.id;
                  const liveSignal = radarSignals.find((x) => tableMatchesAssistId(t, x.id));
                  const roomReady = liveSignal?.ready ?? false;
                  const roomState = confidenceState(
                    liveSignal?.confidence ?? 0,
                  );
                  return (
                    <Pressable
                      key={id}
                      style={[
                        s.roomDropdownItem,
                        id === assistTableId && s.roomDropdownItemActive,
                      ]}
                      onPress={() => {
                        setAssistTableId(id);
                        roomDropdownOpenRef.current = false;
                        setRoomDropdownOpen(false);
                        setRoomMenuTables([]);
                      }}
                    >
                      <View style={s.roomDropdownLeft}>
                        <Text style={s.roomDropdownText}>{assistRoomTitle(t, activePlatform) || id}</Text>
                        <Text numberOfLines={1} style={s.roomDropdownDealer}>
                          {activePlatform === "SA"
                            ? `房型 ${t.roomId || t.id} · 荷官 ${
                                t.trend || (t.players !== "—" ? t.players : "—") || "—"
                              }`
                            : `荷官 ${t.name || "—"}`}
                        </Text>
                      </View>
                      <View style={s.roomDropdownRight}>
                        <View style={s.roomConfidence}>
                          <View
                            style={[
                              s.signalDotSmall,
                              {
                                backgroundColor: roomReady
                                  ? roomState.color
                                  : "#5D6C78",
                                shadowColor: roomReady
                                  ? roomState.color
                                  : "transparent",
                              },
                            ]}
                          />
                          <Text
                            style={[
                              s.roomConfidenceText,
                              {
                                color: roomReady ? roomState.color : "#7B8B96",
                                textShadowColor: roomReady
                                  ? roomState.color
                                  : "transparent",
                              },
                            ]}
                          >
                            {roomReady ? roomState.label : "等待"}
                          </Text>
                        </View>
                        <Text style={s.roomDropdownMeta}>
                          第 {t.round ?? 0} 局
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </View>
        {assistPage === 0 ? page1 : assistPage === 1 ? page2 : page3}
        <View style={s.pageDots}>
          {[0, 1, 2].map((i) => (
            <Pressable key={i} onPress={() => setAssistPage(i)}>
              <View style={[s.pageDot, assistPage === i && s.pageDotActive]} />
            </Pressable>
          ))}
        </View>
      </Animated.View>
    );
  };

  const TerminalParityModel = ({
    insideMt = false,
  }: {
    insideMt?: boolean;
  }) => {
    if (!terminalParityOpen) return null;
    const data = liveV38;
    const dealt: string[] = [];
    if (data) {
      if (activePlatform === "MT") {
        const r = data.result;
        [0, 1, 2, 3, 4, 5].forEach((i) => {
          const rank = mtCardRank(r[i]);
          if (rank) dealt.push(rank);
        });
      } else {
        const player = data.player || [];
        const banker = data.banker || [];
        const n = Math.max(player.length, banker.length);
        for (let i = 0; i < n; i++) {
          if (player[i]) dealt.push(player[i]);
          if (banker[i]) dealt.push(banker[i]);
        }
      }
    }
    const calc = terminalParityResult(dealt);
    const ready = !!data?.complete;
    const side = ready ? calc.side : ("觀望" as V38Side);
    const sideColor =
      side === "莊" ? "#EF4E57" : side === "閒" ? "#2879E5" : "#A7B5BF";
    const status = !activeConnected
      ? "未連線"
      : !data
        ? "等待牌面"
        : ready
          ? "已完成"
          : "發牌中";
    const faceLine = dealt.length ? dealt.join("  ") : "—";
    const valueLine = calc.values.length ? calc.values.join("  ") : "—";
    const tens = ready ? Math.floor(calc.total / 10) : 0,
      ones = ready ? calc.total % 10 : 0;
    const formula = ready
      ? `${calc.total} → ${tens}+${ones} → ${calc.first}${calc.first >= 10 ? ` → ${calc.finalValue}` : ""}`
      : "等待完整開牌";
    return (
      <Animated.View
        style={[
          s.terminalPanel,
          !desktop && s.terminalPanelMobile,
          insideMt && s.v38PanelMt,
          { transform: terminalParityPosition.getTranslateTransform() },
        ]}
      >
        <View style={s.terminalHeader} {...terminalParityDrag.panHandlers}>
          <View style={s.v38HeaderLeft}>
            <MaterialIcons name="functions" size={16} color="#8ED8FF" />
            <View>
              <Text style={s.terminalTitle}>終值奇偶模型</Text>
              <Text style={s.v38Sub}>Terminal Parity Model · {status}</Text>
            </View>
          </View>
          <Pressable
            onPress={() => setTerminalParityOpen(false)}
            style={s.iconBtn}
          >
            <MaterialIcons name="close" size={17} color="#fff" />
          </Pressable>
        </View>
        <View style={s.terminalBody}>
          <View style={s.terminalLine}>
            <Text style={s.terminalLabel}>牌面</Text>
            <Text style={s.terminalCards}>{faceLine}</Text>
          </View>
          <View style={s.terminalLine}>
            <Text style={s.terminalLabel}>牌值</Text>
            <Text style={s.terminalValues}>{valueLine}</Text>
          </View>
          <View style={s.terminalCalcBox}>
            <Text style={s.terminalCalc}>{formula}</Text>
          </View>
          <View style={s.terminalResultRow}>
            <View>
              <Text style={s.terminalResultLabel}>終值</Text>
              <Text style={s.terminalFinal}>
                {ready
                  ? `${calc.finalValue} · ${calc.finalValue % 2 === 0 ? "偶數" : "奇數"}`
                  : "—"}
              </Text>
            </View>
            <View style={s.terminalSideWrap}>
              <Text style={s.terminalNext}>下一局方向</Text>
              <Text style={[s.terminalSide, { color: sideColor }]}>{side}</Text>
            </View>
          </View>
        </View>
      </Animated.View>
    );
  };

  const V38Calculator = ({ insideMt = false }: { insideMt?: boolean }) => {
    if (!v38Open) return null;
    const data = liveV38;
    const sideColor = (x: V38Side) =>
      x === "莊" ? "#EF4E57" : x === "閒" ? "#2879E5" : "#A7B5BF";
    const status = !activeConnected
      ? "未連線"
      : !data
        ? "等待牌面"
        : data.settled
          ? "已結算"
          : data.complete
            ? "牌面完成"
            : "發牌中";
    const cards = (xs?: string[]) => (xs?.length ? xs.join("  ") : "—");
    const allCards = data ? [...data.player, ...data.banker] : [];
    const values = allCards.map(baccaratCardValue);
    const total = values.reduce((a, b) => a + b, 0);
    const pp = data?.playerPoint ?? 0,
      bp = data?.bankerPoint ?? 0;
    const aRem = total % 3,
      bRem = total % 2,
      mul = bp * pp,
      mulRem = mul % 2,
      add = bp + pp,
      addRem = add % 2;
    const ready = !!data?.complete;
    const output = (x: V38Side) => (ready ? x : "觀望");
    const close = () => {
      setV38DetailOpen(false);
      setV38Open(false);
    };
    return (
      <Animated.View
        style={[
          s.v38Panel,
          !desktop && s.v38PanelMobile,
          insideMt && s.v38PanelMt,
          { transform: v38Position.getTranslateTransform() },
        ]}
      >
        <View style={s.v38Header} {...v38Drag.panHandlers}>
          <View style={s.v38HeaderLeft}>
            <MaterialIcons
              name={v38DetailOpen ? "functions" : "calculate"}
              size={18}
              color="#8ED8FF"
            />
            <View>
              <Text style={s.v38Title}>
                {v38DetailOpen ? "四式即時運算詳情" : "V38 四式算牌"}
              </Text>
              <Text style={s.v38Sub}>
                {assistTableId} · {status}
              </Text>
            </View>
          </View>
          <View style={s.row}>
            {v38DetailOpen ? (
              <Pressable
                onPress={() => setV38DetailOpen(false)}
                style={s.v38InfoBtn}
              >
                <MaterialIcons name="arrow-back" size={13} color="#D9F1FF" />
                <Text style={s.v38InfoBtnText}>返回</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => setV38DetailOpen(true)}
                style={s.v38InfoBtn}
              >
                <MaterialIcons name="info-outline" size={13} color="#D9F1FF" />
                <Text style={s.v38InfoBtnText}>更多資訊</Text>
              </Pressable>
            )}
            <Pressable onPress={close} style={s.iconBtn}>
              <MaterialIcons name="close" size={18} color="#fff" />
            </Pressable>
          </View>
        </View>
        {!v38DetailOpen ? (
          <View style={s.v38Body}>
            <View style={s.v38MetaRow}>
              <Text style={s.v38Meta}>
                Shoe {data?.shoe ?? assistTable?.shoe ?? "—"}
              </Text>
              <Text style={s.v38Meta}>
                Round {data?.round ?? assistTable?.round ?? 0}
              </Text>
            </View>
            <View style={s.v38Cards}>
              <View style={s.v38Hand}>
                <Text style={[s.v38HandSide, { color: "#2879E5" }]}>閒</Text>
                <Text style={s.v38CardText}>{cards(data?.player)}</Text>
                <Text style={s.v38Point}>
                  {data ? `${data.playerPoint} 點` : "—"}
                </Text>
              </View>
              <View style={s.v38Hand}>
                <Text style={[s.v38HandSide, { color: "#EF4E57" }]}>莊</Text>
                <Text style={s.v38CardText}>{cards(data?.banker)}</Text>
                <Text style={s.v38Point}>
                  {data ? `${data.bankerPoint} 點` : "—"}
                </Text>
              </View>
            </View>
            <View style={s.v38FormulaGrid}>
              {(["A", "B", "MUL", "ADD"] as const).map((k) => {
                const value = data?.complete ? data.formulas[k] : "觀望";
                return (
                  <View key={k} style={s.v38Formula}>
                    <Text style={s.v38FormulaName}>
                      {k === "A" ? "A公式" : k === "B" ? "B公式" : k}
                    </Text>
                    <Text
                      style={[s.v38FormulaSide, { color: sideColor(value) }]}
                    >
                      {value}
                    </Text>
                  </View>
                );
              })}
            </View>
            <View style={s.v38Recommend}>
              <View>
                <Text style={s.v38RecommendLabel}>下一局四式投票</Text>
                <Text style={s.v38RecommendHint}>
                  {data?.complete
                    ? data.settled
                      ? "本局已確認，推薦已更新"
                      : "牌面完成，等待結算確認"
                    : "等待完整 show_poker 資料"}
                </Text>
              </View>
              <Text
                style={[
                  s.v38RecommendSide,
                  {
                    color: sideColor(
                      data?.complete ? data.recommendation : "觀望",
                    ),
                  },
                ]}
              >
                {data?.complete ? data.recommendation : "觀望"}
              </Text>
            </View>
          </View>
        ) : (
          <ScrollView
            style={s.v38DetailScroll}
            contentContainerStyle={s.v38DetailContent}
            showsVerticalScrollIndicator
          >
            <View style={s.v38VectorBox}>
              <View style={s.v38DetailHeadRow}>
                <Text style={s.v38SectionCode}>INPUT VECTOR / LIVE</Text>
                <Text
                  style={[
                    s.v38LiveDot,
                    { color: ready ? "#4BD693" : "#FFB84D" },
                  ]}
                >
                  {ready ? "● VERIFIED" : "● STREAM"}
                </Text>
              </View>
              <Text style={s.v38VectorLine}>
                P = [{cards(data?.player)}] → Pₜ ={" "}
                {data ? String(pp).padStart(2, "0") : "—"}
              </Text>
              <Text style={s.v38VectorLine}>
                B = [{cards(data?.banker)}] → Bₜ ={" "}
                {data ? String(bp).padStart(2, "0") : "—"}
              </Text>
              <Text style={s.v38VectorLine}>
                V = [{values.length ? values.join(", ") : "—"}] ΣV ={" "}
                {data ? total : "—"}
              </Text>
            </View>

            <View style={s.v38ModelBox}>
              <View style={s.v38ModelTop}>
                <Text style={s.v38ModelName}>MODEL A</Text>
                <Text style={s.v38ModelTag}>MODULAR-3</Text>
                <Text
                  style={[
                    s.v38ModelOut,
                    { color: sideColor(output(data?.formulas.A ?? "觀望")) },
                  ]}
                >
                  {output(data?.formulas.A ?? "觀望")}
                </Text>
              </View>
              <Text style={s.v38Equation}>Fₐ(X) = [ Σᵢ V(Cᵢ) ] mod 3</Text>
              <Text style={s.v38Calc}>
                ΣV = {values.length ? values.join(" + ") : "—"} ={" "}
                {data ? total : "—"}
              </Text>
              <Text style={s.v38Calc}>
                Rₐ = {data ? `${total} − 3⌊${total}/3⌋ = ${aRem}` : "等待資料"}
              </Text>
              <Text style={s.v38Rule}>
                δₐ(R): R=0 → BANKER · R∈{"{1,2}"} → PLAYER
              </Text>
            </View>

            <View style={s.v38ModelBox}>
              <View style={s.v38ModelTop}>
                <Text style={s.v38ModelName}>MODEL B</Text>
                <Text style={s.v38ModelTag}>BINARY PARITY</Text>
                <Text
                  style={[
                    s.v38ModelOut,
                    { color: sideColor(output(data?.formulas.B ?? "觀望")) },
                  ]}
                >
                  {output(data?.formulas.B ?? "觀望")}
                </Text>
              </View>
              <Text style={s.v38Equation}>Fᵦ(X) = [ Σᵢ V(Cᵢ) ] mod 2</Text>
              <Text style={s.v38Calc}>
                Rᵦ = {data ? `${total} − 2⌊${total}/2⌋ = ${bRem}` : "等待資料"}
              </Text>
              <Text style={s.v38Calc}>
                PARITY ={" "}
                {data ? (bRem === 0 ? "EVEN / 2ℤ" : "ODD / 2ℤ+1") : "—"}
              </Text>
              <Text style={s.v38Rule}>EVEN → BANKER · ODD → PLAYER</Text>
            </View>

            <View style={s.v38ModelBox}>
              <View style={s.v38ModelTop}>
                <Text style={s.v38ModelName}>MODEL MUL</Text>
                <Text style={s.v38ModelTag}>PRODUCT PARITY</Text>
                <Text
                  style={[
                    s.v38ModelOut,
                    { color: sideColor(output(data?.formulas.MUL ?? "觀望")) },
                  ]}
                >
                  {output(data?.formulas.MUL ?? "觀望")}
                </Text>
              </View>
              <Text style={s.v38Equation}>Fₘ(B,P) = (Bₜ × Pₜ) mod 2</Text>
              <Text style={s.v38Calc}>
                {data ? `${bp} × ${pp} = ${mul}` : "等待資料"}
              </Text>
              <Text style={s.v38Calc}>
                Rₘ = {data ? `${mul} − 2⌊${mul}/2⌋ = ${mulRem}` : "—"}
              </Text>
              <Text style={s.v38Rule}>
                {data
                  ? mulRem === 0
                    ? "2ℤ / EVEN → BANKER"
                    : "2ℤ+1 / ODD → PLAYER"
                  : "EVEN → BANKER  ·  ODD → PLAYER"}
              </Text>
            </View>

            <View style={s.v38ModelBox}>
              <View style={s.v38ModelTop}>
                <Text style={s.v38ModelName}>MODEL ADD</Text>
                <Text style={s.v38ModelTag}>COMBINED PARITY</Text>
                <Text
                  style={[
                    s.v38ModelOut,
                    { color: sideColor(output(data?.formulas.ADD ?? "觀望")) },
                  ]}
                >
                  {output(data?.formulas.ADD ?? "觀望")}
                </Text>
              </View>
              <Text style={s.v38Equation}>F₊(B,P) = (Bₜ + Pₜ) mod 2</Text>
              <Text style={s.v38Calc}>
                {data ? `${bp} + ${pp} = ${add}` : "等待資料"}
              </Text>
              <Text style={s.v38Calc}>
                R₊ = {data ? `${add} − 2⌊${add}/2⌋ = ${addRem}` : "—"}
              </Text>
              <Text style={s.v38Rule}>
                {data
                  ? addRem === 0
                    ? "2ℤ / EVEN → BANKER"
                    : "2ℤ+1 / ODD → PLAYER"
                  : "EVEN → BANKER  ·  ODD → PLAYER"}
              </Text>
            </View>
          </ScrollView>
        )}
      </Animated.View>
    );
  };

  const transferBlocking =
    accessGranted &&
    activePlatform !== "MV" &&
    (!loginSweepDone || (walletTransferBusy && !platformLaunching));
  // Enter-click path: show flowing「轉點中...」while the pre-enter sweep runs,
  // then openCurrentPlatform continues into the game (no second click).
  const enterSweepBusy =
    platformLaunching &&
    walletTransferBusy &&
    activePlatform !== "MV";
  const showTransferDots = transferBlocking || enterSweepBusy;
  const enterBlocked = platformLaunching || transferBlocking;
  const enterPlatformLabel = showTransferDots
    ? `轉點中${transferDots}`
    : platformLaunching
      ? "進入中…"
      : activePlatform === "MV"
        ? "開啟美女直播"
        : `進入${platformDisplayName(activePlatform)}平台`;

  // Flowing「...」for login/回牌路 gate and for the enter-time sweep.
  useEffect(() => {
    if (!showTransferDots) {
      setTransferDots(".");
      return;
    }
    let n = 0;
    const id = setInterval(() => {
      n = (n % 3) + 1;
      setTransferDots(".".repeat(n));
    }, 420);
    return () => clearInterval(id);
  }, [showTransferDots]);

  // User pressed「進入」during login/回牌路 gate → after gate ends, run
  // enter-time 轉點 and open the game (no second click).
  useEffect(() => {
    if (!accessGranted) return;
    if (transferBlocking || platformLaunching) return;
    if (!pendingAutoEnterRef.current) return;
    if (activePlatform === "MV") {
      pendingAutoEnterRef.current = false;
      return;
    }
    if (mtOpenRef.current) {
      pendingAutoEnterRef.current = false;
      return;
    }
    pendingAutoEnterRef.current = false;
    void openCurrentPlatformRef.current();
  }, [accessGranted, transferBlocking, platformLaunching, activePlatform]);

  if (!accessGranted)
    return (
      <AccessScreen
        notice={accessNotice}
        onAuthenticated={(sessionId, platformToken, platform) => {
          setAccessSessionId(sessionId);
          setAccessNotice("");
          setActivePlatform("MT");
          platformTokenRef.current = platformToken;
          setLoginPlatform(platform);
          lockedMtUrlRef.current = "";
          setToken("");
          setMtUrl("");
          dgGameUrlRef.current = "";
          dgAuthPromiseRef.current = null;
          dgLastAuthAtRef.current = 0;
          dgSameTokenRetryRef.current = 0;
          dgFreshAuthorizationRequiredRef.current = false;
          setDgGameUrl("");
          setDgTables([]);
          setDgConnected(false);
          setDgStatus("連線中");
          setDgNeedsRecovery(false);
          dgHasConnectedRef.current = false;
          dgForegroundRecoveryAttemptRef.current = 0;
          suppressDgRecoveryRef.current = false;
          roadConnectBusyRef.current = false;
          setHasEnteredGame(false);
          setDgWasOpened(false);
          gameViewUrlRef.current = "";
          setGameViewUrl("");
          loginSweepDoneRef.current = false;
          setLoginSweepDone(false);
          walletTransferBusyRef.current = false;
          setWalletTransferBusy(false);
          // Do not auto-enter after login sweep — user clicks「進入」themselves.
          pendingAutoEnterRef.current = false;
          setAccessGranted(true);
        }}
      />
    );

  return (
    <ScreenContainer
      edges={["top", "left", "right", "bottom"]}
      containerClassName="bg-[#080E17]"
      className="bg-[#080E17]"
    >
      <View
        style={[
          s.screen,
          activePlatform === "DG" && s.screenDg,
          activePlatform === "SA" && s.screenAb,
          activePlatform === "MV" && s.screenDb,
          desktop && Platform.OS === "web" ? s.screenDesktopZoom : null,
        ]}
      >
        <View
          style={[
            s.topbar,
            !desktop ? s.topbarMobile : null,
            activePlatform === "DG" && s.topbarDg,
            activePlatform === "SA" && s.topbarAb,
            activePlatform === "MV" && s.topbarDb,
          ]}
        >
          <View style={s.brandRow}>
            <View
              style={[
                s.brandIcon,
                activePlatform === "DG" && s.brandIconDg,
                activePlatform === "SA" && s.brandIconAb,
                activePlatform === "MV" && s.brandIconDb,
              ]}
            >
              <MatrixMark size={29} brand={activePlatform} />
            </View>
            <View style={{ minWidth: 0, flexShrink: 1 }}>
              {desktop ? (
                <Text style={[s.kicker, activePlatform === "DG" && s.kickerDg, activePlatform === "SA" && s.kickerAb, activePlatform === "MV" && s.kickerDb]}>
                  LIVE TABLE ANALYTICS
                </Text>
              ) : null}
              <View style={s.brandTitleRow}>
                <Text
                  numberOfLines={1}
                  style={[s.title, !desktop && s.titleMobile]}
                >
                  {activePlatform} MATRIX
                </Text>
                {desktop ? <ThreadsSignature /> : null}
              </View>
            </View>
          </View>
          <View style={[s.headerActions, !desktop && s.headerActionsMobile]}>
            <Pressable
              style={[s.lineBtn, !desktop && s.lineBtnMobile]}
              onPress={openLineContact}
            >
              <View style={[s.lineLogo, !desktop && s.lineLogoMobile]}>
                <Text style={s.lineLogoText}>LINE</Text>
              </View>
              {desktop ? <Text style={s.lineText}>LINE</Text> : null}
            </Pressable>
            <Pressable
              style={[s.headerBtn, !desktop && s.headerBtnMobile]}
              onPress={() => setHelpOpen(true)}
            >
              <MaterialIcons name="help-outline" size={desktop ? 16 : 14} color="#fff" />
              <Text style={[s.headerBtnText, !desktop && s.headerBtnTextMobile]}>說明</Text>
            </Pressable>
            <Pressable
              style={[s.headerBtn, !desktop && s.headerBtnMobile]}
              onPress={logoutSession}
            >
              <MaterialIcons name="logout" size={desktop ? 16 : 14} color="#fff" />
              <Text style={[s.headerBtnText, !desktop && s.headerBtnTextMobile]}>登出</Text>
            </Pressable>
            <Pressable
              style={[s.headerBtn, !desktop && s.headerBtnMobile]}
              onPress={() => setConnectionOpen(true)}
            >
              <MaterialIcons name="settings" size={desktop ? 16 : 14} color="#fff" />
              <Text style={[s.headerBtnText, !desktop && s.headerBtnTextMobile]}>連線</Text>
            </Pressable>
            {activePlatform !== "MV" ? (
              <Pressable
                disabled={walletTransferBusy}
                onPress={confirmTransferAll}
                style={[
                  s.headerBtn,
                  !desktop && s.headerBtnMobile,
                  walletTransferBusy && s.headerBtnMuted,
                ]}
              >
                <MaterialIcons
                  name="account-balance-wallet"
                  size={desktop ? 16 : 14}
                  color="#FFF1C6"
                />
                <Text style={s.headerBtnText}>
                  {walletTransferBusy ? "轉回中" : "轉回"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content}>
          <View
            style={[
              s.overview,
              !desktop && s.overviewMobile,
              activePlatform === "DG" && s.overviewDg,
              activePlatform === "SA" && s.overviewAb,
              activePlatform === "MV" && s.overviewDb,
            ]}
          >
            <View style={!desktop ? s.overviewTextMobile : undefined}>
              <Text
                style={[
                  s.overKicker,
                  activePlatform === "DG" && s.overKickerDg,
                  activePlatform === "SA" && s.overKickerAb,
                  activePlatform === "MV" && s.overKickerDb,
                ]}
              >
                REAL-TIME MONITORING
              </Text>
              <View style={!desktop ? s.overTitleRowMobile : undefined}>
                <Text style={s.overTitle}>LIVE TABLE MATRIX</Text>
                {!desktop ? <OverviewRadarLauncher /> : null}
              </View>
              <Text style={s.overSub}>
                {activePlatform === "DG"
                  ? "DG 真人桌況 · 黑金牌路 · 荷官同步"
                  : "即時桌況 · 牌路分析 · 荷官同步"}
              </Text>
            </View>
            <View
              style={
                desktop
                  ? { flexDirection: "row", alignItems: "center", gap: 8 }
                  : undefined
              }
            >
            {desktop ? <OverviewRadarLauncher /> : null}
            <View style={[s.overLaunchCol, !desktop && s.overLaunchColMobile]}>
              <View style={[s.overStats, !desktop && s.overStatsMobile]}>
                <View
                  style={[
                    s.overStat,
                    s.overStatCompact,
                    !desktop && s.overStatMobile,
                    activePlatform === "DG" && s.overStatDg,
                    activePlatform === "SA" && s.overStatAb,
                    activePlatform === "MV" && s.overStatDb,
                  ]}
                >
                  <Text style={s.smallLabel}>連線狀態</Text>
                  <Text
                    style={[
                      s.overValue,
                      { color: activeConnected ? "#4BD693" : "#FFB54D" },
                    ]}
                  >
                    {activeConnected
                      ? "已連線"
                      : activePlatform === "MV"
                        ? "僅直播"
                        : activePlatform === "SA"
                          ? saStatus === "未連線"
                            ? "連線中"
                            : saStatus
                          : "連線中"}
                  </Text>
                  <Text style={s.overStatMeta}>
                    {activePlatform === "MV"
                      ? "美女直播 · 無牌路"
                      : `${platformDisplayName(activePlatform)} · ${availableTableCount} 桌`}
                  </Text>
                </View>
                <View style={s.platformSwitch}>
                  <View style={s.platformSwitchRow}>
                    {(["MT", "DG"] as PlatformKey[]).map((p) => (
                      <Pressable
                        key={p}
                        onPress={() => {
                          setActivePlatform(p);
                          setActiveCategory("一般");
                        }}
                        style={[
                          s.platformTab,
                          activePlatform === p &&
                            (p === "DG"
                              ? s.platformTabDgActive
                              : s.platformTabMtActive),
                        ]}
                      >
                        <Text
                          style={[
                            s.platformTabText,
                            activePlatform === p &&
                              (p === "DG"
                                ? s.platformTabTextDgActive
                                : s.platformTabTextActive),
                          ]}
                        >
                          {p}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={s.platformSwitchRow}>
                    {(["SA", "MV"] as PlatformKey[]).map((p) => (
                      <Pressable
                        key={p}
                        onPress={() => {
                          setActivePlatform(p);
                          setActiveCategory("所有");
                        }}
                        style={[
                          s.platformTab,
                          activePlatform === p &&
                            (p === "SA" ? s.platformTabAbActive : s.platformTabDbActive),
                        ]}
                      >
                        <Text
                          style={[
                            s.platformTabText,
                            activePlatform === p &&
                              (p === "SA" ? s.platformTabTextAbActive : s.platformTabTextDbActive),
                          ]}
                        >
                          {platformDisplayName(p)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
              <Pressable
                disabled={platformLaunching}
                onPress={() => {
                  if (transferBlocking) {
                    pendingAutoEnterRef.current = true;
                    return;
                  }
                  void openCurrentPlatform();
                }}
                style={[
                  s.enterPlatformBtn,
                  activePlatform === "DG"
                    ? s.enterPlatformBtnDg
                    : activePlatform === "SA"
                      ? s.enterPlatformBtnAb
                      : activePlatform === "MV"
                        ? s.enterPlatformBtnDb
                        : s.enterPlatformBtnMt,
                  !desktop && s.enterPlatformBtnMobile,
                  enterBlocked && s.enterPlatformBtnBusy,
                ]}
              >
                <MaterialIcons
                  name={
                    activePlatform === "MV"
                      ? "videocam"
                      : "sports-esports"
                  }
                  size={desktop ? 15 : 14}
                  color={
                    activePlatform === "DG"
                      ? "#E8C778"
                      : activePlatform === "SA"
                        ? "#8EC4F0"
                        : activePlatform === "MV"
                          ? "#7EE0D2"
                          : "#7DCEF2"
                  }
                />
                <Text
                  style={[
                    s.enterPlatformBtnText,
                    activePlatform === "DG"
                      ? s.enterPlatformBtnTextDg
                      : activePlatform === "SA"
                        ? s.enterPlatformBtnTextAb
                        : activePlatform === "MV"
                          ? s.enterPlatformBtnTextDb
                          : s.enterPlatformBtnTextMt,
                    !desktop && s.enterPlatformBtnTextMobile,
                  ]}
                >
                  {enterPlatformLabel}
                </Text>
              </Pressable>
            </View>
            </View>
          </View>
          <View style={s.listHead}>
            <Text style={s.listTitle}>
              {activePlatform === "MV" ? "直播牌卡" : "所有房型"}
            </Text>
            <Text style={s.listHint}>
              {activePlatform === "MV"
                ? "美女直播 · 程式內 iframe 開啟 · Cloudflare 擋代理時改直連仍留在站內 · 不轉點 · 無懸浮"
                : activePlatform === "SA"
                  ? `SA · 開桌 · ${tables.length} 桌｜同步 ${saTables.filter(isSaOpenTable).length} · 顯示 D01/C01`
                  : `${platformDisplayName(activePlatform)} · 歷史牌局 · 即時更新 · 荷官同步`}
            </Text>
          </View>
          <View
            style={[
              s.cardsGrid,
              desktop && s.cardsGridDesktop,
              desktop && s.cardsGridDesktopCentered,
              !desktop && activePlatform === "MV" && s.cardsGridDbMobile,
            ]}
          >
            {tables.length === 0 && activePlatform === "SA" ? (
              <View style={s.vendorEmptyState}>
                <MaterialIcons name="sports-esports" size={22} color="#58B8ED" />
                <Text style={s.vendorEmptyTitle}>
                  {saConnected ? "目前沒有 SA 開桌" : "SA 連線中"}
                </Text>
                <Text style={s.vendorEmptyText}>
                  {saConnected
                    ? "已連線，只顯示大廳實際開桌（TableMode 開／GameStart／牌路）。關桌與空佔位不會列出。"
                    : "正在經 TZ／SALI 授權連線。連上後只顯示開桌，不會預先塞入空桌。"}
                </Text>
              </View>
            ) : null}
            {activePlatform === "MV"
              ? tables.map((t) => (
                  <View
                    key={t.apiId}
                    style={
                      desktop ? s.liveCardWrapDesktop : s.liveCardWrapMobile
                    }
                  >
                    <MemoLiveStreamCard
                      table={t}
                      desktop={desktop}
                      busy={enterBlocked}
                      onEnter={(table) => void openCurrentPlatform(table)}
                    />
                  </View>
                ))
              : tables.map((t) => (
                  <View
                    key={t.apiId}
                    style={
                      desktop
                        ? activePlatform === "SA"
                          ? s.cardWrapVendorDesktop
                          : s.cardWrapDesktop
                        : s.cardWrap
                    }
                  >
                    <View
                      style={
                        desktop && activePlatform === "SA"
                          ? s.vendorCardScaleDesktop
                          : undefined
                      }
                    >
                      <MemoTableCard
                        table={t}
                        desktop={desktop}
                        onAction={stableTableAction}
                        connected={activeConnected}
                        platform={activePlatform}
                        scaled={desktop && activePlatform === "SA"}
                      />
                    </View>
                  </View>
                ))}
          </View>
        </ScrollView>

        {toast ? (
          <View style={s.toast}>
            <Text style={s.toastText}>{toast}</Text>
          </View>
        ) : null}

        <Modal
          visible={walletTransferOpen}
          transparent
          animationType="fade"
          onRequestClose={() =>
            !walletTransferBusy && setWalletTransferOpen(false)
          }
        >
          <View style={s.modalShade}>
            <View style={s.smallModal}>
              <View style={s.modalHead}>
                <Text style={s.modalTitle}>一鍵轉回主錢包</Text>
                <Pressable
                  disabled={walletTransferBusy}
                  onPress={() => setWalletTransferOpen(false)}
                >
                  <MaterialIcons name="close" size={22} color="#fff" />
                </Pressable>
              </View>
              <Text style={s.helpText}>
                將目前所有遊戲錢包可轉回點數全部收回主錢包。
              </Text>
              <View style={[s.modalActions, { marginTop: 14 }]}>
                <Pressable
                  disabled={walletTransferBusy}
                  style={[
                    s.actionBtn,
                    {
                      backgroundColor: "#344553",
                      opacity: walletTransferBusy ? 0.55 : 1,
                    },
                  ]}
                  onPress={() => setWalletTransferOpen(false)}
                >
                  <Text style={s.btnText}>取消</Text>
                </Pressable>
                <Pressable
                  disabled={walletTransferBusy}
                  style={[
                    s.actionBtn,
                    {
                      backgroundColor: "#8B6828",
                      opacity: walletTransferBusy ? 0.68 : 1,
                    },
                  ]}
                  onPress={() => void executeTransferAll()}
                >
                  <Text style={s.btnText}>
                    {walletTransferBusy ? "轉回中..." : "確認轉回"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <Modal
          visible={stopLossOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setStopLossOpen(false)}
        >
          <View style={s.stopLossShade}>
            <View style={s.stopLossModal}>
              <View style={s.stopLossHead}>
                <View style={s.stopLossTitleWrap}>
                  <MaterialIcons
                    name="health-and-safety"
                    size={16}
                    color="#7DD7FF"
                  />
                  <Text style={s.stopLossTitle}>止損設定</Text>
                </View>
                <Pressable
                  style={s.stopLossClose}
                  onPress={() => setStopLossOpen(false)}
                >
                  <MaterialIcons name="close" size={18} color="#DDE8F0" />
                </Pressable>
              </View>
              <View style={s.stopLossRow}>
                <Text style={s.stopLossLabel}>目前餘額</Text>
                <Text style={s.stopLossBalance}>
                  {currentBalance === null
                    ? "—"
                    : currentBalance.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                </Text>
              </View>
              <View style={s.stopLossPrincipalRow}>
                <Text style={s.stopLossLabel}>本金</Text>
                <TextInput
                  value={stopLossPrincipal}
                  onChangeText={setStopLossPrincipal}
                  keyboardType="decimal-pad"
                  placeholder="輸入本金"
                  placeholderTextColor="#6D8292"
                  style={s.stopLossInput}
                />
              </View>
              <Pressable
                style={({ pressed }: any) => [
                  s.useBalanceBtn,
                  pressed && s.stopLossMiniBtnPressed,
                ]}
                onPress={useCurrentBalanceAsPrincipal}
              >
                <Text style={s.useBalanceBtnText}>使用目前餘額</Text>
              </Pressable>
              <View style={s.stopLossPercentRow}>
                <Text style={s.stopLossLabel}>止損比例</Text>
                <View style={s.stopLossStepper}>
                  <Pressable
                    style={s.stepBtn}
                    onPress={() =>
                      setStopLossPercent((v) => Math.max(5, v - 5))
                    }
                  >
                    <Text style={s.stepBtnText}>−</Text>
                  </Pressable>
                  <Text style={s.stopLossPercent}>{stopLossPercent}%</Text>
                  <Pressable
                    style={s.stepBtn}
                    onPress={() =>
                      setStopLossPercent((v) => Math.min(90, v + 5))
                    }
                  >
                    <Text style={s.stepBtnText}>＋</Text>
                  </Pressable>
                </View>
              </View>
              <View style={s.stopLossThresholdRow}>
                <Text style={s.stopLossLabel}>警戒線</Text>
                <Text style={s.stopLossThreshold}>
                  {stopLossThreshold > 0
                    ? stopLossThreshold.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })
                    : "—"}
                </Text>
              </View>
              <Pressable
                style={({ pressed }: any) => [
                  s.stopLossEnableBtn,
                  pressed && { opacity: 0.78 },
                ]}
                onPress={enableStopLoss}
              >
                <Text style={s.stopLossEnableText}>
                  {stopLossEnabled ? "更新提醒" : "開啟提醒"}
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal
          visible={stopLossAlertOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setStopLossAlertOpen(false)}
        >
          <View style={s.stopLossShade}>
            <View style={s.stopLossAlertModal}>
              <View style={s.stopLossAlertIcon}>
                <MaterialIcons name="warning-amber" size={24} color="#FFCB66" />
              </View>
              <Text style={s.stopLossAlertTitle}>止損提醒</Text>
              <Text style={s.stopLossAlertText}>已達設定的止損警戒線</Text>
              <Text style={s.stopLossAlertSub}>建議適度休息，理性遊戲。</Text>
              <Pressable
                style={s.stopLossAckBtn}
                onPress={() => setStopLossAlertOpen(false)}
              >
                <Text style={s.stopLossAckText}>我知道了</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal
          visible={connectionOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setConnectionOpen(false)}
        >
          <View style={s.modalShade}>
            <View style={s.connectionModal}>
              <View style={s.modalHead}>
                <Text style={s.modalTitle}>牌路連線中心</Text>
                <Pressable onPress={() => setConnectionOpen(false)}>
                  <MaterialIcons name="close" size={22} color="#DDE8F0" />
                </Pressable>
              </View>
              <Text style={s.modalNote}>
                MT、DG、SA 進入牌路主頁後會自動連線並顯示即時牌路與懸浮輔助。SA／DG／美女直播進入時皆在站內 iframe 遊玩（代理失敗則直連授權網址，仍不開新分頁）。美女直播不轉點、無懸浮輔助。重新連線會同時重連 MT／DG／SA，並刷新美女直播主播目錄。
              </Text>
              <View style={s.connectionStatusRow}>
                <View style={s.connectionStatusCard}>
                  <Text style={s.fieldLabel}>MT</Text>
                  <Text
                    style={[
                      s.connectionStatusText,
                      { color: connected ? "#4BD693" : "#FFB54D" },
                    ]}
                  >
                    {connected ? "已連線" : "連線中"}
                  </Text>
                </View>
                <View style={s.connectionStatusCard}>
                  <Text style={s.fieldLabel}>DG</Text>
                  <Text
                    style={[
                      s.connectionStatusText,
                      {
                        color:
                          dgConnected || dgTables.length > 0
                            ? "#4BD693"
                            : "#FFB54D",
                      },
                    ]}
                  >
                    {dgConnected || dgTables.length > 0 ? "已連線" : "連線中"}
                  </Text>
                </View>
                <View style={s.connectionStatusCard}>
                  <Text style={s.fieldLabel}>SA</Text>
                  <Text
                    style={[
                      s.connectionStatusText,
                      {
                        color:
                          saConnected || saTables.length > 0
                            ? "#4BD693"
                            : "#FFB54D",
                      },
                    ]}
                  >
                    {saConnected || saTables.length > 0
                      ? "已連線"
                      : saStatus || "連線中"}
                  </Text>
                </View>
                <View style={s.connectionStatusCard}>
                  <Text style={s.fieldLabel}>美女直播</Text>
                  <Text
                    style={[
                      s.connectionStatusText,
                      {
                        color:
                          mvLiveRooms.length > 0 ? "#4BD693" : "#FFB54D",
                      },
                    ]}
                  >
                    {mvLiveRooms.length > 0
                      ? `目錄 ${mvLiveRooms.length}`
                      : "載入中"}
                  </Text>
                </View>
              </View>
              <Text style={s.fieldLabel}>MT 即時牌路 WebSocket（固定）</Text>
              <TextInput
                value={readonlyConnectionUrl(wsUrl)}
                editable={false}
                selectTextOnFocus
                style={s.modalInput}
              />
              <Text style={s.fieldLabel}>MT 牌路授權網址（唯讀）</Text>
              <TextInput
                value={readonlyConnectionUrl(mtUrl)}
                editable={false}
                selectTextOnFocus
                style={s.modalInput}
              />
              <Text style={s.fieldLabel}>DG 牌路授權網址（唯讀）</Text>
              <TextInput
                value={readonlyConnectionUrl(dgGameUrl)}
                editable={false}
                selectTextOnFocus
                style={s.modalInput}
              />
              <Text style={s.fieldLabel}>SA 牌路授權網址（唯讀）</Text>
              <TextInput
                value={readonlyConnectionUrl(saGameUrl)}
                editable={false}
                selectTextOnFocus
                style={s.modalInput}
              />
              <Text style={s.fieldLabel}>最新連線紀錄</Text>
              <View style={s.logBox}>
                <Text style={s.logText}>
                  {events.length ? events.slice(-8).reverse().join("\n") : "尚無連線紀錄"}
                </Text>
              </View>
              <View style={s.modalActions}>
                <Pressable
                  style={[s.actionBtn, { backgroundColor: "#2E7CEB" }]}
                  onPress={() => void connectRoadDashboard(true)}
                >
                  <MaterialIcons name="sync" size={15} color="#fff" />
                  <Text style={s.btnText}>重新連線</Text>
                </Pressable>
                <Pressable
                  style={[s.actionBtn, { backgroundColor: "#344553" }]}
                  onPress={() => setConnectionOpen(false)}
                >
                  <Text style={s.btnText}>完成</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
        <Modal
          visible={helpOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setHelpOpen(false)}
        >
          <View style={s.modalShade}>
            <View style={s.smallModal}>
              <View style={s.modalHead}>
                <Text style={s.modalTitle}>說明</Text>
                <Pressable onPress={() => setHelpOpen(false)}>
                  <MaterialIcons name="close" size={22} color="#fff" />
                </Pressable>
              </View>
              <Text style={s.helpText}>
                主頁只顯示 MT 目前提供的真人桌並即時更新。MT 懸浮輔助可左右滑動
                3 頁：即時輔助、資金策略、輸贏統計。
              </Text>
            </View>
          </View>
        </Modal>
        <Modal
          visible={!!radarDetailTable}
          transparent
          animationType="fade"
          onRequestClose={() => setRadarDetailId(null)}
        >
          <View style={s.modalShade}>
            <View style={s.radarDetailModal}>
              <View style={s.modalHead}>
                <View>
                  <Text style={s.radarKicker}>
                    MT MATRIX · LIVE ROAD SNAPSHOT
                  </Text>
                  <Text style={s.radarDetailTitle}>
                    {radarDetailId} · 第 {radarDetailTable?.round ?? 0} 局
                  </Text>
                </View>
                <Pressable
                  onPress={() => setRadarDetailId(null)}
                  style={s.radarClose}
                >
                  <MaterialIcons name="close" size={20} color="#DCEEFF" />
                </Pressable>
              </View>
              {radarDetailTable ? (
                <>
                  <View style={s.radarDetailStats}>
                    <View style={s.radarDetailStat}>
                      <Text style={s.radarDetailLabel}>目前推薦</Text>
                      <Text
                        style={[
                          s.radarDetailValue,
                          { color: resultColor(radarDetailDecision.side) },
                        ]}
                      >
                        {radarDetailDecision.side}
                      </Text>
                    </View>
                    <View style={s.radarDetailStat}>
                      <Text style={s.radarDetailLabel}>信心度</Text>
                      <View style={s.radarDetailConfidence}>
                        <View
                          style={[
                            s.signalDot,
                            {
                              backgroundColor: confidenceState(
                                radarDetailConfidence,
                              ).color,
                              shadowColor: confidenceState(
                                radarDetailConfidence,
                              ).color,
                            },
                          ]}
                        />
                        <Text
                          style={[
                            s.radarDetailValue,
                            {
                              color: confidenceState(radarDetailConfidence)
                                .color,
                              marginTop: 0,
                            },
                          ]}
                        >
                          {confidenceState(radarDetailConfidence).label}
                        </Text>
                      </View>
                    </View>
                    <View style={s.radarDetailStat}>
                      <Text style={s.radarDetailLabel}>目前牌型</Text>
                      <Text numberOfLines={1} style={s.radarDetailValue}>
                        {detectPattern(radarDetailTable.results)}
                      </Text>
                    </View>
                    <View style={s.radarDetailStat}>
                      <Text style={s.radarDetailLabel}>莊／閒／和</Text>
                      <Text style={s.radarDetailValue}>
                        {radarDetailTable.banker}／{radarDetailTable.player}／
                        {radarDetailTable.tie}
                      </Text>
                    </View>
                  </View>
                  <View
                    style={[s.radarRoadWrap, { height: desktop ? 190 : 150 }]}
                  >
                    <RoadGrid
                      table={radarDetailTable}
                      desktop={desktop}
                      transparent
                    />
                  </View>
                  <Text style={s.radarDetailNote}>
                    {analysisText(radarDetailTable)}
                  </Text>
                </>
              ) : null}
            </View>
          </View>
        </Modal>

        <Modal
          visible={!!analysisTable}
          transparent
          animationType="fade"
          onRequestClose={() => setAnalysisTable(null)}
        >
          <View style={s.modalShade}>
            <View style={s.smallModal}>
              <View style={s.modalHead}>
                <Text style={s.modalTitle}>
                  百家樂 {analysisTable?.id} 分析
                </Text>
                <Pressable onPress={() => setAnalysisTable(null)}>
                  <MaterialIcons name="close" size={22} color="#fff" />
                </Pressable>
              </View>
              <Text style={s.helpText}>
                {analysisText(analysisTable ?? undefined)}
              </Text>
            </View>
          </View>
        </Modal>
        {mtOpen ? (
          <View style={[s.mtOverlay, { pointerEvents: "box-none" } as any]}>
            <View style={[s.mtScreen, { pointerEvents: "box-none" } as any]}>
              <View style={[s.mtTop, gameViewPlatform === "DG" && s.topbarDg]}>
                <View style={s.brandRow}>
                  <View
                    style={[
                      s.brandIcon,
                      gameViewPlatform === "DG" && s.brandIconDg,
                    ]}
                  >
                    <MatrixMark size={29} brand={gameViewPlatform} />
                  </View>
                  <View style={{ minWidth: 0, flexShrink: 1 }}>
                    {desktop ? (
                      <Text
                        style={[
                          s.kicker,
                          gameViewPlatform === "DG" && s.kickerDg,
                        ]}
                      >
                        LIVE TABLE ANALYTICS
                      </Text>
                    ) : null}
                    <View style={s.brandTitleRow}>
                      <Text
                        numberOfLines={1}
                        style={[s.title, !desktop && s.titleMobile]}
                      >
                        {platformDisplayName(gameViewPlatform)} MATRIX
                      </Text>
                      {desktop ? <ThreadsSignature /> : null}
                    </View>
                  </View>
                </View>
                <View style={[s.headerActions, !desktop && s.headerActionsMobile]}>
                  <Pressable
                    style={[s.lineBtn, !desktop && s.lineBtnMobile]}
                    onPress={openLineContact}
                  >
                    <View style={[s.lineLogo, !desktop && s.lineLogoMobile]}>
                      <Text style={s.lineLogoText}>LINE</Text>
                    </View>
                    {desktop ? <Text style={s.lineText}>LINE</Text> : null}
                  </Pressable>
                  <Pressable
                    style={[s.headerBtn, !desktop && s.headerBtnMobile]}
                    onPress={() => setHelpOpen(true)}
                  >
                    <MaterialIcons name="help-outline" size={desktop ? 16 : 14} color="#fff" />
                    <Text style={[s.headerBtnText, !desktop && s.headerBtnTextMobile]}>說明</Text>
                  </Pressable>
                  <Pressable
                    style={[s.headerBtn, !desktop && s.headerBtnMobile]}
                    onPress={closeGameView}
                  >
                    <MaterialIcons name="arrow-back" size={desktop ? 16 : 14} color="#fff" />
                    <Text style={[s.headerBtnText, !desktop && s.headerBtnTextMobile]}>
                      {gameViewPlatform === "MV" ? "返回" : "回牌路"}
                    </Text>
                  </Pressable>
                </View>
              </View>
              <View style={[s.iframeWrap, { pointerEvents: "auto" } as any]}>
                {Platform.OS === "web" && gameViewUrl ? (
                  <StableGameIframe
                    src={gameViewUrl}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      border: "0",
                      background: "#000",
                      pointerEvents: "auto",
                      zIndex: 1,
                    }}
                    allow="clipboard-read; clipboard-write; fullscreen"
                  />
                ) : (
                  <View style={s.nativeMtFallback}>
                    <Text style={s.helpText}>
                      目前原生模式請使用外部瀏覽器開啟目前平台。
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        ) : null}
        <View
          pointerEvents="box-none"
          style={[StyleSheet.absoluteFillObject, { zIndex: 10000 }]}
        >
        {activePlatform === "MV" || gameViewPlatform === "MV" ? null : (
          <>
            {MultiTableRadar({ insideMt: mtOpen })}
            {FloatingAssistant({ insideMt: mtOpen })}
            {V38Calculator({ insideMt: mtOpen })}
            {TerminalParityModel({ insideMt: mtOpen })}
            <FloatingOrb
              position={orbPosition}
              responder={orbResponder}
              size={orbSize}
              iconSize={orbIconSize}
              connected={activeConnected}
              insideMt={mtOpen}
              platform={activePlatform}
            />
          </>
        )}
        </View>
      </View>
    </ScreenContainer>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#060D15" },
  screenDg: { backgroundColor: "#090806" },
  screenAb: { backgroundColor: "#080B16" },
  screenDb: { backgroundColor: "#071210" },
  screenDesktopZoom: {
    zoom: 1.18,
    width: "84.7458%",
    height: "84.7458%",
    marginLeft: "auto",
    marginRight: "auto",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    flexShrink: 1,
    flexWrap: "nowrap",
  },
  headerActionsMobile: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1, minWidth: 0 },
  topbar: {
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "nowrap",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#31536B",
    backgroundColor: "#07111C",
  },
  topbarDg: { backgroundColor: "#110E08", borderBottomColor: "#8B6B2E" },
  topbarAb: { backgroundColor: "#0B1224", borderBottomColor: "#4A5BA8" },
  topbarDb: { backgroundColor: "#0A1816", borderBottomColor: "#2F8A72" },
  topbarMobile: { minHeight: 52, paddingHorizontal: 8, gap: 6, flexWrap: "wrap" },
  brandMobileStack: { alignItems: "flex-start" },
  brandIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#315D79",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#071521",
  },
  brandIconDg: { backgroundColor: "#171208", borderColor: "#9B7833" },
  brandIconAb: { backgroundColor: "#12182C", borderColor: "#6B7BE8" },
  brandIconDb: { backgroundColor: "#0E1C18", borderColor: "#C9A24A" },
  brandTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  kicker: { color: "#7890A3", fontSize: 8, letterSpacing: 1.1 },
  kickerDg: { color: "#C6A35A" },
  kickerAb: { color: "#9BB0FF" },
  kickerDb: { color: "#7EE0D2" },
  title: { color: "#F2F6F9", fontSize: 16, fontWeight: "800" },
  titleMobile: { fontSize: 13 },
  lineBtn: {
    height: 34,
    paddingHorizontal: 9,
    borderRadius: 7,
    backgroundColor: "#0C9B43",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
  },
  lineBtnMobile: { height: 30, paddingHorizontal: 6 },
  lineLogo: {
    width: 23,
    height: 23,
    borderRadius: 11.5,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  lineLogoMobile: { width: 20, height: 20, borderRadius: 10 },
  lineLogoText: { fontSize: 5.5, fontWeight: "900", color: "#0C9B43" },
  lineText: { color: "#fff", fontSize: 10, fontWeight: "900" },
  headerBtn: {
    height: 34,
    paddingHorizontal: 9,
    borderRadius: 7,
    backgroundColor: "#102A3D",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "#3D6682",
    flexShrink: 0,
  },
  headerBtnMobile: { height: 30, paddingHorizontal: 6, gap: 3 },
  headerBtnMuted: { opacity: 0.55 },
  headerBtnText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  headerBtnTextMobile: { fontSize: 9 },
  headerBtnTextMuted: { color: "#8A9AA6" },
  content: { padding: 10, paddingBottom: 90 },
  overview: {
    borderWidth: 1,
    borderColor: "#315B76",
    borderRadius: 8,
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    backgroundColor: "#0B1A28",
    overflow: "hidden",
  },
  overviewDg: { backgroundColor: "#151109", borderColor: "#8B6B2E" },
  overviewAb: { backgroundColor: "#10182C", borderColor: "#4A5BA8" },
  overviewDb: { backgroundColor: "#0C1C1A", borderColor: "#2F8A72" },
  overviewMobile: { flexDirection: "column", alignItems: "stretch", gap: 10 },
  overviewTextMobile: { width: "100%" },
  overKicker: { color: "#62B6E8", fontSize: 7, letterSpacing: 1.4 },
  overKickerDg: { color: "#D1AE61" },
  overKickerAb: { color: "#8BA4FF" },
  overKickerDb: { color: "#7EE0D2" },
  overTitle: {
    color: "#F4FAFF",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 2,
  },
  overTitleRowMobile: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 2,
  },
  overSub: { color: "#7894A8", fontSize: 9, marginTop: 3 },
  overLaunchCol: { alignItems: "stretch", gap: 8 },
  overLaunchColMobile: { width: "100%" },
  enterPlatformBtn: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  enterPlatformBtnMt: {
    backgroundColor: "#0C2436",
    borderColor: "#55B4E9",
  },
  enterPlatformBtnDg: {
    backgroundColor: "#171208",
    borderColor: "#D3AD5C",
  },
  enterPlatformBtnAb: {
    backgroundColor: "#0A1A30",
    borderColor: "#4A8FD4",
  },
  enterPlatformBtnDb: {
    backgroundColor: "#0A1F22",
    borderColor: "#3CB8A8",
  },
  enterPlatformBtnMobile: { height: 36 },
  enterPlatformBtnBusy: { opacity: 0.65 },
  enterPlatformBtnText: { fontSize: 11, fontWeight: "900", letterSpacing: 0.4 },
  enterPlatformBtnTextMt: { color: "#D7F2FF" },
  enterPlatformBtnTextDg: { color: "#FFF2C9" },
  enterPlatformBtnTextAb: { color: "#D7EBFF" },
  enterPlatformBtnTextDb: { color: "#D4F6F0" },
  enterPlatformBtnTextMobile: { fontSize: 12 },
  overStats: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  overStatsMobile: { width: "100%", gap: 6 },
  overStat: {
    minWidth: 112,
    borderWidth: 1,
    borderColor: "#31536B",
    borderRadius: 6,
    padding: 9,
    backgroundColor: "#091722",
  },
  overStatCompact: { minWidth: 96, paddingVertical: 8, paddingHorizontal: 9 },
  overStatMeta: { color: "#7F96A8", fontSize: 8, fontWeight: "700", marginTop: 3 },
  overStatDg: { borderColor: "#745925", backgroundColor: "#100D08" },
  overStatAb: { borderColor: "#3D4A7A", backgroundColor: "#0C1222" },
  overStatDb: { borderColor: "#2A6B58", backgroundColor: "#0A1614" },
  overStatMobile: { flex: 1, minWidth: 0, padding: 8 },
  overValue: { color: "#fff", fontSize: 13, fontWeight: "900", marginTop: 4 },
  platformSwitch: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 4,
    marginTop: 0,
    padding: 3,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,.26)",
    borderWidth: 1,
    borderColor: "rgba(130,151,166,.22)",
    zIndex: 5,
    position: "relative" as any,
  },
  platformSwitchRow: { flexDirection: "row", gap: 4 },
  platformTab: {
    width: 72,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    // Keep inactive tabs readable on SA/DG dark panels (avoid "missing" look).
    borderWidth: 1,
    borderColor: "rgba(180,198,214,.28)",
    backgroundColor: "rgba(18,28,40,.55)",
  },
  platformTabMtActive: {
    backgroundColor: "#176FA7",
    borderWidth: 1,
    borderColor: "#55B4E9",
  },
  platformTabDgActive: {
    backgroundColor: "#6F5420",
    borderWidth: 1,
    borderColor: "#D3AD5C",
  },
  platformTabAbActive: {
    backgroundColor: "#3D4F9A",
    borderWidth: 1,
    borderColor: "#8B9CFF",
  },
  platformTabDbActive: {
    backgroundColor: "#1A6B5C",
    borderWidth: 1,
    borderColor: "#3CB8A8",
  },
  platformTabText: {
    color: "#D7E2EA",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  platformTabTextActive: { color: "#EAF8FF" },
  platformTabTextDgActive: { color: "#FFF2C9" },
  platformTabTextAbActive: { color: "#E8ECFF" },
  platformTabTextDbActive: { color: "#D4F6F0" },
  walletReturnBtn: {
    height: 31,
    marginTop: 7,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#9B7530",
    backgroundColor: "#241A0A",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  walletReturnBtnDisabled: {
    borderColor: "#3B4650",
    backgroundColor: "#151A1F",
    opacity: 0.62,
  },
  walletReturnText: { color: "#FFF1C6", fontSize: 10, fontWeight: "900" },
  walletReturnTextDisabled: { color: "#71808B" },
  categorySwitch: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    gap: 4,
    paddingBottom: 9,
  },
  categoryTab: {
    height: 28,
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#304F65",
    backgroundColor: "#0B1925",
    alignItems: "center",
    justifyContent: "center",
  },
  categoryTabActive: { backgroundColor: "#176FA7", borderColor: "#58B8ED" },
  categoryTabAbActive: { backgroundColor: "#3D4F9A", borderColor: "#8B9CFF" },
  categoryTabDbActive: { backgroundColor: "#1A6B5C", borderColor: "#3CB8A8" },
  categoryTabText: { color: "#93A8B7", fontSize: 10, fontWeight: "900" },
  categoryTabTextActive: { color: "#FFFFFF" },
  listHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 7,
  },
  listTitle: { color: "#F2F6F9", fontSize: 15, fontWeight: "900" },
  listHint: { color: "#73899A", fontSize: 8 },
  cardsGrid: { width: "100%", alignSelf: "center" },
  cardsGridDesktop: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  cardsGridDbMobile: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  cardsGridDesktopCentered: { maxWidth: 1280 },
  cardWrap: { width: "100%" },
  cardWrapDesktop: { width: "calc(50% - 5px)" as any, maxWidth: 635 },
  cardWrapVendorDesktop: { width: "calc(33.333% - 7px)" as any, height: 146, overflow: "hidden" },
  cardWrapDbMobile: { width: "calc(50% - 3px)" as any, height: 96, overflow: "hidden" },
  vendorCardScaleDesktop: {
    width: "150%",
    transform: [{ scale: 2 / 3 }],
    transformOrigin: "top left",
  } as any,
  dbCardScaleMobile: {
    width: "200%",
    transform: [{ scale: 0.5 }],
    transformOrigin: "top left",
  } as any,
  vendorEmptyState: {
    width: "100%",
    minHeight: 150,
    borderWidth: 1,
    borderColor: "#304F65",
    borderRadius: 8,
    backgroundColor: "#0B1925",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    gap: 6,
  },
  vendorEmptyTitle: { color: "#EAF8FF", fontSize: 14, fontWeight: "900" },
  vendorEmptyText: { color: "#91A7B8", fontSize: 10, textAlign: "center" },
  liveCardWrapDesktop: {
    width: "calc(33.333% - 7px)" as any,
    minWidth: 210,
  },
  liveCardWrapMobile: {
    width: "calc(50% - 3px)" as any,
  },
  liveCard: {
    backgroundColor: "#0A1614",
    borderWidth: 1,
    borderColor: "#2E8A7A",
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 8,
  },
  liveCardDesktop: { marginBottom: 0 },
  liveCardMedia: {
    // Square covers like score777 232×232; short landscape boxes crop faces.
    aspectRatio: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0E221E",
    position: "relative",
    overflow: "hidden",
  },
  liveCardPhoto: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  liveCardPhotoOff: {
    opacity: 0.55,
  },
  liveCardGlow: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(46,138,122,0.22)",
  },
  liveBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(180,32,48,0.92)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
  },
  liveBadgeOff: {
    backgroundColor: "rgba(40,55,52,0.92)",
  },
  liveBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#fff",
  },
  liveBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  liveCardBody: { paddingHorizontal: 10, paddingVertical: 9, gap: 4 },
  liveCardTitle: { color: "#EAF8FF", fontSize: 14, fontWeight: "800" },
  liveCardMeta: { color: "#7FA79E", fontSize: 10, lineHeight: 14 },
  liveCardCta: {
    marginTop: 4,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#1A6B5C",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
  },
  liveCardCtaOff: {
    backgroundColor: "#1A2A27",
  },
  liveCardCtaText: { color: "#E8FFF9", fontSize: 11, fontWeight: "800" },
  liveCardCtaTextOff: { color: "#9BB8B0" },
  liveCardSoonText: {
    marginTop: 8,
    color: "#9FE8D8",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  tableCard: {
    backgroundColor: "#08111A",
    borderWidth: 1,
    borderColor: "#365B73",
    overflow: "hidden",
    marginBottom: 10,
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 4,
  },
  tableCardDesktop: {},
  tableCardScaled: { marginBottom: 0 },
  tableCardDg: {
    backgroundColor: "#100D08",
    borderColor: "#8C6B2C",
    shadowColor: "#C49B48",
    shadowOpacity: 0.16,
  },
  tableCardAb: {
    backgroundColor: "#0C1224",
    borderColor: "#5A6BC4",
    shadowColor: "#7B8CFF",
    shadowOpacity: 0.16,
  },
  tableCardDb: {
    backgroundColor: "#0A1614",
    borderColor: "#2E8A7A",
    shadowColor: "#C9A24A",
    shadowOpacity: 0.16,
  },
  tableHead: {
    height: 28,
    paddingHorizontal: 5,
    backgroundColor: "#091621",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#27485E",
  },
  tableHeadDg: { backgroundColor: "#171208", borderBottomColor: "#785B27" },
  tableHeadAb: { backgroundColor: "#121A30", borderBottomColor: "#3D4A7A" },
  tableHeadDb: { backgroundColor: "#0E1C1A", borderBottomColor: "#2A6B58" },
  game: { color: "#EAF6FF", fontSize: 9, fontWeight: "700" },
  tableId: {
    color: "#F8FCFF",
    borderWidth: 1,
    borderColor: "#6E91A8",
    paddingHorizontal: 6,
    paddingVertical: 1,
    fontSize: 9,
    fontWeight: "900",
    backgroundColor: "#0E202E",
  },
  tableIdDg: {
    backgroundColor: "#241B0C",
    borderColor: "#C29A4D",
    color: "#FFF1C5",
  },
  tableIdAb: {
    backgroundColor: "#1A2040",
    borderColor: "#8B9CFF",
    color: "#E8ECFF",
  },
  tableIdDb: {
    backgroundColor: "#142420",
    borderColor: "#C9A24A",
    color: "#F5E6B8",
  },
  headText: { color: "#B9CEDC", fontSize: 8, fontWeight: "800" },
  statText: { fontSize: 8, fontWeight: "900" },
  countWrap: {
    height: 20,
    minWidth: 28,
    borderWidth: 1,
    borderColor: "#8D2030",
    borderRadius: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 3,
  },
  countdown: { color: "#FF5362", fontSize: 8, fontWeight: "900" },
  miniBtn: {
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    borderColor: "#3A6078",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 2,
  },
  miniBtnText: { color: "#fff", fontSize: 7, fontWeight: "900" },
  tableBody: {
    flexDirection: "row",
    height: 176,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  tableBodyDesktop: { height: 190 },
  tableBodyMobile: { height: 164 },
  tableBodyDg: { backgroundColor: "#F7F1E4" },
  tableBodyAb: { backgroundColor: "#EEF2FA" },
  tableBodyDb: { backgroundColor: "#E8F4F0" },
  dealer: {
    width: 112,
    backgroundColor: "#F2F0EC",
    padding: 4,
    justifyContent: "flex-end",
  },
  dealerDesktop: { width: "21.88%" },
  dealerMobile: { width: "21.88%", minWidth: 76 },
  dealerDg: { backgroundColor: "#EDE3CE" },
  dealerAb: { backgroundColor: "#E4E8F4" },
  dealerDb: { backgroundColor: "#D8EBE4" },
  photo: {
    position: "absolute",
    top: 3,
    left: 3,
    right: 3,
    height: 112,
    backgroundColor: "#DCE2E6",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  photoDesktop: { height: "75%" },
  photoMobile: { height: "73%" },
  photoImage: { width: "100%", height: "100%", resizeMode: "cover" },
  liveMediaFill: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  crown: { fontSize: 30, color: "#C5A24C" },
  dealerName: {
    color: "#FFFFFF",
    backgroundColor: "#6F2F82",
    alignSelf: "flex-start",
    paddingHorizontal: 5,
    paddingVertical: 2,
    fontSize: 11,
    fontWeight: "900",
    lineHeight: 14,
  },
  dealerNameDg: { backgroundColor: "#6F5420", color: "#FFF4D2" },
  dealerNameAb: { backgroundColor: "#4A3488", color: "#F0E8FF" },
  dealerNameDb: { backgroundColor: "#1A6B5C", color: "#D4F6F0" },
  meta: {
    color: "#617889",
    fontSize: 8.5,
    fontWeight: "700",
    lineHeight: 11,
    marginTop: 1,
  },
  metaVideoRow: {
    height: 12,
    flexDirection: "row",
    alignItems: "center",
    marginTop: 1,
    overflow: "hidden",
  },
  metaVideoText: { flexShrink: 1, marginTop: 0, lineHeight: 11 },
  videoLabel: {
    color: "#7890A1",
    fontSize: 7.5,
    fontWeight: "800",
    marginLeft: 3,
    marginRight: 2,
    lineHeight: 10,
  },
  videoSwitch: {
    width: 18,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#667B89",
    padding: 1,
    justifyContent: "center",
  },
  videoSwitchOn: { backgroundColor: "#19B96C" },
  videoSwitchKnob: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#fff",
    alignSelf: "flex-start",
  },
  videoSwitchKnobOn: { alignSelf: "flex-end" },
  roadArea: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#fff",
    minWidth: 0,
    overflow: "hidden",
  },
  roadAreaDesktop: {},
  roadAreaDg: { backgroundColor: "#FFF9ED" },
  roadAreaAb: { backgroundColor: "#F4F6FC" },
  roadAreaDb: { backgroundColor: "#F0F8F5" },
  beadPane: {
    width: "32%",
    height: "100%",
    flexShrink: 0,
    borderRightWidth: 1,
    borderColor: "#C9D2D9",
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
  },
  beadPaneDesktop: { width: "32%" },
  beadPaneDg: { backgroundColor: "#FFF9ED", borderColor: "#CDBF9F" },
  beadPaneAb: { backgroundColor: "#F4F6FC", borderColor: "#C5CDE4" },
  beadPaneDb: { backgroundColor: "#F0F8F5", borderColor: "#B8D4CC" },
  beadGrid: {
    width: "100%",
    height: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "stretch",
    backgroundColor: "#FFFFFF",
  },
  beadGridDg: { backgroundColor: "#FFF9ED" },
  beadGridAb: { backgroundColor: "#F4F6FC" },
  beadGridDb: { backgroundColor: "#F0F8F5" },
  beadCell: {
    width: "16.6666667%",
    height: "16.6666667%",
    flexGrow: 0,
    flexShrink: 0,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#D9DEE3",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  beadCellDesktop: {},
  roadCellDg: { backgroundColor: "#FFF9ED", borderColor: "#DDD0B3" },
  roadCellAb: { backgroundColor: "#F4F6FC", borderColor: "#C8D0E4" },
  roadCellDb: { backgroundColor: "#F0F8F5", borderColor: "#B8D4CC" },
  beadDot: {
    width: "72%",
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1,
  },
  beadDotDesktop: { width: "70%" },
  beadDotText: {
    color: "#FFFFFF",
    fontSize: 8,
    fontWeight: "900",
    lineHeight: 10,
    textAlign: "center",
  },
  beadDotTextDesktop: { fontSize: 9, lineHeight: 11 },
  roadStack: { flex: 1, minWidth: 0, height: "100%" },
  bigGrid: {
    width: "100%",
    height: "62%",
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "stretch",
  },
  bigGridDesktop: {},
  bigCell: {
    width: "6.6666667%",
    height: "16.6666667%",
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#DDE4E9",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  bigCellDesktop: {},
  bigMark: {
    width: "72%",
    maxWidth: "78%",
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 1.35,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  bigMarkDesktop: { width: "70%", borderWidth: 1.2 },
  tieNumber: {
    color: "#20B66B",
    fontSize: 7,
    fontWeight: "900",
    lineHeight: 8,
  },
  tieNumberDesktop: { fontSize: 7, lineHeight: 8 },
  lowerArea: {
    width: "100%",
    height: "38%",
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#CCD6DE",
  },
  lowerAreaDesktop: {},
  lowerAreaDg: { borderTopColor: "#CDBF9F", backgroundColor: "#FFF9ED" },
  lowerAreaAb: { borderTopColor: "#C5CDE4", backgroundColor: "#F4F6FC" },
  lowerAreaDb: { borderTopColor: "#B8D4CC", backgroundColor: "#F0F8F5" },
  lowerPane: {
    width: "33.333333%",
    height: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "stretch",
    borderRightWidth: 1,
    borderRightColor: "#DDE4E9",
  },
  lowerPaneDg: { borderRightColor: "#DDD0B3", backgroundColor: "#FFF9ED" },
  lowerPaneAb: { borderRightColor: "#C8D0E4", backgroundColor: "#F4F6FC" },
  lowerPaneDb: { borderRightColor: "#B8D4CC", backgroundColor: "#F0F8F5" },
  lowerCell: {
    width: "10%",
    height: "16.6666667%",
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: "#E4E8EB",
    overflow: "hidden",
  },
  lowerCellDesktop: {},
  lowerHollow: {
    width: "55%",
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 1.4,
    backgroundColor: "transparent",
  },
  lowerSolid: { width: "52%", aspectRatio: 1, borderRadius: 999 },
  lowerSlash: {
    width: "58%",
    height: 2,
    borderRadius: 2,
    transform: [{ rotate: "-45deg" }],
  },
  orb: {
    position: "absolute",
    right: 16,
    bottom: 24,
    zIndex: 10020,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#07131E",
    borderWidth: 2,
    borderColor: "#6CC8FF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 12,
    touchAction: "none" as any,
    userSelect: "none" as any,
    cursor: "grab" as any,
  },
  orbMt: { bottom: 34, zIndex: 10020, elevation: 40 },
  orbStatus: {
    position: "absolute",
    right: 4,
    top: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#fff",
  },
  v38LaunchActive: { backgroundColor: "#0F7AAE" },
  v38InfoBtn: {
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#315F78",
    backgroundColor: "#0C2A3D",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  v38InfoBtnText: { color: "#D9F1FF", fontSize: 8, fontWeight: "900" },
  v38DetailScroll: { height: 194 },
  v38DetailContent: { padding: 7, paddingBottom: 12, gap: 6 },
  v38VectorBox: {
    backgroundColor: "#0A1C29",
    borderWidth: 1,
    borderColor: "#31576D",
    borderRadius: 6,
    padding: 7,
  },
  v38DetailHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  v38SectionCode: {
    color: "#8ED8FF",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  v38LiveDot: { fontSize: 7.5, fontWeight: "900" },
  v38VectorLine: {
    color: "#D7E5ED",
    fontSize: 8.5,
    fontWeight: "700",
    fontFamily: Platform.OS === "web" ? "monospace" : undefined,
    lineHeight: 14,
  },
  v38ModelBox: {
    backgroundColor: "#091722",
    borderWidth: 1,
    borderColor: "#274A60",
    borderRadius: 6,
    padding: 7,
  },
  v38ModelTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 5,
  },
  v38ModelName: {
    color: "#F4FAFF",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  v38ModelTag: { color: "#7599AD", fontSize: 6.8, fontWeight: "900", flex: 1 },
  v38ModelOut: { fontSize: 11, fontWeight: "900" },
  v38Equation: {
    color: "#BCE8FF",
    fontSize: 9,
    fontWeight: "800",
    fontFamily: Platform.OS === "web" ? "monospace" : undefined,
    marginBottom: 4,
  },
  v38Calc: {
    color: "#D5E0E7",
    fontSize: 8,
    fontWeight: "700",
    fontFamily: Platform.OS === "web" ? "monospace" : undefined,
    lineHeight: 13,
  },
  v38Rule: { color: "#7897AA", fontSize: 7, fontWeight: "700", marginTop: 4 },
  terminalPanel: {
    position: "absolute",
    right: 88,
    top: 120,
    width: 300,
    zIndex: 10012,
    backgroundColor: "rgba(5,15,24,.985)",
    borderWidth: 1,
    borderColor: "#3B789C",
    borderRadius: 9,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 32,
  },
  terminalPanelMobile: {
    left: 12,
    right: "auto" as any,
    top: 115,
    width: 300,
    maxWidth: "92%" as any,
  },
  terminalHeader: {
    height: 38,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#082033",
    borderBottomWidth: 1,
    borderBottomColor: "#285B79",
    touchAction: "none" as any,
    userSelect: "none" as any,
    cursor: "grab" as any,
  },
  terminalTitle: {
    color: "#F4FAFF",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.35,
  },
  terminalBody: { padding: 8 },
  terminalLine: {
    minHeight: 26,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#173246",
  },
  terminalLabel: {
    width: 38,
    color: "#7FA1B5",
    fontSize: 8,
    fontWeight: "900",
  },
  terminalCards: {
    flex: 1,
    color: "#F4FAFF",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  terminalValues: {
    flex: 1,
    color: "#B8CBD7",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  terminalCalcBox: {
    marginTop: 6,
    minHeight: 31,
    borderRadius: 5,
    backgroundColor: "#0B1B29",
    borderWidth: 1,
    borderColor: "#24465D",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  terminalCalc: {
    color: "#BCE8FF",
    fontSize: 10,
    fontWeight: "900",
    fontFamily: Platform.OS === "web" ? "monospace" : undefined,
  },
  terminalResultRow: {
    marginTop: 6,
    minHeight: 48,
    borderRadius: 6,
    backgroundColor: "#10283A",
    borderWidth: 1,
    borderColor: "#326884",
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  terminalResultLabel: { color: "#86A5B7", fontSize: 7.5, fontWeight: "900" },
  terminalFinal: {
    color: "#F1F7FA",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 2,
  },
  terminalSideWrap: { alignItems: "flex-end" },
  terminalNext: { color: "#86A5B7", fontSize: 7.5, fontWeight: "900" },
  terminalSide: { fontSize: 20, fontWeight: "900", marginTop: 1 },
  v38Panel: {
    position: "absolute",
    right: 88,
    top: 120,
    width: 360,
    zIndex: 10010,
    backgroundColor: "rgba(5,15,24,.985)",
    borderWidth: 1,
    borderColor: "#3B789C",
    borderRadius: 10,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 30,
  },
  v38PanelMobile: {
    left: 12,
    right: "auto" as any,
    top: 115,
    width: 340,
    maxWidth: "92%" as any,
  },
  v38PanelMt: { zIndex: 10015, elevation: 45 },
  v38Header: {
    height: 42,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#082033",
    borderBottomWidth: 1,
    borderBottomColor: "#285B79",
    touchAction: "none" as any,
    userSelect: "none" as any,
    cursor: "grab" as any,
  },
  v38HeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  v38Title: {
    color: "#F4FAFF",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  v38Sub: { color: "#80A7BD", fontSize: 8, fontWeight: "800", marginTop: 1 },
  v38Body: { padding: 8 },
  v38MetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  v38Meta: { color: "#9DB2C0", fontSize: 9, fontWeight: "800" },
  v38Cards: { flexDirection: "row", gap: 6 },
  v38Hand: {
    flex: 1,
    minHeight: 54,
    backgroundColor: "#0E2232",
    borderWidth: 1,
    borderColor: "#294C63",
    borderRadius: 6,
    padding: 7,
  },
  v38HandSide: { fontSize: 10, fontWeight: "900" },
  v38CardText: {
    color: "#F5FAFD",
    fontSize: 14,
    fontWeight: "900",
    marginTop: 5,
  },
  v38Point: { color: "#C7D7E1", fontSize: 9, fontWeight: "800", marginTop: 3 },
  v38FormulaGrid: { flexDirection: "row", gap: 5, marginTop: 6 },
  v38Formula: {
    flex: 1,
    backgroundColor: "#0B1B29",
    borderWidth: 1,
    borderColor: "#24465D",
    borderRadius: 5,
    paddingVertical: 6,
    alignItems: "center",
  },
  v38FormulaName: { color: "#9EB6C6", fontSize: 8, fontWeight: "900" },
  v38FormulaSide: { fontSize: 13, fontWeight: "900", marginTop: 2 },
  v38Recommend: {
    marginTop: 6,
    minHeight: 50,
    backgroundColor: "#10283A",
    borderWidth: 1,
    borderColor: "#326884",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  v38RecommendLabel: { color: "#E8F4FA", fontSize: 10, fontWeight: "900" },
  v38RecommendHint: {
    color: "#83A2B5",
    fontSize: 7.5,
    fontWeight: "700",
    marginTop: 3,
  },
  v38RecommendSide: { fontSize: 21, fontWeight: "900" },
  floatPanel: {
    position: "absolute",
    right: 74,
    bottom: 22,
    zIndex: 100,
    backgroundColor: "rgba(6,16,25,.975)",
    borderWidth: 1,
    borderColor: "#416C88",
    borderRadius: 9,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 15,
  },
  floatPanelMt: { zIndex: 9999 },
  floatHeader: {
    height: 38,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#081A28",
    borderBottomWidth: 1,
    borderBottomColor: "#234A63",
    touchAction: "none" as any,
    userSelect: "none" as any,
    cursor: "grab" as any,
  },
  floatHeadLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  floatBrandLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  floatTitle: {
    color: "#F5FAFD",
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 0.7,
  },
  floatStatus: { color: "#56D48C", fontSize: 8, fontWeight: "900" },
  iconBtn: {
    width: 27,
    height: 27,
    borderRadius: 5,
    backgroundColor: "#214A70",
    alignItems: "center",
    justifyContent: "center",
  },
  iconTextBtn: {
    height: 27,
    paddingHorizontal: 7,
    borderRadius: 5,
    backgroundColor: "#214A70",
    flexDirection: "row",
    gap: 3,
    alignItems: "center",
  },
  iconText: { color: "#fff", fontSize: 8, fontWeight: "800" },
  selectorWrap: {
    marginHorizontal: 6,
    marginTop: 6,
    position: "relative",
    zIndex: 130,
  },
  selector: {
    height: 38,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: "#31516B",
    borderRadius: 5,
    backgroundColor: "#09151F",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectorLeft: { flexDirection: "row", alignItems: "center", gap: 4 },
  selectorConfidence: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: 4,
  },
  selectorValue: { color: "#F0F5F8", fontSize: 11, fontWeight: "900" },
  selectorMeta: { color: "#B6C5D0", fontSize: 9 },
  roomDropdown: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 42,
    maxHeight: 205,
    backgroundColor: "#0A1722",
    borderWidth: 1,
    borderColor: "#345A76",
    borderRadius: 6,
    zIndex: 160,
    elevation: 30,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 10,
  },
  roomDropdownScroll: { height: 205, maxHeight: 205, overflow: "scroll" },
  roomDropdownContent: { paddingBottom: 2 },
  roomDropdownItem: {
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#183044",
  },
  roomDropdownItemActive: { backgroundColor: "#1B5B88" },
  roomDropdownLeft: { flex: 1, minWidth: 0, paddingRight: 8 },
  roomDropdownText: { color: "#EDF5FA", fontSize: 10, fontWeight: "900" },
  roomDropdownDealer: { color: "#AFC1CD", fontSize: 8, marginTop: 2 },
  roomDropdownMeta: { color: "#8EA7B9", fontSize: 8, fontWeight: "800" },
  roomDropdownRight: {
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 3,
  },
  roomConfidence: { flexDirection: "row", alignItems: "center", gap: 5 },
  roomConfidenceText: { fontSize: 8, fontWeight: "900", textShadowRadius: 7 },
  assistPage: { padding: 6, minHeight: 150 },
  decisionRow: { flexDirection: "row", gap: 5 },
  decisionBox: {
    flex: 1,
    minHeight: 68,
    backgroundColor: "#102335",
    borderWidth: 1,
    borderColor: "#294B64",
    borderRadius: 5,
    padding: 7,
  },
  smallLabel: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  latestLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 7,
  },
  glowDot: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 8,
  },
  latestText: { fontSize: 16, fontWeight: "900" },
  detectText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
    marginTop: 7,
  },
  recommendText: { fontSize: 17, fontWeight: "900", marginTop: 7 },
  microText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 4,
  },
  todayPnlBox: {
    marginTop: 5,
    backgroundColor: "#102335",
    borderWidth: 1,
    borderColor: "#294B64",
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  todayPnlValue: { fontSize: 16, fontWeight: "900" },
  aiBox: {
    marginTop: 5,
    backgroundColor: "#0B1925",
    borderRadius: 5,
    padding: 7,
  },
  aiHead: {
    minHeight: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  aiTitle: { color: "#B7D3E6", fontSize: 11, fontWeight: "900" },
  stopLossMiniBtn: {
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#315D79",
    backgroundColor: "#123149",
    alignItems: "center",
    justifyContent: "center",
  },
  stopLossMiniBtnPressed: { opacity: 0.72 },
  stopLossMiniBtnText: { color: "#D9F2FF", fontSize: 8, fontWeight: "900" },
  aiText: { color: "#C6D2DB", fontSize: 11, lineHeight: 17, marginTop: 5 },
  aiTextMobile: { fontSize: 9.5, lineHeight: 13, marginTop: 3 },
  moneyGrid: { flexDirection: "row", gap: 5 },
  fieldBox: {
    flex: 1,
    backgroundColor: "#102335",
    borderRadius: 5,
    padding: 7,
    minHeight: 58,
  },
  moneyInput: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
    padding: 0,
    marginTop: 5,
  },
  nextAmount: {
    color: "#54D79A",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 6,
  },
  strategyScroll: { marginTop: 6, maxHeight: 30 },
  strategyRow: { gap: 4 },
  strategyChip: {
    height: 25,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: "#172B3B",
    justifyContent: "center",
  },
  strategyChipActive: { backgroundColor: "#2B78B5" },
  strategyChipText: { color: "#AABCC8", fontSize: 7.5, fontWeight: "800" },
  progressBox: {
    marginTop: 6,
    backgroundColor: "#0B1925",
    borderRadius: 5,
    padding: 7,
  },
  progressText: {
    color: "#DDE9F0",
    fontSize: 9,
    fontWeight: "800",
    marginTop: 4,
  },
  recommendHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  martinResetMini: {
    paddingHorizontal: 7,
    height: 20,
    borderRadius: 4,
    backgroundColor: "#214A70",
    alignItems: "center",
    justifyContent: "center",
  },
  martinResetMiniText: { color: "#fff", fontSize: 8, fontWeight: "900" },
  martinResetBtn: {
    marginTop: 7,
    height: 27,
    borderRadius: 4,
    backgroundColor: "#214A70",
    alignItems: "center",
    justifyContent: "center",
  },
  martinResetText: { color: "#fff", fontSize: 9, fontWeight: "900" },
  betButtons: { flexDirection: "row", gap: 5 },
  betBtn: {
    flex: 1,
    height: 38,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  betBtnText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  statsGrid: {
    marginTop: 6,
    backgroundColor: "#102335",
    borderRadius: 5,
    padding: 7,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statsValue: { color: "#fff", fontSize: 11, fontWeight: "900", marginTop: 3 },
  recordBar: {
    marginTop: 5,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  resetText: { color: "#51BDF1", fontSize: 8, fontWeight: "900" },
  historyRow: { gap: 4, marginTop: 5 },
  historyChip: {
    backgroundColor: "#142A3B",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  pageDots: {
    height: 19,
    flexDirection: "row",
    gap: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  pageDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#526574" },
  pageDotActive: { backgroundColor: "#fff" },
  recommendTitleConfidence: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  recommendMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 3,
    marginTop: 3,
  },
  recommendStrategyMeta: { marginTop: 0, flexShrink: 1 },
  confidenceInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  confidenceText: { fontSize: 8, fontWeight: "900", textShadowRadius: 7 },
  radarLauncher: {
    // 進桌後浮層初始（首頁改嵌 overview，見 radarLauncherDocked）
    position: "absolute",
    top: 100,
    right: 14,
    left: "auto" as any,
    zIndex: 40,
    width: 210,
    height: 32,
    paddingHorizontal: 9,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "#315D79",
    backgroundColor: "rgba(7,21,33,.97)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    shadowColor: "#63C7FF",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 18,
    touchAction: "none" as any,
    userSelect: "none" as any,
    cursor: "grab" as any,
  },
  radarLauncherMt: { zIndex: 9998 },
  radarLauncherMobile: { top: 100, right: 8, left: "auto" as any, width: 188 },
  // 圖2 電腦：緊貼連線狀態左側（與 overLaunchCol 同列）
  radarLauncherDocked: {
    height: 32,
    minWidth: 168,
    maxWidth: 260,
    paddingHorizontal: 9,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "#315D79",
    backgroundColor: "rgba(7,21,33,.97)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    shadowColor: "#63C7FF",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
    flexShrink: 0,
    alignSelf: "flex-start",
    marginTop: 0,
  },
  // 圖3 手機：LIVE TABLE MATRIX 標題列右側
  radarLauncherDockedMobile: {
    minWidth: 0,
    maxWidth: 200,
    width: undefined as any,
    flexShrink: 1,
    marginLeft: 8,
    alignSelf: "center",
  },
  radarLauncherText: { color: "#EAF6FF", fontSize: 9, fontWeight: "900" },
  radarLauncherBestWrap: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  radarLauncherBest: { fontSize: 8, fontWeight: "900" },
  radarPanel: {
    position: "absolute",
    top: 66,
    left: 14,
    right: 14,
    zIndex: 90,
    height: 92,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#315D79",
    backgroundColor: "rgba(6,18,29,.985)",
    paddingHorizontal: 8,
    paddingVertical: 6,
    shadowColor: "#63C7FF",
    shadowOpacity: 0.13,
    shadowRadius: 10,
    elevation: 18,
  },
  radarPanelMt: { zIndex: 9998 },
  radarPanelMobile: { top: 61, left: 7, right: 7, height: 144 },
  radarHead: {
    height: 27,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  radarKicker: {
    color: "#62B6E8",
    fontSize: 6.5,
    fontWeight: "900",
    letterSpacing: 1,
  },
  radarTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  radarTitle: { color: "#F4FAFF", fontSize: 11, fontWeight: "900" },
  radarBest: { color: "#63C7FF", fontSize: 8, fontWeight: "900" },
  radarWaiting: { color: "#82929D", fontSize: 8, fontWeight: "800" },
  radarClose: {
    width: 26,
    height: 24,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#315D79",
    backgroundColor: "#0B1A28",
    alignItems: "center",
    justifyContent: "center",
  },
  radarRail: { gap: 5, paddingRight: 4, alignItems: "center" },
  radarRailMobile: { alignItems: "flex-start", paddingBottom: 2 },
  radarMobileColumn: { gap: 5 },
  radarCard: {
    width: 92,
    height: 50,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#31495A",
    backgroundColor: "#0B1924",
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  radarCardMobile: { width: 104, height: 52 },
  radarCardBest: {
    borderColor: "#63C7FF",
    backgroundColor: "#0D2232",
    shadowColor: "#63C7FF",
    shadowOpacity: 0.3,
    shadowRadius: 7,
    elevation: 6,
  },
  radarCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  radarRoom: { color: "#E8EEF2", fontSize: 8, fontWeight: "900" },
  radarPick: {
    color: "#EAF8FF",
    backgroundColor: "#156A95",
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontSize: 5.5,
    fontWeight: "900",
    borderWidth: 1,
    borderColor: "#63C7FF",
  },
  radarCardMain: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 7,
  },
  radarSideLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  radarSide: { fontSize: 12, fontWeight: "900" },
  radarConfidence: { flexDirection: "row", alignItems: "center", gap: 2 },
  radarConfidenceText: { fontSize: 8, fontWeight: "900" },
  radarPattern: {
    color: "#91A6B4",
    fontSize: 6.5,
    fontWeight: "800",
    marginTop: 1,
  },
  signalDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.45)",
    shadowOpacity: 1,
    shadowRadius: 9,
    elevation: 10,
  },
  signalDotSmall: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.50)",
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 9,
  },
  radarDetailModal: {
    width: "96%",
    maxWidth: 900,
    backgroundColor: "#0A1721",
    borderWidth: 1,
    borderColor: "#315D79",
    borderRadius: 10,
    padding: 12,
  },
  radarDetailTitle: {
    color: "#F4FAFF",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 2,
  },
  radarDetailStats: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 8,
    flexWrap: "wrap",
  },
  radarDetailStat: {
    flexGrow: 1,
    minWidth: 90,
    backgroundColor: "#102335",
    borderWidth: 1,
    borderColor: "#294B64",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  radarDetailLabel: { color: "#AFC1CD", fontSize: 7, fontWeight: "800" },
  radarDetailValue: {
    color: "#F3F7F9",
    fontSize: 11,
    fontWeight: "900",
    marginTop: 2,
  },
  radarDetailConfidence: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 2,
  },
  radarRoadWrap: {
    backgroundColor: "#07131D",
    borderRadius: 7,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#315D79",
  },
  radarDetailNote: {
    color: "#C6D2DB",
    fontSize: 9,
    lineHeight: 14,
    marginTop: 8,
  },
  matrixMark: {
    backgroundColor: "#071521",
    borderWidth: 1,
    borderColor: "#4DA8D8",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#57C7FF",
    shadowOpacity: 0.26,
    shadowRadius: 6,
    elevation: 3,
  },
  matrixMarkInner: {
    width: "72%",
    height: "72%",
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(107,205,255,.45)",
    backgroundColor: "rgba(20,72,102,.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  matrixMarkAccent: {
    position: "absolute",
    bottom: "13%",
    width: "46%",
    height: 2,
    borderRadius: 1,
    backgroundColor: "#53D1F5",
    shadowColor: "#53D1F5",
    shadowOpacity: 0.9,
    shadowRadius: 4,
  },
  matrixMarkAccentDg: { backgroundColor: "#D3A64D", shadowColor: "#D3A64D" },
  matrixMarkAccentAb: { backgroundColor: "#8B9CFF", shadowColor: "#8B9CFF" },
  matrixMarkAccentDb: { backgroundColor: "#C9A24A", shadowColor: "#C9A24A" },
  matrixMarkText: {
    color: "#EAF9FF",
    fontWeight: "900",
    letterSpacing: -0.9,
    textShadowColor: "#5FD4FF",
    textShadowRadius: 5,
  },
  matrixMarkTextDg: { color: "#FFE7A5", textShadowColor: "#C99C42" },
  matrixMarkTextAb: { color: "#C8D4FF", textShadowColor: "#6B7BE8" },
  matrixMarkTextDb: { color: "#C9EDE4", textShadowColor: "#2E8A7A" },
  threadsSignature: { flexDirection: "row", alignItems: "center", gap: 4 },
  threadsGlyph: {
    color: "#F2F8FC",
    fontSize: 11,
    fontWeight: "900",
    borderWidth: 1,
    borderColor: "#557487",
    borderRadius: 8,
    width: 16,
    height: 16,
    lineHeight: 14,
    textAlign: "center",
  },
  threadsId: {
    color: "#D9E3EA",
    fontSize: 10.5,
    fontWeight: "900",
    letterSpacing: 0.15,
  },
  threadsSignatureMobile: { marginTop: 1, gap: 3 },
  threadsWord: {
    color: "#F2F8FC",
    fontSize: 8.5,
    fontWeight: "900",
    letterSpacing: 0.15,
  },
  threadsIdMobile: { fontSize: 9.5 },
  floatPanelMobile: {
    left: 18,
    top: 170,
    right: "auto" as any,
    bottom: "auto" as any,
    borderRadius: 9,
  },
  floatHeaderMobile: { height: 28, paddingHorizontal: 6 },
  selectorWrapMobile: { marginHorizontal: 5, marginTop: 4 },
  selectorMobile: { height: 28, paddingHorizontal: 7 },
  assistPageMobile: {
    paddingHorizontal: 5,
    paddingTop: 4,
    paddingBottom: 2,
    minHeight: 96,
  },
  decisionRowMobile: { gap: 4 },
  decisionBoxMobile: {
    minHeight: 46,
    paddingHorizontal: 5,
    paddingVertical: 4,
  },
  todayPnlBoxMobile: { marginTop: 3, paddingHorizontal: 7, paddingVertical: 3 },
  aiBoxMobile: { marginTop: 3, paddingHorizontal: 5, paddingVertical: 4 },
  pageDotsMobile: { height: 12 },
  loginScreen: {
    flex: 1,
    backgroundColor: "#020A12",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    overflow: "hidden",
  },
  loginVideo: { ...StyleSheet.absoluteFillObject },
  loginShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,10,18,.46)",
  },
  loginPanel: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: "rgba(7,31,44,.76)",
    borderWidth: 1,
    borderColor: "rgba(82,151,177,.62)",
    borderRadius: 18,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 14,
  },
  loginTopline: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 26,
  },
  loginTopText: {
    color: "#A9BED0",
    fontSize: 9,
    letterSpacing: 1.8,
    fontWeight: "700",
  },
  loginSafe: { color: "#39E0B0", fontSize: 9, fontWeight: "800" },
  loginHero: {
    flexDirection: "row",
    alignItems: "stretch",
    width: "100%",
    marginBottom: 16,
    minHeight: 112,
  },
  loginHeroMobile: { minHeight: 88 },
  loginBrandMobile: { flex: 1.35, gap: 8, paddingRight: 6, paddingLeft: 0 },
  loginTitleMobile: { fontSize: 18, letterSpacing: -0.4, marginTop: 2 },
  threadsCardMobile: {
    flex: 0.72,
    minWidth: 118,
    marginLeft: 6,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  loginBrand: {
    flex: 1.9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 13,
    paddingLeft: 2,
    paddingRight: 12,
  },
  loginBrandCopy: { flexShrink: 1, minWidth: 0 },
  loginIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#315D79",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(5,20,31,.34)",
    flexShrink: 0,
  },
  loginIconMobile: { width: 40, height: 40, borderRadius: 10 },
  loginKicker: {
    color: "#8DB4CE",
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: "800",
  },
  loginTitle: {
    color: "#F5F8FA",
    fontSize: 28,
    fontWeight: "900",
    marginTop: 5,
  },
  loginSub: { color: "#91A7B8", fontSize: 11.5, marginTop: 4 },
  loginSubMobile: { fontSize: 9.5, letterSpacing: -0.2 },
  loginHeroDivider: {
    width: 1,
    marginVertical: 7,
    backgroundColor: "rgba(111,169,197,.25)",
  },
  threadsCard: {
    flex: 0.9,
    minWidth: 142,
    marginLeft: 13,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "rgba(108,177,205,.40)",
    backgroundColor: "rgba(3,18,29,.32)",
    justifyContent: "center",
  },
  threadsHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  threadsLogo: {
    width: 32,
    height: 32,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "rgba(224,243,255,.52)",
    backgroundColor: "rgba(255,255,255,.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  threadsLogoText: {
    color: "#F5FBFF",
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 26,
  },
  threadsLabel: {
    color: "#A9C4D6",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.35,
  },
  threadsName: {
    color: "#F5F9FC",
    fontSize: 17,
    fontWeight: "900",
    marginTop: 6,
  },
  threadsAccount: {
    color: "#56D7D0",
    fontSize: 14,
    fontWeight: "900",
    marginTop: 1,
  },
  threadsFollow: {
    height: 34,
    marginTop: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(78,192,235,.65)",
    backgroundColor: "rgba(23,128,180,.22)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  threadsFollowPressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  threadsFollowText: {
    color: "#EAF8FF",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.15,
  },
  loginDivider: {
    height: 1,
    backgroundColor: "rgba(109,157,184,.32)",
    marginBottom: 20,
  },
  loginHintRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 11,
    flexWrap: "nowrap",
  },
  loginHint: { color: "#A7B8C5", fontSize: 11, flexShrink: 1, minWidth: 0 },
  registerBtn: {
    height: 28,
    paddingHorizontal: 11,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "rgba(66,185,245,.68)",
    backgroundColor: "rgba(22,140,235,.16)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  registerBtnPressed: { opacity: 0.72 },
  registerBtnText: { color: "#42B9F5", fontSize: 10, fontWeight: "900" },
  kickNotice: {
    color: "#FFB4B9",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 15,
    backgroundColor: "rgba(132,35,45,.22)",
    borderWidth: 1,
    borderColor: "rgba(255,105,115,.35)",
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: -8,
    marginBottom: 14,
  },
  loginLabel: {
    color: "#B9C8D3",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 6,
  },
  loginInput: {
    height: 48,
    backgroundColor: "rgba(2,17,28,.68)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#385B70",
    color: "#fff",
    paddingHorizontal: 14,
    fontSize: 14,
    marginBottom: 14,
  },
  passwordWrap: {
    height: 48,
    backgroundColor: "rgba(2,17,28,.68)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#385B70",
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  passwordInput: {
    flex: 1,
    height: "100%",
    color: "#fff",
    paddingHorizontal: 14,
    fontSize: 14,
  },
  eyeBtn: {
    width: 46,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  loginBtn: {
    height: 50,
    backgroundColor: "#168CEB",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  loginBtnText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  error: { color: "#FF959C", fontSize: 11, textAlign: "center", marginTop: 10 },
  loginFooterRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    flexWrap: "nowrap",
  },
  loginFooterLeft: { flexDirection: "row", alignItems: "center", gap: 4 },
  loginFooterDivider: { color: "rgba(145,171,188,.55)", fontSize: 10 },
  loginFoot: { color: "#71899A", fontSize: 8.5, textAlign: "center" },
  loginHelp: {
    color: "#42B9F5",
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 0,
  },
  modalShade: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  stopLossShade: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,.62)",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    zIndex: 20000,
  },
  stopLossModal: {
    width: "88%",
    maxWidth: 300,
    backgroundColor: "#101E2A",
    borderWidth: 1,
    borderColor: "#315D79",
    borderRadius: 9,
    padding: 11,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 30,
  },
  stopLossHead: {
    height: 25,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 7,
  },
  stopLossTitleWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  stopLossTitle: { color: "#F1F7FB", fontSize: 13, fontWeight: "900" },
  stopLossClose: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  stopLossRow: {
    height: 31,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#20384A",
  },
  stopLossLabel: { color: "#B8C9D4", fontSize: 10, fontWeight: "800" },
  stopLossBalance: { color: "#F3F8FB", fontSize: 13, fontWeight: "900" },
  stopLossPrincipalRow: {
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stopLossInput: {
    flex: 1,
    height: 30,
    borderWidth: 1,
    borderColor: "#36536A",
    borderRadius: 5,
    backgroundColor: "#08131D",
    color: "#fff",
    paddingHorizontal: 8,
    fontSize: 11,
    fontWeight: "800",
  },
  useBalanceBtn: {
    alignSelf: "flex-end",
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: "#173B56",
    borderWidth: 1,
    borderColor: "#315D79",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 5,
  },
  useBalanceBtnText: { color: "#BDE8FF", fontSize: 8, fontWeight: "900" },
  stopLossPercentRow: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#20384A",
  },
  stopLossStepper: { flexDirection: "row", alignItems: "center", gap: 7 },
  stepBtn: {
    width: 25,
    height: 24,
    borderRadius: 4,
    backgroundColor: "#173B56",
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 18,
  },
  stopLossPercent: {
    minWidth: 38,
    textAlign: "center",
    color: "#F5FAFD",
    fontSize: 12,
    fontWeight: "900",
  },
  stopLossThresholdRow: {
    height: 33,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#20384A",
  },
  stopLossThreshold: { color: "#FFCB66", fontSize: 13, fontWeight: "900" },
  stopLossEnableBtn: {
    height: 32,
    borderRadius: 5,
    backgroundColor: "#1E7AB5",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 5,
  },
  stopLossEnableText: { color: "#fff", fontSize: 10, fontWeight: "900" },
  stopLossAlertModal: {
    width: "82%",
    maxWidth: 270,
    backgroundColor: "#101E2A",
    borderWidth: 1,
    borderColor: "#6B5A32",
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 14,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.55,
    shadowRadius: 18,
    elevation: 31,
  },
  stopLossAlertIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,203,102,.10)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 5,
  },
  stopLossAlertTitle: { color: "#FFF3D2", fontSize: 15, fontWeight: "900" },
  stopLossAlertText: {
    color: "#F1F6F9",
    fontSize: 11,
    fontWeight: "900",
    marginTop: 7,
    textAlign: "center",
  },
  stopLossAlertSub: {
    color: "#AFC0CB",
    fontSize: 9.5,
    marginTop: 4,
    textAlign: "center",
  },
  stopLossAckBtn: {
    height: 31,
    minWidth: 108,
    borderRadius: 5,
    backgroundColor: "#1E7AB5",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 11,
    paddingHorizontal: 14,
  },
  stopLossAckText: { color: "#fff", fontSize: 10, fontWeight: "900" },
  connectionModal: {
    width: "100%",
    maxWidth: 760,
    maxHeight: "92%",
    backgroundColor: "#162231",
    borderWidth: 1,
    borderColor: "#31506A",
    borderRadius: 8,
    padding: 18,
  },
  smallModal: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: "#162231",
    borderWidth: 1,
    borderColor: "#31506A",
    borderRadius: 8,
    padding: 18,
  },
  modalHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  modalNote: {
    color: "#BAC7D0",
    fontSize: 10,
    lineHeight: 15,
    backgroundColor: "#0C1721",
    padding: 10,
    borderRadius: 5,
    marginBottom: 12,
  },
  fieldLabel: { color: "#C6D3DC", fontSize: 10, marginBottom: 5, marginTop: 8 },
  modalInput: {
    height: 42,
    borderWidth: 1,
    borderColor: "#36536A",
    borderRadius: 5,
    backgroundColor: "#08131D",
    color: "#fff",
    paddingHorizontal: 10,
  },
  connectionStatusRow: { flexDirection: "row", gap: 8, marginBottom: 4, flexWrap: "wrap" },
  connectionStatusCard: {
    flexGrow: 1,
    flexBasis: "22%",
    minWidth: 140,
    borderWidth: 1,
    borderColor: "#36536A",
    borderRadius: 6,
    backgroundColor: "#08131D",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  connectionStatusText: { fontSize: 13, fontWeight: "900", marginTop: 2 },
  mappingRow: { flexDirection: "row", gap: 6, marginTop: 10, flexWrap: "wrap" },
  mapChip: {
    color: "#C8D4DD",
    fontSize: 9,
    backgroundColor: "#263A4C",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 4,
  },
  modalActions: {
    flexDirection: "row",
    gap: 7,
    marginTop: 12,
    flexWrap: "wrap",
  },
  actionBtn: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  btnText: { color: "#fff", fontWeight: "900", fontSize: 10 },
  syncText: { color: "#AFC0CB", fontSize: 9, marginTop: 11 },
  logBox: {
    height: 130,
    backgroundColor: "#08131D",
    borderRadius: 5,
    padding: 9,
    marginTop: 4,
  },
  logText: { color: "#B8C8D2", fontSize: 8, lineHeight: 13 },
  vendorDiagnosticText: { color: "#91A7B8", fontSize: 8, lineHeight: 12, marginTop: 4 },
  vendorReconnectBtn: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: "#1F5F8A",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  vendorReconnectBtnText: { color: "#F3FAFF", fontSize: 9, fontWeight: "900" },
  helpText: { color: "#D2DDE4", fontSize: 11, lineHeight: 18 },
  mtOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 500,
    backgroundColor: "#05090E",
  },
  mtScreen: { flex: 1, backgroundColor: "#05090E" },
  mtTop: {
    minHeight: 58,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    backgroundColor: "#10202D",
    borderBottomWidth: 1,
    borderBottomColor: "#28465A",
  },
  mtTitle: { color: "#fff", fontSize: 15, fontWeight: "900" },
  iframeWrap: { flex: 1, minHeight: 0, position: "relative", backgroundColor: "#000" },
  externalLaunchPanel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 12,
    backgroundColor: "#071018",
  },
  externalLaunchTitle: {
    color: "#EAF8FF",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  externalLaunchText: {
    color: "#9BB4C6",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 420,
  },
  externalLaunchBtn: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1F6FEB",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  externalLaunchBtnText: {
    color: "#F4FBFF",
    fontSize: 14,
    fontWeight: "800",
  },
  externalLaunchUrl: {
    marginTop: 8,
    color: "#5F7A8D",
    fontSize: 11,
    textAlign: "center",
    maxWidth: 520,
  },
  nativeMtFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  toast: {
    position: "absolute",
    bottom: 78,
    left: 20,
    right: 20,
    backgroundColor: "#203A4E",
    borderRadius: 8,
    padding: 9,
    zIndex: 200,
  },
  toastText: { color: "#fff", textAlign: "center", fontSize: 13, fontWeight: "700" },
});
