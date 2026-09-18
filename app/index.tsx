import { createElement, memo, useEffect, useMemo, useRef, useState } from "react";
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
import { collectConfirmedMtTableIds } from "@/lib/mt-table-membership";
import { platformTodayPnl, type DgDailyPnl } from "@/lib/dg-report";

type Result = RoadResult;
type TableData = {
  id: string; apiId?: string; game: string; name: string; players: string;
  countdown?: number; countdownUpdatedAt?: number; roomId?: string; tableBadge?: string;
  shoe: string; round: number; banker: number; player: number; tie: number;
  results: Result[]; trend: string; live?: boolean; dealerPhoto?: string; streamUrl?: string;
  lastUpdated?: number; lastResultKey?: string; poker?: string;
};

type StrategyName = "平注" | "馬丁" | "達朗貝爾" | "Fibonacci" | "Paroli" | "1-3-2-6" | "Labouchere" | "Oscar's Grind";
type BetSide = "莊" | "閒" | "和";
type BetRecord = { side: BetSide; result: Result; amount: number; pnl: number; at: number };
type PendingBet = { tableId: string; side: BetSide; amount: number; resultKey?: string } | null;

const mtLoadingTableIds = ["BAG01","BAG02","BAG03","BAG03A","BAG05","BAG06","BAG07","BAG08","BAG09","BAG10","BAG11","BAG12","BAG13","BAG13A","BAG15"];
const dealerStreamUrls: Record<string,string> = {
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
function ensureMpegTs(){
  if(Platform.OS!=="web" || typeof window==="undefined" || typeof document==="undefined") return Promise.resolve(null);
  const w=window as any;
  if(w.mpegts) return Promise.resolve(w.mpegts);
  if(mpegTsLoaderPromise) return mpegTsLoaderPromise;
  mpegTsLoaderPromise=new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-mt-mpegts="1"]') as HTMLScriptElement | null;
    if(existing){
      existing.addEventListener("load",()=>resolve((window as any).mpegts),{once:true});
      existing.addEventListener("error",()=>reject(new Error("mpegts load failed")),{once:true});
      return;
    }
    const script=document.createElement("script");
    script.src="https://cdn.jsdelivr.net/npm/mpegts.js@1.8.0/dist/mpegts.min.js";
    script.async=true;
    script.dataset.mtMpegts="1";
    script.onload=()=>resolve((window as any).mpegts);
    script.onerror=()=>reject(new Error("mpegts load failed"));
    document.head.appendChild(script);
  });
  return mpegTsLoaderPromise;
}
// Visual road templates shown only while the first authoritative /tables
// snapshot is loading. They are never used as the live membership whitelist.
const initialTables: TableData[] = mtLoadingTableIds.map((apiId) => ({
  id: apiId, apiId, game: "百家樂", name: "—", players: "—",
  roomId: "—", tableBadge: "—", shoe: "—", round: 0, banker: 0, player: 0, tie: 0,
  results: [], trend: "", live: false,
}));
const dgPlaceholderDefs = [
  ["BAC001","RB01","60101"],["BAC002","RB02","60102"],["BAC003","RB03","60103"],["BAC004","RB04","60104"],["BAC005","RB05","60105"],
  ["TID348","S01","50101"],["TID349","S02","50102"],["TID350","S03","50103"],["TID351","S05","50104"],["TID352","S06","50105"],
  ["TID354","S07","50106"],["TID77842","S09","50107"],["TID77846","S10","50108"],
] as const;
const dgPlaceholderTables: TableData[] = dgPlaceholderDefs.map(([apiId,roomId,tableBadge])=>({
  id:apiId,apiId,game:"百家樂",name:"—",players:"—",roomId,tableBadge,shoe:"—",round:0,banker:0,player:0,tie:0,results:[],trend:"",live:false,
}));
const lineContactUrl = "https://line.me/ti/p/k2pkYGXGL3";
const threadsUrl = "https://www.threads.com/@uss0857?igshid=NTc4MTIwNjQ2YQ==";
const tzRegisterUrl = "https://shy9453.tz6868.cc";
const resultColor = (r?: Result) => r === "莊" ? "#EF4E57" : r === "閒" ? "#2879E5" : r === "和" ? "#20B66B" : "#70889A";
const strategies: StrategyName[] = ["平注","馬丁","達朗貝爾","Fibonacci","Paroli","1-3-2-6","Labouchere","Oscar's Grind"];

function openLineContact() {
  if (typeof window !== "undefined") window.open(lineContactUrl, "_blank", "noopener,noreferrer");
  else Linking.openURL(lineContactUrl).catch(() => undefined);
}
function openThreads() {
  if (typeof window !== "undefined") window.open(threadsUrl, "_blank", "noopener,noreferrer");
  else Linking.openURL(threadsUrl).catch(() => undefined);
}
function openTzRegister() {
  if (typeof window !== "undefined") window.open(tzRegisterUrl, "_blank", "noopener,noreferrer");
  else Linking.openURL(tzRegisterUrl).catch(() => undefined);
}

type PatternInfo = {
  type: "資料累積中" | "一房兩廳" | "單跳" | "雙跳" | "連龍" | "一般連" | "混合";
  label: string; side?: "莊" | "閒"; run?: number;
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

function tailAlternating(runs: { side: "莊" | "閒"; length: number }[], size: number, len: number) {
  if (runs.length < size) return false;
  const x = runs.slice(-size);
  return x.every((r) => r.length === len) && x.every((r, i) => i === 0 || r.side !== x[i - 1].side);
}

function getPatternInfo(results: Result[]): PatternInfo {
  const seq = roadSides(results);
  const runs = columnRuns(results);
  if (seq.length < 3 || !runs.length) return { type: "資料累積中", label: "資料累積中" };
  const lastRun = runs[runs.length - 1];

  // 使用實際大路「柱」判斷，不再只抓 raw results 最後三顆。
  // 使用者規則：連 4 起才叫龍；連 2/3 只叫連。
  if (lastRun.length >= 4) return { type: "連龍", label: `${lastRun.side}龍${lastRun.length}顆`, side: lastRun.side, run: lastRun.length };

  // 單跳：至少最近四柱都是 1 格。
  if (tailAlternating(runs, 4, 1)) return { type: "單跳", label: "單跳", side: lastRun.side };

  // 雙跳：至少最近三柱都是 2 格。
  if (tailAlternating(runs, 3, 2)) return { type: "雙跳", label: "雙跳", side: lastRun.side };

  // 兩閒一莊 / 兩莊一閒：
  // 禁止只看最後 3 柱的 2-1-2 就命名。至少要看到兩次完整重複節奏，
  // 才能確認這是一個持續牌型；否則視為轉型/混合路，再交由下三路與問路確認。
  if (runs.length >= 6) {
    const x = runs.slice(-6);
    const twoPlayerOneBanker =
      x[0].side === "閒" && x[0].length === 2 &&
      x[1].side === "莊" && x[1].length === 1 &&
      x[2].side === "閒" && x[2].length === 2 &&
      x[3].side === "莊" && x[3].length === 1 &&
      x[4].side === "閒" && x[4].length === 2 &&
      x[5].side === "莊" && x[5].length === 1;
    const twoBankerOnePlayer =
      x[0].side === "莊" && x[0].length === 2 &&
      x[1].side === "閒" && x[1].length === 1 &&
      x[2].side === "莊" && x[2].length === 2 &&
      x[3].side === "閒" && x[3].length === 1 &&
      x[4].side === "莊" && x[4].length === 2 &&
      x[5].side === "閒" && x[5].length === 1;
    if (twoPlayerOneBanker) return { type: "一房兩廳", label: "兩閒一莊", side: "閒" };
    if (twoBankerOnePlayer) return { type: "一房兩廳", label: "兩莊一閒", side: "莊" };
  }

  if (lastRun.length >= 2) return { type: "一般連", label: `${lastRun.side}連${lastRun.length}`, side: lastRun.side, run: lastRun.length };
  return { type: "混合", label: "轉型／混合路", side: lastRun.side };
}

function derivedTailPreference(results: Result[], offset: 1 | 2 | 3): "莊" | "閒" | null {
  const marks = buildDerivedRoad(results, offset, offset === 2);
  if (!marks.length) return null;
  const seq = marks.map(m => m.result).filter((r): r is "莊" | "閒" => r === "莊" || r === "閒");
  if (!seq.length) return null;

  // 先看尾段自己的節奏：連則續色；明顯交替則續跳。
  const last = seq[seq.length - 1];
  let run = 1;
  for (let i = seq.length - 2; i >= 0 && seq[i] === last; i--) run++;
  if (run >= 2) return last;
  if (seq.length >= 4) {
    const x = seq.slice(-4);
    if (x[0] !== x[1] && x[1] !== x[2] && x[2] !== x[3]) return last === "莊" ? "閒" : "莊";
  }

  // 無明顯尾型時參考整段較近期的結構，但不把紅藍直接當莊閒。
  const tail = seq.slice(-8);
  let same = 0, change = 0;
  for (let i = 1; i < tail.length; i++) tail[i] === tail[i - 1] ? same++ : change++;
  return change > same ? (last === "莊" ? "閒" : "莊") : last;
}

function roadDecision(results: Result[]) {
  const seq = roadSides(results);
  if (!seq.length) return { side: "莊" as const, scoreBanker: 0, scorePlayer: 0, reason: "等待牌路資料" };

  const info = getPatternInfo(results);
  const ask = buildAskRoad(results);
  const prefs = [
    derivedTailPreference(results, 1),
    derivedTailPreference(results, 2),
    derivedTailPreference(results, 3),
  ];
  const bankerAsk = [ask.banker.bigEye, ask.banker.small, ask.banker.cockroach];
  const playerAsk = [ask.player.bigEye, ask.player.small, ask.player.cockroach];

  let b = 0, p = 0;
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
    if (last === "莊") b += 4; else p += 4;
  } else if (info.type === "單跳") {
    if (last === "莊") p += 4; else b += 4;
  } else if (info.type === "雙跳") {
    if (last === "莊") b += 4; else p += 4;
  } else if (info.type === "一房兩廳" && info.side) {
    if (info.side === "莊") b += 3; else p += 3;
  } else if (info.type === "一般連") {
    if (last === "莊") b += 2; else p += 2;
  }

  // 全路段柱型微量參考，避免只看尾端。
  const recentRuns = runs.slice(-10);
  const bankerDepth = recentRuns.filter(r => r.side === "莊").reduce((s,r)=>s+r.length,0);
  const playerDepth = recentRuns.filter(r => r.side === "閒").reduce((s,r)=>s+r.length,0);
  if (bankerDepth > playerDepth) b += 0.5;
  else if (playerDepth > bankerDepth) p += 0.5;

  // 強制二選一；完全同分時以問路吻合數，再以目前大路轉向決勝。
  const side: "莊" | "閒" = b === p ? (last === "莊" ? "閒" : "莊") : (b > p ? "莊" : "閒");
  const fmt = (x: Result | null) => x === "莊" ? "紅" : x === "閒" ? "藍" : "—";
  return {
    side, scoreBanker: b, scorePlayer: p,
    reason: `${info.label}｜莊問路 ${bankerAsk.map(fmt).join("・")}｜閒問路 ${playerAsk.map(fmt).join("・")}｜三路綜合 ${b.toFixed(1)}:${p.toFixed(1)}`
  };
}

function detectPattern(results: Result[]) { return getPatternInfo(results).label; }

// Convert the existing road score gap into a 0–100 signal-strength percentage.
// This does not change roadDecision(); it only gives the existing decision a display confidence.
function confidencePercent(scoreBanker:number, scorePlayer:number) {
  const gap=Math.abs(scoreBanker-scorePlayer);
  return Math.max(0,Math.min(100,Math.round((gap/6)*100)));
}
function confidenceState(percent:number) {
  if(percent>=80)return {label:"高可信",color:"#43E07A"};
  if(percent>=50)return {label:"中可信",color:"#FFD447"};
  return {label:"低可信",color:"#FF5B63"};
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

  const colorName = (x: Result | null) => x === "莊" ? "紅" : x === "閒" ? "藍" : "—";
  const prefName = (x: "莊" | "閒" | null) => x === "莊" ? "偏紅" : x === "閒" ? "偏藍" : "資料不足";

  const bankerAsk = [ask.banker.bigEye, ask.banker.small, ask.banker.cockroach];
  const playerAsk = [ask.player.bigEye, ask.player.small, ask.player.cockroach];

  return [
    `【大路】${info.label}。`,
    `【大眼仔】${prefName(prefs[0])}；【小路】${prefName(prefs[1])}；【曱甴路】${prefName(prefs[2])}。`,
    `【莊問路】${bankerAsk.map(colorName).join("・")}；【閒問路】${playerAsk.map(colorName).join("・")}。`,
    `【綜合】莊 ${d.scoreBanker.toFixed(1)}／閒 ${d.scorePlayer.toFixed(1)}，整段牌路與三路問路綜合後，我會選${d.side}。`
  ].join("\n");
}

function strategyAmount(name: StrategyName, base: number, level: number, lab: number[]) {
  const b = Math.max(0, base || 0);
  if (name === "馬丁") return b * (Math.pow(2, Math.max(0, level) + 1) - 1);
  if (name === "達朗貝爾") return b * (Math.max(0, level) + 1);
  if (name === "Fibonacci") {
    const fib = [1,1,2,3,5,8,13,21,34,55,89];
    return b * fib[Math.min(level, fib.length - 1)];
  }
  if (name === "Paroli") return b * Math.pow(2, Math.min(Math.max(0, level), 2));
  if (name === "1-3-2-6") return b * [1,3,2,6][Math.min(Math.max(0, level), 3)];
  if (name === "Labouchere") {
    const seq = lab.length ? lab : [1,2,3,4];
    return b * (seq.length === 1 ? seq[0] : seq[0] + seq[seq.length - 1]);
  }
  if (name === "Oscar's Grind") return b * (Math.max(0, level) + 1);
  return b;
}

const ROAD_SPEC = {
  colors: { hollowRed: "#E6352B", hollowBlue: "#4578D4", solidRed: "#EF3215", solidBlue: "#2D64F5", slashRed: "#CC2419", slashBlue: "#2476E2", tie: "#20B66B" }
} as const;

function ResultDot({ result, desktop }: { result: Result; desktop: boolean }) {
  const color = result === "莊" ? ROAD_SPEC.colors.solidRed : result === "閒" ? ROAD_SPEC.colors.solidBlue : ROAD_SPEC.colors.tie;
  return <View style={[s.beadDot, desktop && s.beadDotDesktop, { backgroundColor: color, borderColor: color }]}>
    <Text allowFontScaling={false} style={[s.beadDotText, desktop && s.beadDotTextDesktop]}>{result}</Text>
  </View>;
}

function derivedColor(ri: number, result: Result) {
  const red = result === "莊";
  if (ri === 0) return red ? ROAD_SPEC.colors.hollowRed : ROAD_SPEC.colors.hollowBlue;
  if (ri === 1) return red ? ROAD_SPEC.colors.solidRed : ROAD_SPEC.colors.solidBlue;
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
function RoadGrid({ table, desktop, platform="MT" }: { table: TableData; desktop: boolean; platform?: "MT"|"DG" }) {
  const dg=platform==="DG";
  const beads = useMemo(() => buildSlidingBeadGrid(table.results), [table.results]);
  const big = useMemo(() => buildRoadWindow(buildBigRoad(table.results), 15), [table.results]);
  const lower = useMemo(() => [
    buildRoadWindow(buildDerivedRoad(table.results, 1, false), 10),
    buildRoadWindow(buildDerivedRoad(table.results, 2, true), 10),
    buildRoadWindow(buildDerivedRoad(table.results, 3, false), 10),
  ], [table.results]);
  return <View style={[s.roadArea, desktop && s.roadAreaDesktop,dg&&s.roadAreaDg]}>
    <View style={[s.beadPane, desktop && s.beadPaneDesktop,dg&&s.beadPaneDg]}><View style={[s.beadGrid,dg&&s.beadGridDg]}>{Array.from({length:36},(_,i)=><View key={i} style={[s.beadCell,desktop&&s.beadCellDesktop,dg&&s.roadCellDg]}>{beads[i]?<ResultDot result={beads[i]!} desktop={desktop}/>:null}</View>)}</View></View>
    <View style={s.roadStack}>
      <View style={[s.bigGrid,desktop&&s.bigGridDesktop]}>{Array.from({length:90},(_,i)=>{ const row=Math.floor(i/15),col=i%15,m=big.find(x=>x.row===row&&x.col===col); return <View key={i} style={[s.bigCell,desktop&&s.bigCellDesktop,dg&&s.roadCellDg]}>{m?<View style={[s.bigMark,desktop&&s.bigMarkDesktop,{borderColor:m.result==="莊"?ROAD_SPEC.colors.hollowRed:m.result==="閒"?ROAD_SPEC.colors.hollowBlue:ROAD_SPEC.colors.tie}]}>{m.tieCount?<Text style={[s.tieNumber,desktop&&s.tieNumberDesktop]}>{m.tieCount}</Text>:null}</View>:null}</View> })}</View>
      <View style={[s.lowerArea,desktop&&s.lowerAreaDesktop,dg&&s.lowerAreaDg]}>{lower.map((road,ri)=><View key={ri} style={[s.lowerPane,dg&&s.lowerPaneDg]}>{Array.from({length:60},(_,i)=>{ const row=Math.floor(i/10),col=i%10,m=road.find(x=>x.row===row&&x.col===col); if(!m)return <View key={i} style={[s.lowerCell,desktop&&s.lowerCellDesktop,dg&&s.roadCellDg]}/>; const color=derivedColor(ri,m.result); return <View key={i} style={[s.lowerCell,desktop&&s.lowerCellDesktop,dg&&s.roadCellDg]}>{ri===0?<View style={[s.lowerHollow,{borderColor:color}]}/>:ri===1?<View style={[s.lowerSolid,{backgroundColor:color}]}/>:<View style={[s.lowerSlash,{backgroundColor:color}]}/>}</View> })}</View>)}</View>
    </View>
  </View>;
}

function CountdownBadge({count,updatedAt}:{count?:number;updatedAt?:number}){
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[]);
  const elapsed=updatedAt?Math.floor((now-updatedAt)/1000):0;
  return <View style={s.countWrap}><MaterialIcons name="schedule" size={11} color="#DDE8F0"/><Text style={s.countdown}>{count==null?"—":Math.max(0,count-elapsed)}</Text></View>;
}

function DealerLiveVideo({table,enabled,connected}:{table:TableData;enabled:boolean;connected:boolean}){
  const tableId=table.apiId??`BAG${table.id}`;
  const url=table.streamUrl??dealerStreamUrls[tableId];
  const videoRef=useRef<any>(null);
  const playerRef=useRef<any>(null);
  const retryRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [playing,setPlaying]=useState(false);

  useEffect(()=>{
    if(retryRef.current){clearTimeout(retryRef.current);retryRef.current=null}
    setPlaying(false);
    if(Platform.OS!=="web" || !enabled || !connected || !url) return;
    let disposed=false;
    const destroy=()=>{
      const p=playerRef.current;playerRef.current=null;
      if(p){try{p.pause?.()}catch{};try{p.unload?.()}catch{};try{p.detachMediaElement?.()}catch{};try{p.destroy?.()}catch{}}
    };
    const start=async()=>{
      try{
        const mpegts=await ensureMpegTs();
        if(disposed||!mpegts||!videoRef.current)return;
        if(!mpegts.getFeatureList?.()?.mseLivePlayback)return;
        destroy();
        const video=videoRef.current;
        video.muted=true;video.autoplay=true;video.playsInline=true;
        const player=mpegts.createPlayer({type:"flv",isLive:true,url},{
          enableWorker:true,enableStashBuffer:true,stashInitialSize:384,lazyLoad:false,
          liveBufferLatencyChasing:true,autoCleanupSourceBuffer:true,autoCleanupMaxBackwardDuration:30,autoCleanupMinBackwardDuration:8
        });
        playerRef.current=player;
        player.attachMediaElement(video);
        if(mpegts.Events?.ERROR)player.on(mpegts.Events.ERROR,()=>{
          if(disposed)return;
          setPlaying(false);destroy();
          retryRef.current=setTimeout(start,1800);
        });
        video.onplaying=()=>{if(!disposed)setPlaying(true)};
        video.onstalled=()=>{if(!disposed)setPlaying(false)};
        video.onerror=()=>{if(!disposed){setPlaying(false);destroy();retryRef.current=setTimeout(start,1800)}};
        player.load();
        Promise.resolve(player.play()).catch(()=>undefined);
      }catch{
        if(!disposed)retryRef.current=setTimeout(start,2200);
      }
    };
    start();
    return()=>{disposed=true;if(retryRef.current)clearTimeout(retryRef.current);retryRef.current=null;destroy()};
  },[tableId,url,enabled,connected]);

  return <View style={s.liveMediaFill}>
    {table.dealerPhoto?<Image source={{uri:table.dealerPhoto}} style={s.photoImage}/>:<Text style={s.crown}>♛</Text>}
    {Platform.OS==="web"&&enabled&&connected&&url?createElement("video" as any,{
      ref:(node:any)=>{videoRef.current=node},muted:true,autoPlay:true,playsInline:true,controls:false,
      style:{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",background:"#000",opacity:playing?1:0,pointerEvents:"none"}
    }):null}
  </View>;
}

function TableCard({table,desktop,onAction,connected,platform="MT"}:{table:TableData;desktop:boolean;onAction:(kind:string,table:TableData)=>void;connected:boolean;platform?:"MT"|"DG"}){
  const dg=platform==="DG";
  const tableId=table.apiId??`BAG${table.id}`;
  const [videoEnabled,setVideoEnabled]=useState(()=>{
    if(Platform.OS!=="web"||typeof window==="undefined")return false;
    try{return window.localStorage.getItem(`mt.video.${tableId}`)==="1"}catch{return false}
  });
  const toggleVideo=()=>setVideoEnabled(v=>{
    const next=!v;
    if(Platform.OS==="web"&&typeof window!=="undefined"){try{window.localStorage.setItem(`mt.video.${tableId}`,next?"1":"0")}catch{}}
    return next;
  });
  return <View style={[s.tableCard,desktop&&s.tableCardDesktop,dg&&s.tableCardDg]}>
    <View style={[s.tableHead,dg&&s.tableHeadDg]}>
      <View style={s.row}><Text style={s.game}>百家樂</Text><Text style={[s.tableId,dg&&s.tableIdDg]}>{table.id}</Text><MaterialIcons name="person" size={12} color="#fff"/><Text style={s.headText}>{table.players}</Text><CountdownBadge count={table.countdown} updatedAt={table.countdownUpdatedAt}/></View>
      <View style={s.row}><Text style={[s.statText,{color:"#F35762"}]}>莊 {table.banker}</Text><Text style={[s.statText,{color:"#4D96F3"}]}>閒 {table.player}</Text><Text style={[s.statText,{color:"#45C98A"}]}>和 {table.tie}</Text>
        <Pressable style={[s.miniBtn,{backgroundColor:"#7043C9"}]} onPress={()=>onAction("分析",table)}><Text style={s.miniBtnText}>分析</Text></Pressable>
        <Pressable style={[s.miniBtn,{backgroundColor:"#208C55"}]} onPress={()=>onAction("關注",table)}><Text style={s.miniBtnText}>關注</Text></Pressable>
        <Pressable style={[s.miniBtn,{backgroundColor:dg?"#9A7332":"#1681C7"}]} onPress={()=>onAction("平台",table)}><Text style={s.miniBtnText}>{platform}平台</Text></Pressable>
      </View>
    </View>
    <View style={[s.tableBody,desktop?s.tableBodyDesktop:s.tableBodyMobile,dg&&s.tableBodyDg]}>
      <View style={[s.dealer,desktop?s.dealerDesktop:s.dealerMobile,dg&&s.dealerDg]}>
        <View style={[s.photo,desktop?s.photoDesktop:s.photoMobile]}><DealerLiveVideo table={table} enabled={videoEnabled} connected={connected}/></View>
        <Text style={[s.dealerName,dg&&s.dealerNameDg]}>{table.name||"—"}</Text><Text style={s.meta}>房間 {table.roomId||table.id}</Text>
        <View style={s.metaVideoRow}><Text numberOfLines={1} style={[s.meta,s.metaVideoText]}>Shoe {table.shoe} · 第 {table.round} 把</Text><Text style={s.videoLabel}>視訊</Text><Pressable accessibilityRole="switch" accessibilityState={{checked:videoEnabled}} onPress={toggleVideo} hitSlop={5} style={[s.videoSwitch,videoEnabled&&s.videoSwitchOn]}><View style={[s.videoSwitchKnob,videoEnabled&&s.videoSwitchKnobOn]}/></Pressable></View>
      </View>
      <RoadGrid table={table} desktop={desktop} platform={platform}/>
    </View>
  </View>;
}

// Keep unchanged table cards out of the high-frequency WebSocket render path.
// The connection still receives every packet; only cards whose TableData reference
// actually changed are reconciled again.
function MatrixMark({size=28,brand="MT"}:{size?:number;brand?:"MT"|"DG"}){
  return <View style={[s.matrixMark,{width:size,height:size,borderRadius:Math.max(7,size*.23)}]}>
    <View style={s.matrixMarkInner}>
      <Text style={[s.matrixMarkText,brand==="DG"&&s.matrixMarkTextDg,{fontSize:Math.max(10,size*.34)}]}>{brand}</Text>
      <View style={[s.matrixMarkAccent,brand==="DG"&&s.matrixMarkAccentDg]}/>
    </View>
  </View>
}
function ThreadsSignature({mobile=false}:{mobile?:boolean}){return <View style={[s.threadsSignature,mobile?s.threadsSignatureMobile:null]}><FontAwesome6 name="threads" size={mobile?12:13} color="#F2F8FC"/>{mobile?<Text style={s.threadsWord}>Threads</Text>:null}<Text style={[s.threadsId,mobile?s.threadsIdMobile:null]}>@uss0857</Text></View>}

const MemoTableCard = memo(TableCard);

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
  platform?: "MT"|"DG";
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
      <MatrixMark size={Math.max(30,iconSize*1.35)} brand={platform}/>
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

async function loginToPlatformFromBrowser(platform:"TZ"|"OFA",username:string,password:string,deviceId:string){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  const base=platform==="OFA"?"https://www.ofa1188.net":"https://www.tz6868.cc";
  try{
    const response=await fetch(`${base}/api/v1/login`,{
      method:"POST",mode:"cors",
      headers:{"Content-Type":"application/json","Accept":"application/json, text/plain, */*"},
      body:JSON.stringify({username,password,device_id:deviceId}),signal:controller.signal,
    });
    const text=await response.text(); let data:any=null; try{data=text?JSON.parse(text):null}catch{}
    const token=data?.data?.token??data?.token??data?.data?.access_token??data?.access_token;
    if(!response.ok||!token){
      const msg=String(data?.message??data?.msg??data?.error??"").trim();
      if(response.status===401||response.status===422||/帳號|密碼|password|account|login/i.test(msg)) throw new Error(msg||"TZ 帳號或密碼不正確");
      throw new Error(msg||`登入驗證失敗 (${response.status||"NETWORK"})`);
    }
    return String(token);
  }catch(error:any){
    if(error?.name==="AbortError")throw new Error("登入驗證逾時，請稍後再試");
    if(error instanceof TypeError)throw new Error("瀏覽器無法連到登入驗證服務，請確認網路後再試");
    throw error;
  }finally{clearTimeout(timeout)}
}

async function getGameLoginUrlFromPlatform(platform:"TZ"|"OFA",token:string,provider:"MTLI"|"DGLI"){
  if(Platform.OS!=="web") throw new Error("自動取得平台 Token 目前僅支援網站版");
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),15000);
  const base=platform==="OFA"?"https://www.ofa1188.net":"https://www.tz6868.cc";
  const request=async(withAuth:boolean)=>{
    const headers:any={"Content-Type":"application/json","Accept":"application/json, text/plain, */*"};
    if(withAuth&&token)headers.Authorization=`Bearer ${token}`;
    return fetch(`${base}/api/v2/game/${provider}/login`,{method:"POST",mode:"cors",headers,
      body:JSON.stringify({game_return_url:base,game_kind:"",game_type:"",game_device:"Desktop"}),signal:controller.signal});
  };
  try{
    let response=await request(false);
    let data:any=null; try{data=await response.json()}catch{}
    const firstCode=Number(data?.code);
    if(token && (response.status===401||response.status===403||firstCode===401||firstCode===403)){
      response=await request(true); data=null; try{data=await response.json()}catch{}
    }
    if(!response.ok||Number(data?.code)!==200)throw new Error(String(data?.message??data?.msg??`取得 ${provider==="DGLI"?"DG":"MT"} 授權失敗`));

    // Different TZ/OFA gateways do not always return game_url in exactly the
    // same field/shape. Prefer a real absolute HTTPS URL that actually carries
    // the one-time game token. This also avoids forwarding a relative
    // /ddnewpc/direct1.html URL to the Node relay (which previously surfaced as
    // DG invalid_game_url).
    const rawCandidates:any[]=[
      data?.data?.game_url,
      data?.data?.url,
      data?.raw?.url,
      data?.raw?.game_url,
      typeof data?.raw==="string"?data.raw:undefined,
    ];
    const cleaned=rawCandidates
      .filter(v=>typeof v==="string"&&v.trim())
      .map(v=>String(v).trim().replace(/\\\//g,"/").replace(/^['"]|['"]$/g,""));
    let gameUrl="";
    for(const candidate of cleaned){
      try{
        const u=new URL(candidate);
        if(u.protocol==="https:"&&u.searchParams.get("token")){gameUrl=u.toString();break;}
      }catch{}
    }
    // If one field is relative but another field gives us the vendor origin,
    // resolve the relative path against that origin.
    if(!gameUrl){
      const absolute=cleaned.find(v=>{try{return new URL(v).protocol==="https:"}catch{return false}});
      const relative=cleaned.find(v=>/[?&]token=/i.test(v));
      if(absolute&&relative){
        try{const u=new URL(relative,new URL(absolute).origin);if(u.searchParams.get("token"))gameUrl=u.toString()}catch{}
      }
    }
    if(!gameUrl)throw new Error(`找不到 ${provider==="DGLI"?"DG":"MT"} Token`);
    return gameUrl;
  }finally{clearTimeout(timeout)}
}

async function getMtLoginUrlFromPlatform(platform:"TZ"|"OFA",token:string){
  return getGameLoginUrlFromPlatform(platform,token,"MTLI");
}
async function getDgLoginUrlFromPlatform(platform:"TZ"|"OFA",token:string){
  return getGameLoginUrlFromPlatform(platform,token,"DGLI");
}

async function platformWalletRequest(platform:"TZ"|"OFA",token:string,method:"GET"|"POST",body?:any){
  if(Platform.OS!=="web") throw new Error("轉點目前僅支援網站版");
  const base=platform==="OFA"?"https://www.ofa1188.net":"https://www.tz6868.cc";
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  const request=async(withAuth:boolean)=>{
    const headers:any={"Accept":"application/json, text/plain, */*"};
    if(method==="POST")headers["Content-Type"]="application/json";
    if(withAuth&&token)headers.Authorization=`Bearer ${token}`;
    return fetch(`${base}/api/v1/user/wallet`,{
      method,mode:"cors",headers,
      body:method==="POST"?JSON.stringify(body??{}):undefined,
      signal:controller.signal,
    });
  };
  try{
    let response=await request(false);
    let text=await response.text(); let data:any=null; try{data=text?JSON.parse(text):null}catch{}
    const code=Number(data?.code);
    if(token&&(response.status===401||response.status===403||code===401||code===403)){
      response=await request(true); text=await response.text(); data=null; try{data=text?JSON.parse(text):null}catch{}
    }
    return {response,data};
  }catch(error:any){
    if(error?.name==="AbortError")throw new Error("轉點服務逾時，請稍後再試");
    throw error;
  }finally{clearTimeout(timeout)}
}

async function transferAllToMainWallet(platform:"TZ"|"OFA",token:string){
  const result=await platformWalletRequest(platform,token,"POST",{s:"all",t:0});
  const ok=result.response.ok&&Number(result.data?.code)===200;
  if(ok)return {ok:true,empty:false,message:String(result.data?.message??"轉回成功")};

  // TZ 在沒有可轉回點數時可能只回 422/9999「失敗」。
  // 再讀一次遊戲錢包；如果所有遊戲錢包都是 0，就顯示成「目前無可轉回點數」。
  try{
    const wallet=await platformWalletRequest(platform,token,"GET");
    const rows=Array.isArray(wallet.data?.data)?wallet.data.data:[];
    const transferable=rows.filter((x:any)=>String(x?.game_code||"").trim()).reduce((sum:number,x:any)=>sum+(Number(x?.game_balance)||0),0);
    if(transferable<=0.000001)return {ok:false,empty:true,message:"目前無可轉回點數"};
  }catch{}
  const message=String(result.data?.message??result.data?.msg??result.data?.error??`轉回失敗 (${result.response.status})`).replace(/^"|"$/g,"");
  return {ok:false,empty:false,message:message||"轉回失敗"};
}

function getTzLoginDeviceId(){
  if(typeof window === "undefined") return "web";
  const key="mt_tz_device_id";
  let id=window.localStorage.getItem(key);
  if(!id){
    id="xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{
      const r=Math.floor(Math.random()*16);
      return (c==="x"?r:(r&0x3|0x8)).toString(16);
    });
    window.localStorage.setItem(key,id);
  }
  return id;
}

function AccessScreen({onAuthenticated,notice}:{onAuthenticated:(sessionId:string,platformToken:string,platform:"TZ"|"OFA")=>void;notice?:string}){
  const {width}=useWindowDimensions();
  const desktop=width>=1000;
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [showPassword,setShowPassword]=useState(false);
  const [error,setError]=useState("");
  const playCount=useRef(0);
  const webVideoRef=useRef<any>(null);
  const player=useVideoPlayer({ uri: "/poker.mp4" },p=>{if(Platform.OS!=="web"){p.loop=false;p.muted=true;p.play()}});
  useEffect(()=>{if(Platform.OS==="web")return;const sub=player.addListener("playToEnd",()=>{playCount.current+=1;if(playCount.current<2){player.currentTime=0;player.play()}else player.pause()});return()=>sub.remove()},[player]);
  useEffect(()=>{
    if(Platform.OS!=="web") return;
    playCount.current=0;
    const video=webVideoRef.current;
    if(!video) return;
    video.muted=true;
    video.defaultMuted=true;
    video.playsInline=true;
    video.loop=false;
    const start=()=>{
      try{
        const promise=video.play?.();
        if(promise?.catch) promise.catch(()=>undefined);
      }catch{}
    };
    start();
    const t1=setTimeout(start,120);
    const t2=setTimeout(start,600);
    return()=>{clearTimeout(t1);clearTimeout(t2)};
  },[]);
  const login=trpc.trackerAccess.login.useMutation();
  const resolvePlatform=trpc.trackerAccess.resolvePlatform.useMutation();
  const submit=async()=>{
    if(!username.trim()||!password){setError("請輸入 TZ 帳號與密碼");return}
    setError("");
    try{
      const deviceId=getTzLoginDeviceId();
      // 登入介面維持原本 TZ 帳號 / TZ 密碼；實際驗證平台由後台白名單決定。
      const resolved:any=await resolvePlatform.mutateAsync({username:username.trim()});
      if(!resolved?.found){
        const messages:any={not_whitelisted:"此 TZ 帳號尚未取得使用權限，請聯繫 LINE 協助",disabled:"此 TZ 帳號授權已停用",expired:"此 TZ 帳號授權已到期",database_unavailable:"授權服務暫時無法使用"};
        setError(messages[resolved?.reason]||"登入驗證失敗"); return;
      }
      const platform=(resolved.platform==="OFA"?"OFA":"TZ") as "TZ"|"OFA";
      const platformToken=await loginToPlatformFromBrowser(platform,username.trim(),password,deviceId);
      const access=await login.mutateAsync({username:username.trim(),tzToken:platformToken,deviceId,platform});
      if(!access.success){
        const reason=(access as any).reason;
        const messages:any={not_whitelisted:"此 TZ 帳號尚未取得使用權限，請聯繫 LINE 協助",disabled:"此 TZ 帳號授權已停用",expired:"此 TZ 帳號授權已到期",database_unavailable:"授權服務暫時無法使用"};
        setError(messages[reason]||"TZ 登入驗證失敗");
        return;
      }
      // 登入 MT Assistant 只建立 TZ/OFA 授權工作階段。
      // 不在登入時呼叫 MTLI/login 或 DGLI/login，避免平台的自動轉點被提前觸發。
      setError("");
      onAuthenticated(access.sessionId,platformToken,platform);
    }catch(error:any){
      setError(error?.message||"登入工作階段建立失敗，請重試");
    }
  };
  return <ScreenContainer edges={["top","left","right","bottom"]} containerClassName="bg-[#020A12]" className="bg-[#020A12]">
    <View style={s.loginScreen}>{Platform.OS==="web"?createElement("video" as any,{ref:(node:any)=>{webVideoRef.current=node},src:"/poker.mp4",autoPlay:true,muted:true,defaultMuted:true,playsInline:true,preload:"auto",controls:false,disablePictureInPicture:true,style:{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",pointerEvents:"none"},onLoadedData:(e:any)=>{const v=e.currentTarget;v.muted=true;v.defaultMuted=true;void v.play?.().catch?.(()=>undefined)},onCanPlay:(e:any)=>{const v=e.currentTarget;v.muted=true;void v.play?.().catch?.(()=>undefined)},onEnded:(e:any)=>{const v=e.currentTarget;playCount.current+=1;if(playCount.current<2){v.currentTime=0;void v.play?.().catch?.(()=>undefined)}else{v.pause();try{v.currentTime=Math.max(0,(v.duration||0)-0.05)}catch{}}}}):<VideoView player={player} style={s.loginVideo} contentFit="cover" nativeControls={false}/>}<View style={s.loginShade}/><View style={s.loginPanel}>
      <View style={s.loginTopline}><Text style={s.loginTopText}>MT ASSISTANT · ACCESS</Text><Text style={s.loginSafe}>● 安全驗證</Text></View>
      <View style={[s.loginHero,!desktop?s.loginHeroMobile:null]}>
        <View style={[s.loginBrand,!desktop?s.loginBrandMobile:null]}>
          <View style={s.loginIcon}><MatrixMark size={42}/></View>
          <View style={s.loginBrandCopy}><Text style={s.loginKicker}>REAL-TIME CONTROL ROOM</Text><Text style={[s.loginTitle,!desktop?s.loginTitleMobile:null]} numberOfLines={1}>即時多桌牌路</Text><Text style={[s.loginSub,!desktop?s.loginSubMobile:null]} numberOfLines={1}>安全登入後進入牌路控制台</Text></View>
        </View>
        <View style={s.loginHeroDivider}/>
        <View style={[s.threadsCard,!desktop?s.threadsCardMobile:null]}>
          <View style={s.threadsHead}><View style={s.threadsLogo}><Text style={s.threadsLogoText}>@</Text></View><Text style={s.threadsLabel}>THREADS</Text></View>
          <Text style={s.threadsName}>MT工程師</Text>
          <Text style={s.threadsAccount}>@uss0857</Text>
          <Pressable style={({pressed}:any)=>[s.threadsFollow,pressed&&s.threadsFollowPressed]} onPress={openThreads}><MaterialIcons name="add" size={16} color="#EAF8FF"/><Text style={s.threadsFollowText}>FOLLOW</Text></Pressable>
        </View>
      </View>
      <View style={s.loginDivider}/><View style={s.loginHintRow}><Text style={s.loginHint}>請輸入 TZ 帳號與密碼，驗證成功即可進入。</Text><Pressable style={({pressed}:any)=>[s.registerBtn,pressed&&s.registerBtnPressed]} onPress={openTzRegister}><Text style={s.registerBtnText}>註冊帳號</Text></Pressable></View>{notice?<Text style={s.kickNotice}>⚠ {notice}</Text>:null}
      <Text style={s.loginLabel}>TZ 帳號</Text><TextInput value={username} onChangeText={setUsername} placeholder="輸入 TZ 帳號" placeholderTextColor="#63798B" autoCapitalize="none" autoCorrect={false} style={s.loginInput}/>
      <Text style={s.loginLabel}>TZ 密碼</Text><View style={s.passwordWrap}><TextInput value={password} onChangeText={setPassword} placeholder="輸入密碼" placeholderTextColor="#63798B" secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} style={s.passwordInput} onSubmitEditing={submit}/><Pressable style={s.eyeBtn} onPress={()=>setShowPassword(v=>!v)}><MaterialIcons name={showPassword?"visibility-off":"visibility"} size={19} color="#6F8CA1"/></Pressable></View>
      <Pressable style={s.loginBtn} onPress={submit}><MaterialIcons name="verified-user" size={18} color="#fff"/><Text style={s.loginBtnText}>{login.isPending?"驗證中":"安全登入"}</Text></Pressable>{error?<Text style={s.error}>{error}</Text>:null}
      <View style={s.loginFooterRow}>
        <View style={s.loginFooterLeft}><MaterialIcons name="lock" size={11} color="#8EA4B4"/><Text style={s.loginFoot}>密碼只會用於本次登入驗證</Text></View>
        <Text style={s.loginFooterDivider}>|</Text>
        <Pressable onPress={openLineContact}><Text style={s.loginHelp}>需要協助？LINE 聯絡</Text></Pressable>
      </View>
    </View></View>
  </ScreenContainer>;
}

function applyDealerRealtime(current: TableData[], payload: any): TableData[] {
  const body = payload?.body ?? payload?.msg ?? payload?.data ?? payload ?? {};
  const tableId = String(body?.table_id ?? body?.id ?? body?.room_id ?? "").toUpperCase();
  if (!current.some((table) => (table.apiId ?? table.id) === tableId)) return current;

  const dealer = body?.dealer ?? body?.dealer_info ?? body?.dealerInfo ?? {};
  const dealerName =
    dealer?.nick_name ?? dealer?.nickname ?? dealer?.name ?? dealer?.username ??
    body?.dealer_name ?? body?.dealerName;
  const dealerPhoto =
    body?.dealer_image ?? body?.dealer_image_url ?? body?.dealerPhoto ??
    dealer?.avatar_url ?? dealer?.image ?? dealer?.avatar;

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

function eventName(payload:any){
  return typeof payload?.action==="string"
    ? payload.action
    : payload?.action?.name ?? payload?.action?.path ?? payload?.path ?? payload?.name ?? ""
}
function eventTables(payload:any):any[]|null{const c=[payload?.msg?.tables?.tables,payload?.msg?.tables,payload?.data?.tables?.tables,payload?.data?.tables,payload?.tables?.tables,payload?.tables];return c.find(Array.isArray)??null}
function reconcileCurrentMtTables(current:TableData[],sources:any[],retainedIds:readonly string[]=[]):TableData[]{
  const seen=new Set<string>();
  const active=sources.filter(isMtBaccaratTable).filter(source=>{
    const id=getApiTableId(source);
    if(!id||seen.has(id))return false;
    seen.add(id);return true;
  });
  const activeById=new Map(active.map(source=>[getApiTableId(source),source]));
  const keep=new Set([...activeById.keys(),...retainedIds]);
  const orderedIds=[
    ...current.map(table=>String(table.apiId??table.id).toUpperCase()).filter(id=>keep.has(id)),
    ...active.map(getApiTableId).filter(id=>!current.some(table=>String(table.apiId??table.id).toUpperCase()===id)),
  ];
  const seeded=orderedIds.map(apiId=>{
    const source=activeById.get(apiId);
    const existing=current.find(table=>(table.apiId??table.id)===apiId);
    if(existing)return existing;
    return {
      id:String(source?.table_name??apiId),apiId,game:"百家樂",name:"—",players:"—",
      roomId:String(source?.room_id??"—"),tableBadge:String(source?.orderState??"—"),
      shoe:"—",round:0,banker:0,player:0,tie:0,results:[],trend:"",live:false,
    } as TableData;
  });
  return applyTablesSameShoe(seeded,active);
}
function extractMtUrlToken(value:string){try{return new URL(value.trim()).searchParams.get("token")?.trim()??""}catch{return value.trim().replace(/^token=/i,"")}}
function readonlyConnectionUrl(value:string){
  if(!value)return "自動取得中";
  try{
    const u=new URL(value);
    const queryKeys=[...u.searchParams.keys()];
    const maskedQuery=queryKeys.length?`?${queryKeys.map(k=>`${encodeURIComponent(k)}=********`).join("&")}`:"";
    const maskedPath=u.pathname&&u.pathname!=="/"?"/********":"/";
    return `${u.protocol}//********${maskedPath}${maskedQuery}`;
  }catch{return "********"}
}
async function stopDgRelayServer(sessionId:string){
  if(!sessionId)return;
  try{
    await fetch("/api/dg/stop",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({sessionId}),
      keepalive:true,
    });
  }catch{}
}
function resultKeyFromPayload(payload:any){const b=payload?.body??payload?.msg??payload?.data??{};return `${String(b?.shoe??"")}|${String(b?.round??"")}`}

function extractTableStreamUrl(source:any):string {
  const found:string[]=[];
  const walk=(value:any)=>{
    if(typeof value==="string"){if(/^https?:\/\/.+\.flv(?:[?#].*)?$/i.test(value.trim()))found.push(value.trim());return}
    if(Array.isArray(value)){value.forEach(walk);return}
    if(value&&typeof value==="object")Object.values(value).forEach(walk);
  };
  walk(source?.video ?? source?.videos ?? source?.stream ?? source?.streams ?? source?.live_video ?? source?.liveVideo);
  return found.find(x=>x.includes("pull.bighit888.com")) ?? found[0] ?? "";
}

/**
 * Keep exactly one shoe per table.
 * MT tables/tablesvg snapshots are the authoritative road for the current shoe.
 * show_win is only a fast incremental update while waiting for the next snapshot.
 * A shoe-id change OR an explicit round rollback starts a fresh road.
 * This keeps bead/big/derived roads and Banker/Player/Tie counts scoped to one shoe.
 */
function applyTablesSameShoe(current: TableData[], sources: any[]): TableData[] {
  const next = applyLiveTables(current, sources) as TableData[];
  return next.map((table) => {
    const prev = current.find((x) => (x.apiId ?? `BAG${x.id}`) === (table.apiId ?? `BAG${table.id}`));
    if (!prev) return table;

    const source = sources.find((item) => {
      const sourceId = getApiTableId(item);
      const tableId = table.apiId ?? `BAG${table.id}`;
      return sourceId === tableId || String(item?.table_name ?? "") === table.id;
    });
    const streamUrl = extractTableStreamUrl(source);
    const trend = source?.trend ?? {};
    const explicitShoe = trend?.current_shoe ?? trend?.currentShoe ?? source?.current_shoe ?? source?.currentShoe ?? source?.shoe ?? source?.shoe_id ?? source?.shoeId;
    const explicitRound = trend?.current_round ?? trend?.currentRound ?? source?.current_round ?? source?.currentRound ?? source?.round ?? source?.round_no ?? source?.roundNo;
    const parsedRound = Number(explicitRound);
    const tableWithStream = {
      ...table,
      ...(streamUrl ? {streamUrl} : {}),
      ...(explicitShoe !== undefined && explicitShoe !== null && String(explicitShoe) !== "" ? {shoe:String(explicitShoe)} : {}),
      ...(Number.isFinite(parsedRound) && parsedRound >= 0 ? {round:parsedRound} : {}),
    };

    const prevShoe = String(prev.shoe ?? "");
    const nextShoe = String(tableWithStream.shoe ?? "");
    const prevRound = Number(prev.round) || 0;
    const nextRound = Number.isFinite(parsedRound) ? parsedRound : Number(tableWithStream.round) || 0;
    const shoeChanged = !!(prevShoe && prevShoe !== "—" && nextShoe && nextShoe !== "—" && prevShoe !== nextShoe);
    const roundRolledBack = prevRound > 0 && nextRound >= 0 && nextRound < prevRound;
    const countCurrentShoe = (t:TableData) => {
      const banker=t.results.filter(r=>r==="莊").length;
      const player=t.results.filter(r=>r==="閒").length;
      const tie=t.results.filter(r=>r==="和").length;
      return {...t,banker,player,tie};
    };

    // New shoe: NEVER carry the previous shoe's results forward.
    // If the packet already contains a current-shoe snapshot, use it immediately;
    // otherwise clear now and let show_win / the next snapshot build from zero.
    if (shoeChanged || roundRolledBack) {
      const rawNewSnapshot = trend?.bead_plate2 ?? trend?.bead_plate ?? source?.bead_plate2;
      const hasNewSnapshot = Array.isArray(rawNewSnapshot)
        ? rawNewSnapshot.length > 0
        : typeof rawNewSnapshot === "string" && rawNewSnapshot.replace(/[^0-9]/g, "").length >= 1;
      if (hasNewSnapshot) return countCurrentShoe({...tableWithStream,results:[...tableWithStream.results]});
      // MT international tables briefly publish a new shoe/round with an empty
      // road before the first real bead arrives. Keep the last painted road for
      // that transition packet so the card never flashes completely blank.
      // The first non-empty authoritative snapshot above switches to the new
      // shoe atomically.
      return countCurrentShoe({
        ...tableWithStream,
        shoe:prev.shoe,
        round:prev.round,
        results:[...prev.results],
      });
    }

    // Same shoe: never let a stale/short snapshot roll the visible road backward.
    // show_win appends immediately; a later full snapshot may extend/correct it,
    // but a shorter same-shoe snapshot must not erase already visible history.
    const rawSnapshot = trend?.bead_plate2 ?? trend?.bead_plate ?? source?.bead_plate2;
    const hasSnapshot = Array.isArray(rawSnapshot) ? rawSnapshot.length > 0 : typeof rawSnapshot === "string" && rawSnapshot.replace(/[^0-9]/g, "").length >= 2;

    if (hasSnapshot) {
      // Full/equal snapshot is safe. A shorter same-shoe snapshot is stale: keep
      // the current road while still accepting fresh metadata from the packet.
      if (tableWithStream.results.length >= prev.results.length) return countCurrentShoe(tableWithStream);
      return countCurrentShoe({ ...tableWithStream, results: [...prev.results] });
    }

    // If this packet has no road snapshot at all, do not erase the live road.
    return countCurrentShoe({ ...tableWithStream, results: [...prev.results] });
  });
}

function resetRoadForNewShoePayload(current:TableData[], payload:any):TableData[]{
  const body=payload?.body??payload?.msg??payload?.data??payload??{};
  const tableId=String(body?.table_id??body?.tableId??"").toUpperCase();
  if(!tableId)return current;
  const incomingRoundRaw=body?.round??body?.round_no??body?.roundNo;
  const incomingRound=Number(incomingRoundRaw);
  const incomingShoeRaw=body?.shoe??body?.shoe_id??body?.shoeId;
  const incomingShoe=incomingShoeRaw==null?"":String(incomingShoeRaw);
  return current.map(table=>{
    const id=String(table.apiId??`BAG${table.id}`).toUpperCase();
    if(id!==tableId)return table;
    const prevRound=Number(table.round)||0;
    const prevShoe=String(table.shoe??"");
    const roundRolledBack=Number.isFinite(incomingRound)&&prevRound>0&&incomingRound>=0&&incomingRound<prevRound;
    const shoeChanged=!!(incomingShoe&&incomingShoe!=="—"&&prevShoe&&prevShoe!=="—"&&incomingShoe!==prevShoe);
    // If round already rolled back and the shoe id arrives late, do not erase the
    // first results of the new shoe a second time.
    const delayedShoeMetadata=shoeChanged&&!roundRolledBack&&Number.isFinite(incomingRound)&&prevRound<=5&&incomingRound>=prevRound;
    if(!roundRolledBack&&(!shoeChanged||delayedShoeMetadata))return table;
    return {
      ...table,
      ...(incomingShoe?{shoe:incomingShoe}:{}),
      ...(Number.isFinite(incomingRound)?{round:incomingRound}:{}),
      results:[],banker:0,player:0,tie:0,
    };
  });
}



type V38Side = "莊" | "閒" | "觀望";
type V38PokerState = {
  tableId:string; shoe:string; round:number; result:number[];
  player:string[]; banker:string[]; playerPoint:number; bankerPoint:number;
  complete:boolean; settled:boolean; updatedAt:number;
  formulas:{A:V38Side;B:V38Side;MUL:V38Side;ADD:V38Side};
  recommendation:V38Side;
};

function mtCardRank(cardId:number):string|null{
  if(!Number.isFinite(cardId)||cardId<=0)return null;
  const rank=((Math.trunc(cardId)-1)%13)+1;
  if(rank===1)return "A";
  if(rank===11)return "J";
  if(rank===12)return "Q";
  if(rank===13)return "K";
  return String(rank);
}
function terminalParityFaceValue(card:string){
  if(card==="A")return 1;
  if(card==="J")return 11;
  if(card==="Q")return 12;
  if(card==="K")return 13;
  const n=Number(card);
  return Number.isFinite(n)&&n>=2&&n<=10?n:0;
}
function terminalParityResult(cards:string[]){
  const values=cards.map(terminalParityFaceValue);
  const total=values.reduce((sum,n)=>sum+n,0);
  const first=Math.floor(total/10)+(total%10);
  const finalValue=first>=10?first%10:first;
  return {values,total,first,finalValue,side:(finalValue%2===0?"莊":"閒") as V38Side};
}
function baccaratCardValue(card:string){
  if(card==="A")return 1;
  const n=Number(card);
  return Number.isFinite(n)&&n>=2&&n<=9?n:0;
}
function baccaratPoint(cards:string[]){return cards.reduce((sum,c)=>sum+baccaratCardValue(c),0)%10}
function v38RawFormulas(banker:string[],player:string[]){
  const sum=[...banker,...player].reduce((n,c)=>n+baccaratCardValue(c),0);
  const pb=baccaratPoint(banker),pp=baccaratPoint(player);
  const formulas={
    A:(sum%3===0?"莊":"閒") as V38Side,
    B:(sum%2===0?"莊":"閒") as V38Side,
    MUL:((pb*pp)%2===0?"莊":"閒") as V38Side,
    ADD:((pb+pp)%2===0?"莊":"閒") as V38Side,
  };
  const votes=Object.values(formulas);
  const b=votes.filter(x=>x==="莊").length,p=votes.filter(x=>x==="閒").length;
  return {formulas,recommendation:(b===p?"觀望":b>p?"莊":"閒") as V38Side};
}
function parseV38ShowPoker(payload:any):V38PokerState|null{
  const body=payload?.body??payload?.msg??payload?.data??payload??{};
  const raw=body?.result;
  const tableId=String(body?.table_id??body?.tableId??"").toUpperCase();
  if(!tableId||!Array.isArray(raw)||raw.length<10)return null;
  const result=raw.map((x:any)=>Number(x));
  const player=[result[0],result[2],result[4]].map(mtCardRank).filter((x):x is string=>!!x);
  const banker=[result[1],result[3],result[5]].map(mtCardRank).filter((x):x is string=>!!x);
  const calculatedPlayer=baccaratPoint(player),calculatedBanker=baccaratPoint(banker);
  const serverPlayer=Number(result[8]),serverBanker=Number(result[9]);
  const fourCards=player.length>=2&&banker.length>=2;
  // MT sends show_poker progressively. A packet is considered display-ready only after
  // the first four cards exist and the locally calculated points agree with MT's points.
  const pointsAgree=fourCards&&serverPlayer===calculatedPlayer&&serverBanker===calculatedBanker;
  const {formulas,recommendation}=v38RawFormulas(banker,player);
  return {tableId,shoe:String(body?.shoe??"—"),round:Number(body?.round)||0,result,player,banker,
    playerPoint:calculatedPlayer,bankerPoint:calculatedBanker,complete:pointsAgree,settled:false,updatedAt:Date.now(),formulas,recommendation};
}

function parseDgV38Poker(table:DgTableData):V38PokerState|null{
  if(!table?.poker)return null;
  try{
    const poker=JSON.parse(table.poker);
    const playerIds=String(poker?.player??"").split("-").map(Number).filter(n=>Number.isFinite(n)&&n>0).slice(0,3);
    const bankerIds=String(poker?.banker??"").split("-").map(Number).filter(n=>Number.isFinite(n)&&n>0).slice(0,3);
    if(!playerIds.length&&!bankerIds.length)return null;
    const player=playerIds.map(mtCardRank).filter((x):x is string=>!!x);
    const banker=bankerIds.map(mtCardRank).filter((x):x is string=>!!x);
    const playerPoint=baccaratPoint(player),bankerPoint=baccaratPoint(banker);
    const result=[playerIds[0]??0,bankerIds[0]??0,playerIds[1]??0,bankerIds[1]??0,playerIds[2]??0,bankerIds[2]??0,0,0,playerPoint,bankerPoint];
    const complete=player.length>=2&&banker.length>=2;
    const {formulas,recommendation}=v38RawFormulas(banker,player);
    return {tableId:table.apiId,shoe:table.shoe,round:table.round,result,player,banker,playerPoint,bankerPoint,complete,settled:false,updatedAt:Date.now(),formulas,recommendation};
  }catch{return null}
}

export default function HomeScreen(){
  const {width,height}=useWindowDimensions();
  const desktop=width>=1000;
  const tablet=width>=700&&width<1000;
  const orbSize=desktop?Math.max(68,Math.min(90,width*0.045)):tablet?60:Math.max(48,Math.min(56,width*0.13));
  const orbIconSize=Math.round(orbSize*0.44);
  const panelDesktopWidth=560;
  // Mobile keeps a full, roomy desktop-like canvas and scales the WHOLE canvas down.
  // This prevents the three cards/text from being flex-squeezed just to fit the phone.
  // Mobile uses the SAME 560px desktop canvas. Only the outer canvas is scaled.
  // This keeps desktop typography/card proportions instead of shrinking a wider 660px canvas.
  const panelMobileCanvasWidth=panelDesktopWidth;
  const panelMobileTargetWidth=Math.min(width*0.90,520);
  const panelBaseWidth=desktop?panelDesktopWidth:panelMobileCanvasWidth;
  const panelMobileScale=Math.min(1,panelMobileTargetWidth/panelMobileCanvasWidth);
  const [accessGranted,setAccessGranted]=useState(false);
  const [accessSessionId,setAccessSessionId]=useState("");
  const [accessNotice,setAccessNotice]=useState("");
  const accessSessionCheck=trpc.trackerAccess.checkSession.useQuery(
    {sessionId:accessSessionId},
    {enabled:accessGranted&&!!accessSessionId,refetchInterval:3000,retry:false}
  );
  const logoutAccess=trpc.trackerAccess.logout.useMutation();
  useEffect(()=>{
    if(!accessGranted||!accessSessionId)return;
    if(accessSessionCheck.data && !accessSessionCheck.data.valid){
      const staleSessionId=accessSessionId;
      void stopDgRelayServer(staleSessionId);
      setAccessGranted(false);
      setAccessSessionId("");
      const reason=(accessSessionCheck.data as any)?.reason;
      const notices:any={
        disabled:"此 TZ 帳號授權已被管理員停用。",
        expired:"此 TZ 帳號授權已到期。",
        not_whitelisted:"此 TZ 帳號已不在授權白名單。",
        database_unavailable:"授權服務暫時無法使用。",
        session_invalid:"此帳號已於其他裝置登入，本裝置已自動登出。"
      };
      setAccessNotice(notices[reason]||"此帳號授權已失效，請重新登入。");
      try{socketRef.current?.close()}catch{}
      socketRef.current=null;
      setSocket(null);
      setConnected(false);
      try{dgControllerRef.current?.close()}catch{}
      dgControllerRef.current=null;
      setDgConnected(false);
      setDgStatus("未連線");
      dgGameUrlRef.current=""; dgAuthPromiseRef.current=null; dgLastAuthAtRef.current=0; dgSameTokenRetryRef.current=0;
      setDgGameUrl("");
      setDgTables([]);
      platformTokenRef.current="";
      setActivePlatform("MT");
      setToken("");
      setMtUrl("");
      lockedMtUrlRef.current="";
      setHasEnteredGame(false);
      setDgWasOpened(false);
      setGameViewUrl("");
      setPlatformLaunching(false);
      setWalletTransferOpen(false);
      setWalletTransferBusy(false);
      setDgNeedsRecovery(false);
      dgHasConnectedRef.current=false;
      dgForegroundRecoveryAttemptRef.current=0;
      dgBridgeActiveRef.current=false;
      suppressDgRecoveryRef.current=false;
      roadConnectBusyRef.current=false;
      setFloatingOpen(false);
      setMtOpen(false);
      setInsideMt(false);
      currentBalanceRef.current=null;
      setCurrentBalance(null);
      setStopLossOpen(false);
      setStopLossAlertOpen(false);
      setStopLossEnabled(false);
      setStopLossTriggered(false);
      setStopLossPrincipal("");
      setStopLossPercent(20);
    }
  },[accessGranted,accessSessionId,accessSessionCheck.data?.valid,(accessSessionCheck.data as any)?.reason]);

  const [connectionOpen,setConnectionOpen]=useState(false);
  const [helpOpen,setHelpOpen]=useState(false);
  const [analysisTable,setAnalysisTable]=useState<TableData|null>(null);
  const [radarOpen,setRadarOpen]=useState(false);
  const [radarDetailId,setRadarDetailId]=useState<string|null>(null);
  const [mtOpen,setMtOpen]=useState(false);
  const [gameViewPlatform,setGameViewPlatform]=useState<"MT"|"DG">("MT");
  const [gameViewUrl,setGameViewUrl]=useState("");
  const [platformLaunching,setPlatformLaunching]=useState(false);
  const [hasEnteredGame,setHasEnteredGame]=useState(false);
  const [dgWasOpened,setDgWasOpened]=useState(false);
  const [walletTransferOpen,setWalletTransferOpen]=useState(false);
  const [walletTransferBusy,setWalletTransferBusy]=useState(false);
  const [floatingOpen,setFloatingOpen]=useState(false);
  const [roomDropdownOpen,setRoomDropdownOpen]=useState(false);
  const roomDropdownOpenRef=useRef(false);
  // Freeze the room menu while it is open so live table updates cannot reset its scroll position.
  const [roomMenuTables,setRoomMenuTables]=useState<TableData[]>([]);
  const [assistPage,setAssistPage]=useState(0);
  const [assistTableId,setAssistTableId]=useState("BAG01");
  const [connected,setConnected]=useState(false);
  const [activePlatform,setActivePlatform]=useState<"MT"|"DG">("MT");
  const [dgConnected,setDgConnected]=useState(false);
  const [dgStatus,setDgStatus]=useState("未連線");
  const [dgGameUrl,setDgGameUrl]=useState("");
  const dgGameUrlRef=useRef("");
  const dgAuthPromiseRef=useRef<Promise<string>|null>(null);
  const dgLastAuthAtRef=useRef(0);
  const dgSameTokenRetryRef=useRef(0);
  // A successful "transfer all back" moves the balance out of the current
  // game wallet. DG normally reuses its existing DGLI URL to avoid duplicate
  // sessions, but the next explicit DG launch must authenticate once so the
  // platform can transfer the main-wallet balance into DG again.
  const dgFreshAuthorizationRequiredRef=useRef(false);
  const [dgNeedsRecovery,setDgNeedsRecovery]=useState(false);
  const dgBridgeActiveRef=useRef(false);
  const [dgConnectEpoch,setDgConnectEpoch]=useState(0);
  const dgHasConnectedRef=useRef(false);
  const dgForegroundRecoveryAttemptRef=useRef(0);
  const [dgTables,setDgTables]=useState<TableData[]>([]);
  const dgControllerRef=useRef<{close:()=>void}|null>(null);
  const platformTokenRef=useRef("");
  const roadConnectBusyRef=useRef(false);
  const suppressDgRecoveryRef=useRef(false);
  const [loginPlatform,setLoginPlatform]=useState<"TZ"|"OFA">("TZ");
  const [token,setToken]=useState("");
  const [mtUrl,setMtUrl]=useState("");
  // Authoritative MT launch URL for this TZ login session. UI fields are display-only.
  const lockedMtUrlRef=useRef("");
  const [wsUrl]=useState("wss://a1.ofalive99.net/game/ws");
  const [socket,setSocket]=useState<WebSocket|null>(null);
  // Single authoritative game socket. State is only for UI; lifecycle uses this ref.
  const socketRef=useRef<WebSocket|null>(null);
  const socketGenerationRef=useRef(0);
  const reconnectingRef=useRef(false);
  const reconnectCooldownUntilRef=useRef(0);
  const awaitingFreshSnapshotRef=useRef(false);
  const reconnectTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const roomDropdownScrollRef=useRef<ScrollView|null>(null);
  const roomDropdownOffsetRef=useRef(0);
  const [mtTables,setMtTables]=useState<TableData[]>([]);
  const [mtSnapshotReady,setMtSnapshotReady]=useState(false);
  // WebSocket packets are processed immediately into this ref. React painting is
  // committed at most once per animation frame, so the socket frequency is NOT
  // reduced while drag gestures no longer fight dozens of synchronous renders.
  const liveTablesRef=useRef<TableData[]>(initialTables);
  const confirmedMtTableIdsRef=useRef<string[]>([]);
  const tablesFrameRef=useRef<number|null>(null);
  const updateLiveTables=(updater:(current:TableData[])=>TableData[])=>{
    const current=liveTablesRef.current;
    const next=updater(current);
    if(next===current)return;
    liveTablesRef.current=next;
    if(tablesFrameRef.current==null){
      tablesFrameRef.current=requestAnimationFrame(()=>{
        tablesFrameRef.current=null;
        setMtTables(liveTablesRef.current);
      });
    }
  };
  const tables:TableData[]=activePlatform==="DG"?(dgTables.length?dgTables:dgPlaceholderTables):(mtSnapshotReady?mtTables:initialTables);
  const availableTableCount=activePlatform==="DG"?dgTables.length:(mtSnapshotReady?mtTables.length:0);
  const activeConnected=activePlatform==="DG"?dgConnected:connected;
  const [events,setEvents]=useState<string[]>([]);
  const [toast,setToast]=useState("");
  const [bankroll,setBankroll]=useState(100000);
  const [initialBankroll,setInitialBankroll]=useState(100000);
  const [baseBet,setBaseBet]=useState(1000);
  const [strategy,setStrategy]=useState<StrategyName>("馬丁");
  const [strategyLevel,setStrategyLevel]=useState(0);
  const strategyRef=useRef<StrategyName>("馬丁");
  const baseBetRef=useRef(baseBet);
  useEffect(()=>{strategyRef.current=strategy},[strategy]);
  useEffect(()=>{baseBetRef.current=baseBet},[baseBet]);
  const [todayPnl,setTodayPnl]=useState<number|null>(null);
  const [dgTodayPnl,setDgTodayPnl]=useState<DgDailyPnl|null>(null);
  const activeTodayPnl=platformTodayPnl(activePlatform,todayPnl,dgTodayPnl);
  const todayPnlRef=useRef<number|null>(null);
  // Independent stop-loss reminder. It reads the official MT balance from the existing
  // authenticated game WebSocket and never changes the locked 今日輸贏 logic.
  const [currentBalance,setCurrentBalance]=useState<number|null>(null);
  const currentBalanceRef=useRef<number|null>(null);
  const [stopLossOpen,setStopLossOpen]=useState(false);
  const [stopLossPrincipal,setStopLossPrincipal]=useState("");
  const [stopLossPercent,setStopLossPercent]=useState(20);
  const [stopLossEnabled,setStopLossEnabled]=useState(false);
  const [stopLossTriggered,setStopLossTriggered]=useState(false);
  const [stopLossAlertOpen,setStopLossAlertOpen]=useState(false);
  const [labSequence,setLabSequence]=useState<number[]>([1,2,3,4]);
  const [pendingBet,setPendingBet]=useState<PendingBet>(null);
  const [records,setRecords]=useState<BetRecord[]>([]);
  const [peakBankroll,setPeakBankroll]=useState(100000);
  const lastBetReportOrderRef=useRef<string>("");
  const betReportBaselineReadyRef=useRef(false);
  // v27: 記住「這次主連線開始追蹤」的本機時間。
  // created_at 是秒級 Unix time；orderTimeOf() 已統一轉成毫秒。
  // 因此即使第一包 /bet/history 晚到，連線後才建立的下注也不能被當成歷史基準吃掉。
  const betTrackingStartedAtRef=useRef(0);
  const processedBetSnRef=useRef<Set<string>>(new Set());
  const pendingSettlementGameSnRef=useRef<Set<string>>(new Set());
  // v26: show_win/end 若帶 game_sn，先鎖定該局；正式 /bet/history 再以相同 gameSn 結算。
  // v25: gameSn 是正式結算追蹤的主鍵；betSn 只作同一 gameSn 下的二次去重。
  // 不依賴 iframe /bet Request，直接由正式 /bet/history 建立並追蹤 gameSn。
  const processedGameSnRef=useRef<Set<string>>(new Set());
  const lastBetReportGameSnRef=useRef<string>("");
  const orbPosition=useRef(new Animated.ValueXY()).current;
  const panelPosition=useRef(new Animated.ValueXY()).current;
  const radarPosition=useRef(new Animated.ValueXY()).current;
  // Independent V38 calculator floating window. Existing assistant state/drag logic is untouched.
  const [v38Open,setV38Open]=useState(false);
  const [v38DetailOpen,setV38DetailOpen]=useState(false);
  const [v38ByTable,setV38ByTable]=useState<Record<string,V38PokerState>>({});
  const v38ByTableRef=useRef<Record<string,V38PokerState>>({});
  const v38Position=useRef(new Animated.ValueXY()).current;
  const v38DraggingRef=useRef(false);
  // Independent Terminal Parity Model. It passively reuses the existing show_poker state.
  const [terminalParityOpen,setTerminalParityOpen]=useState(false);
  const terminalParityPosition=useRef(new Animated.ValueXY()).current;
  const terminalParityDraggingRef=useRef(false);
  const panelSizeRef=useRef({width:panelBaseWidth,height:245});
  const orbDraggingRef=useRef(false);
  const panelDraggingRef=useRef(false);
  const radarDraggingRef=useRef(false);
  const appendEvent=(x:string)=>setEvents(e=>[`[${new Date().toLocaleTimeString()}] ${x}`,...e].slice(0,40));
  const notify=(x:string)=>{setToast(x);setTimeout(()=>setToast(""),1800)};
  const stopLossPrincipalValue=useMemo(()=>{
    const value=Number(String(stopLossPrincipal||"").replace(/,/g,"").trim());
    return Number.isFinite(value)&&value>0?value:0;
  },[stopLossPrincipal]);
  const stopLossThreshold=useMemo(()=>stopLossPrincipalValue>0?stopLossPrincipalValue*(1-stopLossPercent/100):0,[stopLossPrincipalValue,stopLossPercent]);
  useEffect(()=>{
    if(!stopLossEnabled||stopLossTriggered||currentBalance===null||stopLossThreshold<=0)return;
    if(currentBalance<=stopLossThreshold){
      setStopLossTriggered(true);
      setStopLossAlertOpen(true);
    }
  },[currentBalance,stopLossEnabled,stopLossThreshold,stopLossTriggered]);
  const openStopLossSettings=()=>{
    if(!stopLossPrincipalValue&&currentBalance!==null&&Number.isFinite(currentBalance))setStopLossPrincipal(String(currentBalance));
    setStopLossOpen(true);
  };
  const useCurrentBalanceAsPrincipal=()=>{
    if(currentBalance===null||!Number.isFinite(currentBalance)){notify("尚未取得 MT 目前餘額");return;}
    setStopLossPrincipal(String(currentBalance));
  };
  const enableStopLoss=()=>{
    if(stopLossPrincipalValue<=0){notify("請先設定本金");return;}
    setStopLossTriggered(false);
    setStopLossEnabled(true);
    setStopLossOpen(false);
    notify(`止損提醒已開啟｜${stopLossPercent}%`);
  };
  const resetStopLossForLogout=()=>{
    currentBalanceRef.current=null;
    setCurrentBalance(null);
    setStopLossOpen(false);
    setStopLossAlertOpen(false);
    setStopLossEnabled(false);
    setStopLossTriggered(false);
    setStopLossPrincipal("");
    setStopLossPercent(20);
  };
  const nextAmount=Math.max(0,Math.round(strategyAmount(strategy,baseBet,strategyLevel,labSequence)));
  // Floating assistant always reads the current live table object.
  // roomMenuTables is only a frozen dropdown snapshot and must never drive dealer display.
  const assistTable=useMemo(()=>tables.find(t=>(t.apiId??`BAG${t.id}`)===assistTableId)??tables[0],[tables,assistTableId]);
  const latest=assistTable?.results.at(-1);
  const recommendation=recommendSide(assistTable?.results??[]);
  const assistDecision=roadDecision(assistTable?.results??[]);
  const assistConfidence=confidencePercent(assistDecision.scoreBanker,assistDecision.scorePlayer);
  const assistConfidenceState=confidenceState(assistConfidence);
  const radarSignals=useMemo(()=>tables.map(table=>{
    const results=table.results??[];
    const ready=roadSides(results).length>=3;
    const decision=roadDecision(results);
    const confidence=ready?confidencePercent(decision.scoreBanker,decision.scorePlayer):0;
    return {table,id:table.apiId??`BAG${table.id}`,ready,decision,confidence};
  }),[tables]);
  const bestRadar=radarSignals.filter(x=>x.ready).reduce<(typeof radarSignals)[number]|null>((best,item)=>!best||item.confidence>best.confidence?item:best,null);
  const radarDetailTable=radarDetailId?tables.find(t=>(t.apiId??`BAG${t.id}`)===radarDetailId)??null:null;
  const radarDetailDecision=roadDecision(radarDetailTable?.results??[]);
  const radarDetailConfidence=radarDetailTable?confidencePercent(radarDetailDecision.scoreBanker,radarDetailDecision.scorePlayer):0;

  useEffect(()=>{
    if(Platform.OS!=="web" || typeof document==="undefined") return;
    document.title="MT Assistant";
    let homeTitle=document.querySelector('meta[name="apple-mobile-web-app-title"]') as HTMLMetaElement|null;
    if(!homeTitle){
      homeTitle=document.createElement("meta");
      homeTitle.name="apple-mobile-web-app-title";
      document.head.appendChild(homeTitle);
    }
    homeTitle.content="多平台百家輔助";
    const scrollbarStyleId="mt-hidden-scrollbar";
    if(!document.getElementById(scrollbarStyleId)){
      const style=document.createElement("style");
      style.id=scrollbarStyleId;
      style.textContent=`
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
      const skinStyleId="mt-ui-skin-v1";
      if(!document.getElementById(skinStyleId)){
        const skin=document.createElement("style");
        skin.id=skinStyleId;
        skin.textContent=`
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
      const scrollbarFixId="mt-scrollbar-fix-v7";
    if(!document.getElementById(scrollbarFixId)){
      const sb=document.createElement("style");
      sb.id=scrollbarFixId;
      sb.textContent=`
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
      const skinV6Id="mt-ui-skin-v6";
      if(!document.getElementById(skinV6Id)){
        const v6=document.createElement("style");
        v6.id=skinV6Id;
        v6.textContent=`
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
    let link=document.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement | null;
    if(!link){
      link=document.createElement("link");
      link.rel="apple-touch-icon";
      document.head.appendChild(link);
    }
    link.href="/apple-touch-icon.png";
    let favicon=document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
    if(!favicon){
      favicon=document.createElement("link");
      favicon.rel="icon";
      document.head.appendChild(favicon);
    }
    favicon.href="/apple-touch-icon.png";
  },[]);
  // Unmount only: close the one authoritative socket. Do not tie cleanup to React state changes.
  useEffect(()=>()=>{
    socketGenerationRef.current+=1;
    const ws=socketRef.current;
    socketRef.current=null;
    try{ws?.close()}catch{}
  },[]);
  useEffect(()=>()=>{if(reconnectTimerRef.current)clearTimeout(reconnectTimerRef.current)},[]);
  useEffect(()=>()=>{if(tablesFrameRef.current!=null)cancelAnimationFrame(tablesFrameRef.current)},[]);
  useEffect(()=>{setPeakBankroll(p=>Math.max(p,bankroll))},[bankroll]);
  useEffect(()=>{roomDropdownOpenRef.current=roomDropdownOpen},[roomDropdownOpen]);

  const clampOrbPosition=()=>{
    const baseLeft=Math.max(0,width-orbSize-16);
    const baseTop=Math.max(0,height-orbSize-(mtOpen?34:24));
    const minX=-baseLeft;
    const maxX=Math.max(minX,width-orbSize-baseLeft);
    const minY=-baseTop;
    const maxY=Math.max(minY,height-orbSize-baseTop);
    orbPosition.stopAnimation((v:any)=>orbPosition.setValue({
      x:Math.max(minX,Math.min(maxX,Number(v?.x)||0)),
      y:Math.max(minY,Math.min(maxY,Number(v?.y)||0)),
    }));
  };
  const clampPanelPosition=()=>{
    // Mobile Safari: keep the panel where the finger releases it.
    // Only keep a small grab area visible instead of snapping to the default position.
    const scale=desktop?1:panelMobileScale;
    const visualWidth=Math.max(1,panelSizeRef.current.width*scale);
    const visualHeight=Math.max(1,panelSizeRef.current.height*scale);
    // floatPanelMobile is anchored at left:18/top:170; desktop uses right/bottom.
    // Clamp against the *visual* scaled rectangle, not the unscaled 560px canvas.
    const baseLeft=desktop?Math.max(8,width-74-visualWidth):18;
    const baseTop=desktop?Math.max(8,height-22-visualHeight):170;
    const keepX=Math.min(96,visualWidth);
    const headerGrab=Math.min(34*scale,visualHeight);
    const keepY=Math.max(18,headerGrab);
    const minX=8-visualWidth+keepX-baseLeft;
    const maxX=width-8-keepX-baseLeft;
    // Never allow the header/grab strip to disappear above the viewport.
    const minY=8-baseTop;
    const maxY=height-8-keepY-baseTop;
    panelPosition.stopAnimation((v:any)=>panelPosition.setValue({
      x:Math.max(minX,Math.min(maxX,Number(v?.x)||0)),
      y:Math.max(minY,Math.min(maxY,Number(v?.y)||0)),
    }));
  };

  const orbResponder=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:()=>true,
    onStartShouldSetPanResponderCapture:()=>false,
    onMoveShouldSetPanResponder:(_,g)=>Math.abs(g.dx)>=1||Math.abs(g.dy)>=1,
    onMoveShouldSetPanResponderCapture:()=>false,
    onPanResponderGrant:()=>{
      orbDraggingRef.current=false;
      orbPosition.stopAnimation(()=>orbPosition.extractOffset());
    },
    onPanResponderMove:(_,g)=>{
      if(Math.abs(g.dx)>2||Math.abs(g.dy)>2)orbDraggingRef.current=true;
      orbPosition.setValue({x:g.dx,y:g.dy});
    },
    onPanResponderRelease:(_,g)=>{
      orbPosition.flattenOffset();
      clampOrbPosition();
      if(!orbDraggingRef.current&&Math.hypot(g.dx,g.dy)<6)setFloatingOpen(v=>!v);
      orbDraggingRef.current=false;
    },
    onPanResponderTerminate:()=>{orbPosition.flattenOffset();clampOrbPosition();orbDraggingRef.current=false},
    onPanResponderTerminationRequest:()=>false,
    onShouldBlockNativeResponder:()=>true,
  }),[orbPosition,width,height,orbSize,mtOpen]);
  const panelDrag=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:()=>false,
    onStartShouldSetPanResponderCapture:()=>false,
    onMoveShouldSetPanResponder:(_,g)=>!roomDropdownOpenRef.current&&(Math.abs(g.dx)>=2||Math.abs(g.dy)>=2),
    onMoveShouldSetPanResponderCapture:()=>false,
    onPanResponderGrant:()=>{
      if(roomDropdownOpenRef.current)return;
      panelDraggingRef.current=true;
      panelPosition.stopAnimation(()=>panelPosition.extractOffset());
    },
    onPanResponderMove:(_,g)=>{
      if(roomDropdownOpenRef.current)return;
      panelPosition.setValue({x:g.dx,y:g.dy});
    },
    onPanResponderRelease:()=>{
      if(!panelDraggingRef.current)return;
      panelPosition.flattenOffset();
      // Clamp using the scaled visual box on both desktop and mobile.
      // This guarantees the header remains reachable after dragging upward/off-screen.
      clampPanelPosition();
      panelDraggingRef.current=false;
    },
    onPanResponderTerminate:()=>{if(panelDraggingRef.current){panelPosition.flattenOffset();clampPanelPosition();panelDraggingRef.current=false}},
    onPanResponderTerminationRequest:()=>false,
    onShouldBlockNativeResponder:()=>true,
  }),[panelPosition,width,height,desktop,panelBaseWidth]);
  const clampV38Position=()=>{
    const boxW=desktop?360:Math.min(340,width-24),boxH=285;
    const baseLeft=desktop?Math.max(12,width-boxW-88):12;
    const baseTop=desktop?120:115;
    const minX=8-baseLeft,maxX=Math.max(minX,width-8-boxW-baseLeft);
    const minY=8-baseTop,maxY=Math.max(minY,height-36-baseTop);
    v38Position.stopAnimation((v:any)=>v38Position.setValue({
      x:Math.max(minX,Math.min(maxX,Number(v?.x)||0)),
      y:Math.max(minY,Math.min(maxY,Number(v?.y)||0)),
    }));
  };
  const v38Drag=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:()=>false,
    onMoveShouldSetPanResponder:(_,g)=>Math.abs(g.dx)>=2||Math.abs(g.dy)>=2,
    onPanResponderGrant:()=>{v38DraggingRef.current=true;v38Position.stopAnimation(()=>v38Position.extractOffset())},
    onPanResponderMove:(_,g)=>v38Position.setValue({x:g.dx,y:g.dy}),
    onPanResponderRelease:()=>{v38Position.flattenOffset();clampV38Position();v38DraggingRef.current=false},
    onPanResponderTerminate:()=>{v38Position.flattenOffset();clampV38Position();v38DraggingRef.current=false},
    onPanResponderTerminationRequest:()=>false,
  }),[v38Position,width,height,desktop]);

  const clampTerminalParityPosition=()=>{
    const boxW=desktop?300:Math.min(300,width-24),boxH=205;
    const baseLeft=desktop?Math.max(12,width-boxW-88):12;
    const baseTop=desktop?120:115;
    const minX=8-baseLeft,maxX=Math.max(minX,width-8-boxW-baseLeft);
    const minY=8-baseTop,maxY=Math.max(minY,height-36-baseTop);
    terminalParityPosition.stopAnimation((v:any)=>terminalParityPosition.setValue({
      x:Math.max(minX,Math.min(maxX,Number(v?.x)||0)),
      y:Math.max(minY,Math.min(maxY,Number(v?.y)||0)),
    }));
  };
  const terminalParityDrag=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:()=>false,
    onMoveShouldSetPanResponder:(_,g)=>Math.abs(g.dx)>=2||Math.abs(g.dy)>=2,
    onPanResponderGrant:()=>{terminalParityDraggingRef.current=true;terminalParityPosition.stopAnimation(()=>terminalParityPosition.extractOffset())},
    onPanResponderMove:(_,g)=>terminalParityPosition.setValue({x:g.dx,y:g.dy}),
    onPanResponderRelease:()=>{terminalParityPosition.flattenOffset();clampTerminalParityPosition();terminalParityDraggingRef.current=false},
    onPanResponderTerminate:()=>{terminalParityPosition.flattenOffset();clampTerminalParityPosition();terminalParityDraggingRef.current=false},
    onPanResponderTerminationRequest:()=>false,
  }),[terminalParityPosition,width,height,desktop]);

  const clampRadarPosition=()=>{
    const launcherWidth=desktop?210:188;
    const launcherHeight=32;
    const baseLeft=Math.max(8,width-launcherWidth-(desktop?14:8));
    const baseTop=desktop?66:61;
    const minX=8-baseLeft;
    const maxX=Math.max(minX,width-8-launcherWidth-baseLeft);
    const minY=8-baseTop;
    const maxY=Math.max(minY,height-8-launcherHeight-baseTop);
    radarPosition.stopAnimation((v:any)=>radarPosition.setValue({
      x:Math.max(minX,Math.min(maxX,Number(v?.x)||0)),
      y:Math.max(minY,Math.min(maxY,Number(v?.y)||0)),
    }));
  };
  const radarResponder=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:()=>true,
    onStartShouldSetPanResponderCapture:()=>false,
    onMoveShouldSetPanResponder:(_,g)=>Math.abs(g.dx)>=1||Math.abs(g.dy)>=1,
    onMoveShouldSetPanResponderCapture:()=>false,
    onPanResponderGrant:()=>{
      radarDraggingRef.current=false;
      radarPosition.stopAnimation(()=>radarPosition.extractOffset());
    },
    onPanResponderMove:(_,g)=>{
      if(Math.abs(g.dx)>2||Math.abs(g.dy)>2)radarDraggingRef.current=true;
      radarPosition.setValue({x:g.dx,y:g.dy});
    },
    onPanResponderRelease:(_,g)=>{
      radarPosition.flattenOffset();
      clampRadarPosition();
      if(!radarDraggingRef.current&&Math.hypot(g.dx,g.dy)<6)setRadarOpen(true);
      radarDraggingRef.current=false;
    },
    onPanResponderTerminate:()=>{radarPosition.flattenOffset();clampRadarPosition();radarDraggingRef.current=false},
    onPanResponderTerminationRequest:()=>false,
    onShouldBlockNativeResponder:()=>true,
  }),[radarPosition,width,height,desktop]);

  const pageSwipe=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:()=>false,
    onMoveShouldSetPanResponder:(_,g)=>!roomDropdownOpen&&Math.abs(g.dx)>=6&&Math.abs(g.dx)>Math.abs(g.dy)*1.12,
    onMoveShouldSetPanResponderCapture:()=>false,
    onPanResponderRelease:(_,g)=>{if(roomDropdownOpen)return;if(g.dx<=-24)setAssistPage(p=>Math.min(2,p+1));if(g.dx>=24)setAssistPage(p=>Math.max(0,p-1))},
    onPanResponderTerminationRequest:()=>false
  }),[roomDropdownOpen]);


  const settlePending=(actual:Result,payload:any)=>{
    setPendingBet(pending=>{
      if(!pending) return pending;
      const body=payload?.body??payload?.msg??payload?.data??{};
      const tableId=String(body?.table_id??"");
      if(tableId&&tableId!==pending.tableId) return pending;
      const key=resultKeyFromPayload(payload);
      if(pending.resultKey&&pending.resultKey===key) return pending;
      let pnl=0; let outcome:"win"|"loss"|"push"="push";
      if(pending.side==="和") { if(actual==="和"){pnl=pending.amount*8;outcome="win"}else{pnl=-pending.amount;outcome="loss"} }
      else if(actual==="和"){pnl=0;outcome="push"}
      else if(actual===pending.side){pnl=pending.side==="莊"?pending.amount*.95:pending.amount;outcome="win"}
      else {pnl=-pending.amount;outcome="loss"}
      setBankroll(v=>Math.round(v+pnl));
      setRecords(r=>[{side:pending.side,result:actual,amount:pending.amount,pnl:Math.round(pnl),at:Date.now()},...r].slice(0,30));
      if(outcome!=="push"){
        setStrategyLevel(level=>{
          if(strategy==="馬丁") return level; // v21: 馬丁只由正式 /bet/history 的最新本注結算推進
          if(strategy==="達朗貝爾") return outcome==="loss"?Math.min(level+1,20):Math.max(0,level-1);
          if(strategy==="Fibonacci") return outcome==="loss"?Math.min(level+1,10):Math.max(0,level-2);
          if(strategy==="Paroli") return outcome==="win"?(level>=2?0:level+1):0;
          if(strategy==="1-3-2-6") return outcome==="win"?(level>=3?0:level+1):0;
          if(strategy==="Oscar's Grind") return outcome==="win"?Math.min(level+1,20):level;
          return 0;
        });
        if(strategy==="Labouchere") setLabSequence(seq=>{const q=seq.length?seq:[1,2,3,4];if(outcome==="win")return q.length<=2?[1,2,3,4]:q.slice(1,-1);const stake=q.length===1?q[0]:q[0]+q[q.length-1];return [...q,stake]});
      }
      appendEvent(`統計結算 ${pending.tableId}：押${pending.side} ${pending.amount}，開${actual}，損益 ${Math.round(pnl)}`);
      return null;
    });
  };

  const readBetReportOrders=(payload:any):any[]=>{
    const roots=[
      payload?.body,payload?.data,payload?.msg,
      payload?.body?.data,payload?.data?.data,payload?.msg?.data,
      payload?.body?.result,payload?.data?.result
    ];
    for(const root of roots){
      if(!root)continue;
      if(Array.isArray(root))return root;
      for(const key of ["orders","list","rows","records","items"]){
        if(Array.isArray(root?.[key]))return root[key];
      }
    }
    return [];
  };
  const isBetReportPayload=(payload:any)=>{
    const name=eventName(payload);
    if(name.includes("/bet/history"))return true;
    const orders=readBetReportOrders(payload);
    if(!orders.length)return false;
    return orders.some((o:any)=>
      o && (
        o.betSn!=null || o.bet_sn!=null || o.bet_total!=null ||
        o.win_total!=null || Array.isArray(o.slips)
      )
    );
  };
  const orderTimeOf=(o:any)=>{
    const raw=o?.created_at??o?.settled_at??o?.updated_at??o?.time??0;
    if(typeof raw==="number")return raw>1e12?raw:raw*1000;
    const n=Number(raw);
    if(Number.isFinite(n)&&n>0)return n>1e12?n:n*1000;
    const d=Date.parse(String(raw??""));
    return Number.isFinite(d)?d:0;
  };
  const orderIdOf=(o:any)=>String(o?.betSn??o?.bet_sn??o?.no??o?.order_no??o?.orderNumber??o?.id??"");
  const mainBetSlipsOf=(o:any)=>Array.isArray(o?.slips)
    ? o.slips.filter((x:any)=>{
        // v17: identify the Baccarat main bet by the report's actual label.
        // Exact equality is intentional: 莊對子 / 閒對子 / 龍寶 / 和 etc. must never affect Martingale.
        const name=String(x?.content_name??x?.contentName??"").trim();
        return name==="莊"||name==="閒";
      })
    : [];
  const orderPnlOf=(o:any)=>{
    const main=mainBetSlipsOf(o);
    if(main.length){
      let bet=0,refund=0;
      for(const x of main){
        const b=Number(String(x?.bet??0).replace(/,/g,""));
        const r=Number(String(x?.refund??x?.win??0).replace(/,/g,""));
        if(Number.isFinite(b))bet+=b;
        if(Number.isFinite(r))refund+=r;
      }
      return refund-bet;
    }
    const bet=Number(String(o?.bet_total??"").replace(/,/g,""));
    const win=Number(String(o?.win_total??"").replace(/,/g,""));
    return Number.isFinite(bet)&&Number.isFinite(win)?win-bet:null;
  };
  const orderBetOf=(o:any)=>{
    const main=mainBetSlipsOf(o);
    if(main.length)return main.reduce((sum:number,x:any)=>{
      const n=Number(String(x?.bet??0).replace(/,/g,""));
      return sum+(Number.isFinite(n)?n:0);
    },0);
    const n=Number(String(o?.bet_total??0).replace(/,/g,""));
    return Number.isFinite(n)?n:0;
  };
  const orderSettled=(o:any)=>{
    const raw=o?.status??o?.state??o?.settle_status;
    if(Number(raw)===3)return true;
    const status=String(raw??"").toLowerCase();
    return /settled|finished|completed|done|結算完成|已派彩/.test(status);
  };
  const readTodayPnl=(payload:any)=>{
    const toNumber=(raw:any)=>{
      const n=Number(String(raw??"").replace(/,/g,""));
      return Number.isFinite(n)?n:null;
    };
    // Fast paths for the normal /bet/history response.
    const candidates=[
      payload?.msg?.total?.all?.w,
      payload?.data?.total?.all?.w,
      payload?.body?.total?.all?.w,
      payload?.msg?.data?.total?.all?.w,
      payload?.data?.msg?.total?.all?.w,
      payload?.body?.msg?.total?.all?.w,
    ];
    for(const raw of candidates){
      const n=toNumber(raw);
      if(n!==null)return n;
    }
    // Some MT packets wrap msg/data/body one extra level. Find total.all.w
    // without depending on that wrapper shape, but keep traversal shallow.
    const seen=new Set<any>();
    const walk=(node:any,depth:number):number|null=>{
      if(node==null||depth>5)return null;
      if(typeof node==="string"){
        const t=node.trim();
        if((t.startsWith("{")||t.startsWith("["))&&t.length<200000){
          try{return walk(JSON.parse(t),depth+1)}catch{}
        }
        return null;
      }
      if(typeof node!=="object"||seen.has(node))return null;
      seen.add(node);
      const direct=toNumber(node?.total?.all?.w);
      if(direct!==null)return direct;
      for(const key of ["msg","data","body","result","response","payload"]){
        const found=walk(node?.[key],depth+1);
        if(found!==null)return found;
      }
      return null;
    };
    return walk(payload,0);
  };
  const gameSnOf=(o:any)=>String(o?.gameSn??o?.game_sn??"").trim();
  const applyBetReport=(payload:any)=>{
    // v25：gameSn 精準追蹤。只看正式 /bet/history 的莊/閒本注結算。
    // gameSn 判斷「哪一局」，betSn 只負責同局二次去重；不猜 play_id / winner。
    const allOrders=readBetReportOrders(payload);
    if(!allOrders.length)return;

    const settledMainOrders=[...allOrders]
      // betSn/order id is enough to track a settled main bet. Some current MT
      // /bet/history packets do not expose gameSn at order level; requiring it
      // caused valid Banker/Player settlements to be discarded before Martingale ran.
      .filter(o=>!!orderIdOf(o) && orderSettled(o) && mainBetSlipsOf(o).length>0)
      .sort((a,b)=>orderTimeOf(a)-orderTimeOf(b)); // 舊 → 新，避免短時間多筆結算漏階
    if(!settledMainOrders.length)return;

    // 第一次收到正式報表：把「當下已存在」的本注全部設為基準。
    // 之後只處理真正新出現的 betSn，絕不把歷史下注拿來升降階。
    if(!betReportBaselineReadyRef.current){
      betReportBaselineReadyRef.current=true;
      // 若基準報表剛好撞上 show_win/end：pending gameSn 不能被吃成歷史基準。
      // 其餘既有結算才標記為歷史。
      for(const o of settledMainOrders){
        const id=orderIdOf(o);
        const gs=gameSnOf(o);
        const createdMs=orderTimeOf(o);
        const createdAfterTrackingStarted=
          betTrackingStartedAtRef.current>0 && createdMs>=betTrackingStartedAtRef.current;
        // 兩種情況都不能吃成歷史：
        // 1) show_win/end 已鎖到這個 gameSn；
        // 2) 這筆下注 created_at 明確是在本次連線開始追蹤之後。
        if((gs && pendingSettlementGameSnRef.current.has(gs)) || createdAfterTrackingStarted) continue;
        if(id)processedBetSnRef.current.add(id);
        if(gs)processedGameSnRef.current.add(gs);
      }
      const latest=settledMainOrders[settledMainOrders.length-1];
      lastBetReportOrderRef.current=orderIdOf(latest);
      lastBetReportGameSnRef.current=gameSnOf(latest);
      appendEvent(`馬丁 gameSn 基準完成｜${processedGameSnRef.current.size} 局`);
    }

    // 優先處理 show_win/end 已鎖定的 gameSn；同時保留「基準後新出現 gameSn」作安全網。
    const freshOrders=settledMainOrders.filter(o=>{
      const id=orderIdOf(o);
      const gs=gameSnOf(o);
      if(!id || processedBetSnRef.current.has(id)) return false;
      if(gs && processedGameSnRef.current.has(gs)) return false;
      // Prefer show_win/end gameSn matching when available. If MT omits gameSn
      // from the history order, betSn remains the authoritative de-duplication key.
      return (gs && pendingSettlementGameSnRef.current.has(gs)) || betReportBaselineReadyRef.current;
    });
    if(!freshOrders.length)return;

    for(const target of freshOrders){
      const betSn=orderIdOf(target);
      const gameSn=gameSnOf(target);
      if(!betSn||processedBetSnRef.current.has(betSn)||(gameSn&&processedGameSnRef.current.has(gameSn)))continue;

      const mainSlip=mainBetSlipsOf(target)[0];
      if(!mainSlip)continue;
      const contentName=String(mainSlip?.content_name??mainSlip?.contentName??"").trim();
      if(contentName!=="莊" && contentName!=="閒")continue;

      const side:BetSide=contentName==="閒"?"閒":"莊";
      const amount=Number(String(mainSlip?.bet??"").replace(/,/g,""));
      const refund=Number(String(mainSlip?.refund??mainSlip?.win??"").replace(/,/g,""));
      if(!Number.isFinite(amount)||amount<=0||!Number.isFinite(refund)){
        appendEvent(`馬丁略過 ${gameSn||betSn}｜本注金額解析失敗`);
        continue;
      }

      // 先去重；status=3 已由 orderSettled 過濾。
      processedBetSnRef.current.add(betSn);
      if(gameSn)processedGameSnRef.current.add(gameSn);
      if(gameSn)pendingSettlementGameSnRef.current.delete(gameSn);
      lastBetReportOrderRef.current=betSn;
      lastBetReportGameSnRef.current=gameSn;

      const pnl=refund-amount;
      appendEvent(`馬丁結算｜${gameSn?`gameSn ${gameSn}`:`betSn ${betSn}`}｜${side}｜下注 ${Math.round(amount)}｜返還 ${Math.round(refund)}｜本注 ${pnl>0?"+":""}${Math.round(pnl)}`);

      // 和局/退注：refund === bet，階級完全不變。
      if(Math.abs(pnl)<0.000001){
        appendEvent(`馬丁｜和局/退注｜階級維持`);
        continue;
      }

      const win=pnl>0;
      setBankroll(v=>Math.round(v+pnl));
      setRecords(r=>[{
        side,
        result:(win?side:(side==="閒"?"莊":"閒")) as Result,
        amount:Math.round(amount),
        pnl:Math.round(pnl),
        at:Date.now()
      },...r].slice(0,30));

      if(strategyRef.current==="馬丁"){
        setStrategyLevel(level=>{
          const nextLevel=win?0:level+1;
          const nextStake=baseBetRef.current*(Math.pow(2,nextLevel+1)-1);
          appendEvent(`馬丁階級｜第 ${level+1} 階 → 第 ${nextLevel+1} 階｜下一注 ${Math.round(nextStake).toLocaleString()}`);
          return nextLevel;
        });
      }
    }
  };

  const startConnection=(autoReason?:string,tokenSourceOverride?:string)=>{
    // Once TZ is authenticated, the game socket may ONLY use the MT URL obtained
    // from that TZ session. Manual/state-edited tokens are never accepted.
    const tokenSource=accessGranted?lockedMtUrlRef.current:(tokenSourceOverride||token||mtUrl);
    const authToken=extractMtUrlToken(tokenSource);
    if(!authToken){notify("請貼登入後含 token 的 MT 網址");reconnectingRef.current=false;return}
    if(autoReason){
      // Snapshot/封包可能短暫亂序：只記錄差異，絕不因此斷線重連。
      appendEvent(`牌路同步差異：${autoReason}（保持連線）`);
      reconnectingRef.current=false;
      awaitingFreshSnapshotRef.current=false;
      return;
    }
    // 主頁登入後會自動建立主 WS；若主線仍 OPEN / CONNECTING，直接沿用，禁止重複建立。
    const activeSocket=socketRef.current;
    if(activeSocket && (activeSocket.readyState===WebSocket.OPEN || activeSocket.readyState===WebSocket.CONNECTING)){
      appendEvent("主連線仍有效，不重複連線");
      return;
    }
    awaitingFreshSnapshotRef.current=true;
    // v27: 在 WebSocket 建立前就開始計時。第一包報表即使晚到，
    // 只要下注 created_at >= 這個時間，就必須當成新單結算馬丁。
    betTrackingStartedAtRef.current=Date.now();
    // New manual main-WS session: reset report baseline timing, but keep already processed order IDs.
    betReportBaselineReadyRef.current=false;
    processedGameSnRef.current.clear();
    pendingSettlementGameSnRef.current.clear();
    lastBetReportOrderRef.current="";
    lastBetReportGameSnRef.current="";
    const generation=++socketGenerationRef.current;
    const ws=new WebSocket(wsUrl);
    socketRef.current=ws;
    setSocket(ws);
    let authenticated=false;
    let activeMtTableIds:string[]=[...confirmedMtTableIdsRef.current];
    let subscribedTableSignature="";
    const requestTables=(quiet=false)=>{if(authenticated&&ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify({method:"GET",action:{name:"/api/v1/gametype/*/game/*/room/*/tables",data:{gametype_id:3,game_id:1,room_id:1}}}));if(!quiet)appendEvent("已請求目前真人桌歷史牌局")}};
    const requestSvg=()=>authenticated&&ws.readyState===WebSocket.OPEN&&ws.send(JSON.stringify({method:"POST",action:{name:"/api/v1/gametype/*/game/*/room/*/tablesvg"}}));
    const requestBalance=()=>{
      if(!authenticated||ws.readyState!==WebSocket.OPEN)return;
      try{ws.send(JSON.stringify({method:"POST",action:{name:"/api/v1/member/me/balance"}}))}catch{}
    };
    // 投注報表與牌路共用唯一已驗證的遊戲 WebSocket。
    // 同一 token 不再建立第二條 authenticate 連線，避免 MT 被伺服器踢下線。
    let dealerRefreshTimer:ReturnType<typeof setInterval>|null=null;
    let balanceRefreshTimer:ReturnType<typeof setInterval>|null=null;
    let betReportTimer:ReturnType<typeof setTimeout>|null=null;
    let dataSessionRefreshTimer:ReturnType<typeof setInterval>|null=null;
    let tablesRefreshTimer:ReturnType<typeof setTimeout>|null=null;
    let reportSettlementTimer:ReturnType<typeof setTimeout>|null=null;
    let reportSettlementFollowupTimer:ReturnType<typeof setTimeout>|null=null;
    let svgRefreshTimer:ReturnType<typeof setTimeout>|null=null;
    let subscribeTimer:ReturnType<typeof setTimeout>|null=null;
    let betReportInFlight=false;
    let betReportRequestAt=0;
    // Short-lived settlement sync cycle. We cannot observe the cross-origin MT report UI
    // directly, so after show_win we query the SAME authenticated report endpoint
    // sequentially until its server-side aggregate/order data actually changes.
    let reportSyncActive=false;
    let reportSyncDeadline=0;
    let reportSyncBaselinePnl:number|null=null;
    let reportSyncBaselineProcessed=0;
    let reportSyncTimer:ReturnType<typeof setTimeout>|null=null;
    const memberWinSeen=new Set<string>();

    const isCurrentSocket=()=>socketGenerationRef.current===generation && socketRef.current===ws;
    const startBalanceRefresh=()=>{
      if(balanceRefreshTimer)clearInterval(balanceRefreshTimer);
      balanceRefreshTimer=setInterval(()=>{if(isCurrentSocket())requestBalance()},5000);
    };
    const clearSocketTimers=()=>{
      if(dealerRefreshTimer)clearInterval(dealerRefreshTimer); dealerRefreshTimer=null;
      if(balanceRefreshTimer)clearInterval(balanceRefreshTimer); balanceRefreshTimer=null;
      if(betReportTimer)clearTimeout(betReportTimer); betReportTimer=null;
      if(dataSessionRefreshTimer)clearInterval(dataSessionRefreshTimer); dataSessionRefreshTimer=null;
      if(tablesRefreshTimer)clearTimeout(tablesRefreshTimer); tablesRefreshTimer=null;
      if(reportSettlementTimer)clearTimeout(reportSettlementTimer); reportSettlementTimer=null;
      if(reportSettlementFollowupTimer)clearTimeout(reportSettlementFollowupTimer); reportSettlementFollowupTimer=null;
      if(reportSyncTimer)clearTimeout(reportSyncTimer); reportSyncTimer=null;
      reportSyncActive=false;
      if(svgRefreshTimer)clearTimeout(svgRefreshTimer); svgRefreshTimer=null;
      if(subscribeTimer)clearTimeout(subscribeTimer); subscribeTimer=null;
    };
    // Collapse bursts from all currently available tables into one snapshot request.
    const scheduleTablesRefresh=(delay=700)=>{
      if(tablesRefreshTimer)clearTimeout(tablesRefreshTimer);
      tablesRefreshTimer=setTimeout(()=>{tablesRefreshTimer=null;if(isCurrentSocket())requestTables(true)},delay);
    };
    const scheduleSvgRefresh=(delay=350)=>{
      if(svgRefreshTimer)clearTimeout(svgRefreshTimer);
      svgRefreshTimer=setTimeout(()=>{svgRefreshTimer=null;if(isCurrentSocket())requestSvg()},delay);
    };

    const reportPayload=()=>{
      // Match MT/ROAD X exactly: current LOCAL calendar date with literal Z boundaries.
      // Recomputed for every request, so 00:00 automatically switches to the new day's report.
      const now=new Date();
      const y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,"0"),d=String(now.getDate()).padStart(2,"0");
      const day=`${y}-${m}-${d}`;
      return {
        method:"GET",
        action:{
          game_id:1,
          gametype_id:3,
          name:"/api/v1/gametype/*/game/*/bet/history",
          path:"/api/v1/gametype/3/game/1/bet/history"
        },
        body:{
          begin_at:`${day}T00:00:00.000Z`,
          cur:1,
          end_at:`${day}T23:59:59.000Z`,
          room_id:1,
          s:8,
          table_id:0
        }
      };
    };

    const requestBetReport=()=>{
      if(!authenticated||ws.readyState!==WebSocket.OPEN)return;
      // 只共用現有主 WS，不建立第二條線，也不重新驗證。
      // 報表請求序列化，避免大量請求干擾 MT。
      if(betReportInFlight){
        // Never stack report requests. A missing response may be retried after 2s.
        if(Date.now()-betReportRequestAt<1500)return;
        betReportInFlight=false;
      }
      betReportInFlight=true;
      betReportRequestAt=Date.now();
      try{ws.send(JSON.stringify(reportPayload()))}catch{betReportInFlight=false}
    };

    const scheduleBetReportLoop=(delay=5000)=>{
      if(betReportTimer)clearTimeout(betReportTimer);
      betReportTimer=setTimeout(()=>{
        betReportTimer=null;
        if(isCurrentSocket()&&authenticated&&!betReportInFlight)requestBetReport();
      },Math.max(250,delay));
    };

    const startBetReportRefresh=()=>{
      if(betReportTimer)clearTimeout(betReportTimer);
      betReportTimer=null;
      // ROAD X / MT lifecycle: fetch immediately after authenticate, then response-paced 5s.
      requestBetReport();
    };

    const scheduleSettlementReportProbe=(delay:number)=>{
      if(reportSyncTimer)clearTimeout(reportSyncTimer);
      reportSyncTimer=setTimeout(()=>{
        reportSyncTimer=null;
        if(!isCurrentSocket()||!reportSyncActive)return;
        if(Date.now()>=reportSyncDeadline){reportSyncActive=false;return;}
        requestBetReport();
      },delay);
    };

    const rememberSettlementGameSn=(packet:any)=>{
      const roots=[packet,packet?.body,packet?.msg,packet?.data,packet?.body?.span,packet?.msg?.span];
      for(const x of roots){
        const gs=String(x?.game_sn??x?.gameSn??"").trim();
        if(gs){pendingSettlementGameSnRef.current.add(gs);return gs;}
      }
      return "";
    };
    const refreshBetReportAfterSettlement=(tableId?:string,packet?:any)=>{
      const gs=packet?rememberSettlementGameSn(packet):"";
      appendEvent(`開牌${tableId?` ${tableId}`:""}${gs?`｜gameSn ${gs}`:""} → 觸發正式報表同步`);
      reportSyncActive=true;
      reportSyncDeadline=Date.now()+8000;
      reportSyncBaselinePnl=todayPnlRef.current;
      reportSyncBaselineProcessed=processedBetSnRef.current.size;
      if(reportSyncTimer)clearTimeout(reportSyncTimer);
      reportSyncTimer=null;
      requestBetReport();
      // Same settlement burst used by the proven ROAD X flow.
      scheduleSettlementReportProbe(900);
    };

    const refreshDataSession=()=>{
      if(!isCurrentSocket()||!authenticated||ws.readyState!==WebSocket.OPEN)return;
      // Re-run post-auth DATA initialization on the SAME socket. Never reconnect/re-authenticate.
      requestTables(true);
      setTimeout(()=>{if(isCurrentSocket()&&authenticated)requestSvg()},25);
      setTimeout(()=>{if(isCurrentSocket()&&authenticated)subscribe(true)},50);
      setTimeout(()=>{if(isCurrentSocket()&&authenticated&&!betReportInFlight)requestBetReport()},80);
      setTimeout(()=>{if(isCurrentSocket()&&authenticated)requestBalance()},120);
      setTimeout(()=>{if(isCurrentSocket()&&authenticated&&!betReportInFlight)requestBetReport()},900);
    };

    const startDataSessionRefresh=()=>{
      if(dataSessionRefreshTimer)clearInterval(dataSessionRefreshTimer);
      dataSessionRefreshTimer=setInterval(refreshDataSession,15000);
    };
    const startDealerRefresh=()=>{
      if(dealerRefreshTimer)clearInterval(dealerRefreshTimer);
      // Safety-net metadata refresh only. Live table events still update immediately.
      // 10s keeps membership, dealer metadata and roads current without hammering /tables.
      dealerRefreshTimer=setInterval(()=>{if(isCurrentSocket())requestTables(true)},10000);
    };
    const subscribe=(force=false)=>{
      if(!authenticated||ws.readyState!==WebSocket.OPEN||!activeMtTableIds.length)return;
      const signature=activeMtTableIds.join(",");
      if(!force&&signature===subscribedTableSignature)return;
      ws.send(JSON.stringify({method:"GET",action:{name:"/api/v1/gametype/*/game/*/room/*/mulitple_join",data:{table_id:signature}}}));
      subscribedTableSignature=signature;
      appendEvent(`已訂閱目前 ${activeMtTableIds.length} 桌即時事件`);
    };
    ws.onopen=()=>{if(!isCurrentSocket())return;appendEvent("WebSocket 已連線，正在驗證");ws.send(JSON.stringify({method:"POST",action:{name:"/api/v1/authenticate",path:"/api/v1/authenticate"},body:{type:3,token:authToken}}))};
    ws.onmessage=e=>{if(!isCurrentSocket())return;try{
      const p=JSON.parse(e.data),name=eventName(p);
      // V38 calculator listens passively to MT show_poker; it does not mutate the original assistant.
      if(name.includes("/show_poker")){
        const parsed=parseV38ShowPoker(p);
        if(parsed){
          const prev=v38ByTableRef.current[parsed.tableId];
          const next={...parsed,settled:prev?.shoe===parsed.shoe&&prev?.round===parsed.round?!!prev.settled:false};
          v38ByTableRef.current={...v38ByTableRef.current,[parsed.tableId]:next};
          setV38ByTable(v38ByTableRef.current);
        }
      }
        if(name.includes("/api/v1/member/me/balance")){
          const points=Number(p?.msg?.user?.points??p?.body?.user?.points??p?.data?.user?.points??p?.msg?.points??p?.body?.points??p?.data?.points);
          if(Number.isFinite(points)){
            currentBalanceRef.current=points;
            setCurrentBalance(points);
          }
          return;
        }
        if(isBetReportPayload(p)){
          betReportInFlight=false;
          const reportOrders=readBetReportOrders(p);
          const newest=reportOrders[0];
          appendEvent(`報表回傳｜${reportOrders.length} 筆${newest?`｜最新 ${orderIdOf(newest)||"—"}｜status ${String(newest?.status??"—")}`:""}`);
          const reportTodayPnl=readTodayPnl(p);
          if(reportTodayPnl!==null){
            const changed=todayPnlRef.current!==reportTodayPnl;
            todayPnlRef.current=reportTodayPnl;
            setTodayPnl(reportTodayPnl);
            if(changed)appendEvent(`今日輸贏即時更新｜${reportTodayPnl>0?"+":""}${reportTodayPnl.toLocaleString()}`);
          }else{
            appendEvent("今日輸贏同步｜此報表封包未找到 total.all.w");
          }
          const processedBefore=processedBetSnRef.current.size;
          applyBetReport(p);
          const processedAfter=processedBetSnRef.current.size;
          // Official response re-anchors the display; schedule the next normal refresh from THIS response.
          scheduleBetReportLoop(5000);

          if(reportSyncActive){
            const totalChanged=reportTodayPnl!==null && reportSyncBaselinePnl!==null && reportTodayPnl!==reportSyncBaselinePnl;
            const mainSettlementProcessed=processedAfter>Math.max(processedBefore,reportSyncBaselineProcessed);
            // A newly processed Banker/Player settlement is definitive for Martingale.
            // totalChanged is definitive for 今日輸贏. If only one arrives first, keep
            // probing briefly so the other field can catch up in the same settlement.
            if(mainSettlementProcessed && (totalChanged || reportTodayPnl===null)){
              reportSyncActive=false;
              if(reportSyncTimer)clearTimeout(reportSyncTimer);
              reportSyncTimer=null;
              appendEvent("結算報表已追上｜今日輸贏＋馬丁已同步");
            }else if(Date.now()<reportSyncDeadline){
              scheduleSettlementReportProbe(900);
            }else{
              reportSyncActive=false;
            }
          }
          return;
        }
        if(name.includes("/api/v1/member/me/win")){
          const span=p?.msg?.span??p?.body?.span??p?.span;
          if(span){
            const tableId=String(span?.table_id??"").toUpperCase();
            const shoe=String(span?.shoe??"");
            const round=Number(span?.round)||0;
            const points=Number(span?.points);
            const key=`${tableId}|${shoe}|${round}`;
            rememberSettlementGameSn(p);
            if(Number.isFinite(points)&&!memberWinSeen.has(key)){
              memberWinSeen.add(key);
              // points is whole-round account P/L: use ONLY for immediate total display, never Martingale.
              if(todayPnlRef.current!==null){
                const optimistic=Number(todayPnlRef.current)+points;
                todayPnlRef.current=optimistic;
                setTodayPnl(optimistic);
              }
              appendEvent(`MT 即時結算 ${tableId||"—"} 第${round||"—"}局｜補抓官方報表`);
            }
            setTimeout(()=>{if(isCurrentSocket()&&!betReportInFlight)requestBetReport()},80);
            setTimeout(()=>{if(isCurrentSocket())requestBalance()},120);
            setTimeout(()=>{if(isCurrentSocket()&&!betReportInFlight)requestBetReport()},650);
            setTimeout(()=>{if(isCurrentSocket())requestBalance()},850);
          }
          return;
        }
        if(name.endsWith("/show_win")||name.includes("/show_win")){
          const winTableId=String(p?.table_id??p?.data?.table_id??p?.body?.table_id??"").toUpperCase();
          if(winTableId&&v38ByTableRef.current[winTableId]){
            const old=v38ByTableRef.current[winTableId];
            const settled={...old,settled:old.complete};
            v38ByTableRef.current={...v38ByTableRef.current,[winTableId]:settled};
            setV38ByTable(v38ByTableRef.current);
          }
          refreshBetReportAfterSettlement(winTableId,p);
        }if(name==="/api/v1/authenticate"){if(Number(p?.err)===0){authenticated=true;setConnected(true);appendEvent("authenticate 成功");requestTables();requestBalance();startDealerRefresh();startBalanceRefresh();startBetReportRefresh();startDataSessionRefresh();svgRefreshTimer=setTimeout(()=>{svgRefreshTimer=null;if(isCurrentSocket())requestSvg()},200)}else{setConnected(false);appendEvent("authenticate 失敗")}return}const src=eventTables(p);if(src&&name.endsWith("/tables")){
      const filtered=src.filter(isMtBaccaratTable);
      const retainedIds=collectConfirmedMtTableIds(confirmedMtTableIdsRef.current,filtered);
      confirmedMtTableIdsRef.current=retainedIds;
      activeMtTableIds=[...retainedIds];
      setMtSnapshotReady(true);
      updateLiveTables(c=>{
        // The first complete snapshot after every connection/reconnection is the
        // confirmation source, exactly like a manual reconnect.
        if(awaitingFreshSnapshotRef.current){
          awaitingFreshSnapshotRef.current=false;
          reconnectingRef.current=false;
          reconnectCooldownUntilRef.current=Date.now()+8000;
          appendEvent("重新連線牌路確認完成");
          return reconcileCurrentMtTables(c,filtered,retainedIds);
        }

        // Same connection, same Shoe: reconcile in place. Never reconnect just because
        // a snapshot arrives out of order or is temporarily shorter.
        return reconcileCurrentMtTables(c,filtered,retainedIds);
      });
      subscribe();return}if(src&&name.endsWith("/tablesvg")){
        const filtered=src.filter(isMtBaccaratTable);
        const retainedIds=collectConfirmedMtTableIds(confirmedMtTableIdsRef.current,filtered);
        confirmedMtTableIdsRef.current=retainedIds;
        activeMtTableIds=[...retainedIds];
        updateLiveTables(c=>reconcileCurrentMtTables(c,filtered,retainedIds));
        if(retainedIds.length)setMtSnapshotReady(true);
        subscribe();
        return;
      }if(name.includes("/show_win")){const actual=winnerToRoadResult((p?.body??p?.msg??p?.data??{})?.winner);if(actual)settlePending(actual,p);updateLiveTables(c=>{const reset=resetRoadForNewShoePayload(c,p);return applyDealerRealtime(applyLiveShowWin(reset,p),p)});scheduleTablesRefresh(1200);return}if(name.includes("/table/")&&(name.endsWith("/wait")||name.endsWith("/end"))){
          if(name.endsWith("/end")){
            const endTableId=String(p?.table_id??p?.data?.table_id??p?.body?.table_id??"");
            refreshBetReportAfterSettlement(endTableId,p);
          }
          // wait/end are countdown lifecycle packets. International tables may
          // report round 0/1 before their new road snapshot is ready, so these
          // packets must never clear the currently painted road.
          updateLiveTables(c=>applyDealerRealtime(applyLiveWait(c,p,activeMtTableIds),p));return}}catch{}};
    ws.onerror=()=>{if(!isCurrentSocket())return;setConnected(false);appendEvent("WebSocket 發生錯誤")};
    ws.onclose=()=>{
      clearSocketTimers();
      betReportInFlight=false;
      if(!isCurrentSocket())return;
      socketRef.current=null;
      setSocket(null);
      setConnected(false);
      appendEvent("WebSocket 已中斷");
      // 主頁牌路維持自動連線。若是正常掉線，沿用既有 MT token 自動恢復；
      // stopConnection/logout 會先遞增 generation，因此不會誤觸這裡。
      if(accessGranted&&lockedMtUrlRef.current){
        if(reconnectTimerRef.current)clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current=setTimeout(()=>{
          reconnectTimerRef.current=null;
          startConnection(undefined,lockedMtUrlRef.current);
        },1200);
      }
    };
  };


  const ensureDgAuthorization=async(force=false)=>{
    const platformToken=platformTokenRef.current;
    if(!platformToken)throw new Error("登入授權已失效");
    if(!force&&dgGameUrlRef.current)return dgGameUrlRef.current;
    if(dgAuthPromiseRef.current)return dgAuthPromiseRef.current;
    const promise=getDgLoginUrlFromPlatform(loginPlatform,platformToken).then(url=>{
      if(platformTokenRef.current!==platformToken)throw new Error("登入工作階段已變更");
      dgGameUrlRef.current=url;
      dgLastAuthAtRef.current=Date.now();
      dgSameTokenRetryRef.current=0;
      setDgGameUrl(url);
      setDgStatus("連線中");
      return url;
    }).finally(()=>{
      if(dgAuthPromiseRef.current===promise)dgAuthPromiseRef.current=null;
    });
    dgAuthPromiseRef.current=promise;
    return promise;
  };

  const connectRoadDashboard=async(force=false)=>{
    if(!accessGranted||!accessSessionId||roadConnectBusyRef.current)return;
    const platformToken=platformTokenRef.current;
    if(!platformToken)return;
    roadConnectBusyRef.current=true;
    suppressDgRecoveryRef.current=false;
    if(force){
      if(reconnectTimerRef.current){clearTimeout(reconnectTimerRef.current);reconnectTimerRef.current=null}
      socketGenerationRef.current+=1;
      const old=socketRef.current;socketRef.current=null;
      try{old?.close()}catch{}
      setSocket(null);
      setConnected(false);
      try{dgControllerRef.current?.close()}catch{}
      dgControllerRef.current=null;
      await stopDgRelayServer(accessSessionId);
      setDgConnected(false);
      setDgStatus("連線中");
    }else{
      if(!connected)setConnected(false);
      if(!dgConnected)setDgStatus("連線中");
    }
    const needMt=force||!lockedMtUrlRef.current||!connected;
    const needDg=force||!dgGameUrl||!dgConnected;
    const [mtResult,dgResult]=await Promise.allSettled([
      needMt?getMtLoginUrlFromPlatform(loginPlatform,platformToken):Promise.resolve(lockedMtUrlRef.current),
      needDg?ensureDgAuthorization(force):Promise.resolve(dgGameUrlRef.current||dgGameUrl),
    ]);
    if(platformTokenRef.current!==platformToken){roadConnectBusyRef.current=false;return;}
    if(mtResult.status==="fulfilled"&&mtResult.value){
      const url=mtResult.value;
      lockedMtUrlRef.current=url;
      setToken(url);
      setMtUrl(url);
      startConnection(undefined,url);
    }else if(mtResult.status==="rejected"){
      appendEvent(`MT 自動連線失敗：${String((mtResult.reason as any)?.message||mtResult.reason||"unknown")}`);
    }
    if(dgResult.status==="fulfilled"&&dgResult.value){
      dgGameUrlRef.current=dgResult.value;
      setDgGameUrl(dgResult.value);
      setDgStatus("連線中");
    }else if(dgResult.status==="rejected"){
      setDgConnected(false);
      setDgStatus("連線中");
      appendEvent(`DG 自動連線失敗：${String((dgResult.reason as any)?.message||dgResult.reason||"unknown")}`);
    }
    roadConnectBusyRef.current=false;
  };

  // DG-only same-session web proxy. When the real DG game opens we stop only
  // the competing Render Chromium transport, then load DG through our same-origin
  // proxy. The foreground game's own WebSocket is tunneled once and mirrored into
  // the existing DG relay, so the floating assistant keeps receiving the SAME data.
  const enterDgSameSessionProxy=async(gameUrl:string)=>{
    if(!accessSessionId||!gameUrl)return "";
    try{
      const r=await fetch("/api/dg/proxy/enter",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:accessSessionId,gameUrl})});
      let data:any=null;try{data=await r.json()}catch{}
      if(!r.ok||!data?.ok||!data?.url)throw new Error(String(data?.error||"DG 單工作階段入口啟動失敗"));
      dgBridgeActiveRef.current=true;
      // Entering the foreground DG proxy reuses the existing relay/SSE.
      // Do not force the floating assistant offline here: its status must stay
      // driven by the relay's real connected/error/closed events.
      setDgNeedsRecovery(false);
      return String(data.url);
    }catch(error:any){
      dgBridgeActiveRef.current=false;
      throw new Error(error?.message||"DG 單工作階段入口啟動失敗");
    }
  };

  const leaveDgSameSessionProxy=async()=>{
    if(!dgBridgeActiveRef.current||!accessSessionId)return;
    dgBridgeActiveRef.current=false;
    // Leaving the game view does not close the background relay either. Keep
    // the last genuine SSE status until the relay reports a state transition.
    try{await fetch("/api/dg/proxy/leave",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:accessSessionId})})}catch{}
  };

  // 一進牌路主頁就自動連 MT / DG，跟舊版一樣。
  // 這裡只負責牌路資料連線；MT平台 / DG平台按鈕仍然是另外的遊戲入口。
  useEffect(()=>{
    if(!accessGranted||!accessSessionId)return;
    void connectRoadDashboard(false);
  },[accessGranted,accessSessionId,loginPlatform]);

  // DG relay follows the automatically obtained background DG URL.
  useEffect(()=>{
    if(!accessGranted)return;
    setDgTodayPnl(null);
    if(!dgGameUrl){setDgConnected(false);return;}
    let cancelled=false;
    try{dgControllerRef.current?.close()}catch{}
    dgControllerRef.current=null;
    setDgConnected(false);
    setDgStatus("連線中");
    connectDgLive(dgGameUrl,accessSessionId,{
      onPnl:(report)=>{if(!cancelled)setDgTodayPnl(report)},
      onTables:(next:DgTableData[])=>{if(!cancelled)setDgTables(next as TableData[])},
      onStatus:(status,message)=>{
        if(cancelled)return;
        const online=status==="connected";
        setDgConnected(online);
        setDgStatus(online?"已連線":"連線中");
        if(online){
          dgHasConnectedRef.current=true;
          setDgNeedsRecovery(false);
        }else if(status==="error"||status==="closed"){
          setDgNeedsRecovery(true);
          if(message)appendEvent(`DG 背景連線待恢復：${message}`);
        }
      },
      onEvent:(message)=>{if(!cancelled)appendEvent(message)},
    }).then(controller=>{
      if(cancelled){controller.close();return;}
      dgControllerRef.current=controller;
    }).catch((error:any)=>{
      if(cancelled)return;
      setDgConnected(false);
      setDgStatus("連線中");
      setDgNeedsRecovery(true);
      appendEvent(`DG 背景連線待恢復：${error?.message||"unknown"}`);
    });
    return()=>{
      cancelled=true;
      try{dgControllerRef.current?.close()}catch{}
      dgControllerRef.current=null;
    };
  },[accessGranted,accessSessionId,dgGameUrl,dgConnectEpoch]);

  // 如果 DG 原生遊戲把背景 relay 踢掉：先用「同一個已取得的 DG token」
  // 重掛一次背景 relay，不再呼叫 DGLI/login 取得第二組 token。這樣可避免
  // 因為新遊戲登入把原本牌路工作階段直接作廢。若同 token 仍被平台限制，
  // 遊戲開著時不無限互踢；回牌路後再走正式重新授權。
  // 回到牌路主頁後再自動重新授權並恢復。
  useEffect(()=>{
    if(!accessGranted||walletTransferBusy||!dgNeedsRecovery||suppressDgRecoveryRef.current||dgBridgeActiveRef.current)return;
    if(!dgGameUrl)return;
    let cancelled=false;

    // DG 真實遊戲開著時，先只重掛一次「同 token」relay。這個動作不會重新
    // 呼叫 TZ 的 DGLI/login，因此不會再建立另一組遊戲授權。
    if(mtOpen&&gameViewPlatform==="DG"){
      if(dgForegroundRecoveryAttemptRef.current>=1)return;
      const timer=setTimeout(()=>{
        if(cancelled)return;
        dgForegroundRecoveryAttemptRef.current+=1;
        setDgNeedsRecovery(false);
        setDgStatus("連線中");
        setDgConnectEpoch(v=>v+1);
        appendEvent("DG 遊戲中使用原工作階段恢復牌路連線");
      },1200);
      return()=>{cancelled=true;clearTimeout(timer)};
    }

    // 主頁斷線時先重用 SAME DG token，避免短時間內再次 DGLI/login
    // 產生另一組遊戲工作階段。只有同 token 已重試多次且原授權已超過
    // 冷卻時間，才允許真正重新授權。
    const authAge=Date.now()-dgLastAuthAtRef.current;
    const canFreshAuth=dgSameTokenRetryRef.current>=3&&authAge>90000;
    const retryDelay=Math.min(15000,2500+dgSameTokenRetryRef.current*2500);
    const timer=setTimeout(()=>{
      if(cancelled)return;
      setDgStatus("連線中");
      setDgNeedsRecovery(false);
      if(!canFreshAuth){
        dgSameTokenRetryRef.current+=1;
        setDgConnectEpoch(v=>v+1);
        appendEvent(`DG 使用原工作階段重連（${dgSameTokenRetryRef.current}/3）`);
        return;
      }
      ensureDgAuthorization(true).then(()=>{
        if(cancelled)return;
        dgForegroundRecoveryAttemptRef.current=0;
        setDgNeedsRecovery(false);
        setDgConnectEpoch(v=>v+1);
        appendEvent("DG 原工作階段長時間無法恢復，已重新授權一次");
      }).catch((error:any)=>{
        if(cancelled)return;
        setDgStatus("連線中");
        appendEvent(`DG 自動恢復失敗：${error?.message||"unknown"}`);
      });
    },retryDelay);
    return()=>{cancelled=true;clearTimeout(timer)};
  },[accessGranted,mtOpen,gameViewPlatform,walletTransferBusy,dgNeedsRecovery,loginPlatform,dgGameUrl]);

  // Reuse the existing four-formula / parity floating tools with DG's live poker field.
  // This only updates when the actual dealt cards change, not on every countdown packet.
  useEffect(()=>{
    if(activePlatform!=="DG"||!dgTables.length)return;
    let changed=false;
    const nextMap={...v38ByTableRef.current};
    for(const table of dgTables as DgTableData[]){
      const parsed=parseDgV38Poker(table);
      if(!parsed)continue;
      const prev=nextMap[parsed.tableId];
      const same=prev&&prev.shoe===parsed.shoe&&prev.round===parsed.round&&prev.result.join(",")===parsed.result.join(",");
      if(same)continue;
      nextMap[parsed.tableId]={...parsed,settled:prev?.shoe===parsed.shoe&&prev?.round===parsed.round?!!prev.settled:false};
      changed=true;
    }
    if(changed){v38ByTableRef.current=nextMap;setV38ByTable(nextMap)}
  },[activePlatform,dgTables]);

  useEffect(()=>{
    const exists=tables.some(t=>(t.apiId??`BAG${t.id}`)===assistTableId);
    if(!exists&&tables.length)setAssistTableId(tables[0].apiId??tables[0].id);
  },[activePlatform,tables.length]);
  const stopConnection=()=>{
    if(reconnectTimerRef.current){clearTimeout(reconnectTimerRef.current);reconnectTimerRef.current=null}
    reconnectingRef.current=false;
    awaitingFreshSnapshotRef.current=false;
    socketGenerationRef.current+=1;
    const ws=socketRef.current;
    socketRef.current=null;
    try{ws?.close()}catch{}
    setSocket(null);
    setConnected(false);
    appendEvent("已手動中斷");
  };
  const logoutSession=()=>{
    // Logout is intentionally synchronous on the client: switch to AccessScreen first.
    // Server session revocation is fire-and-forget so it can never block the screen change.
    const sessionToLogout=accessSessionId;
    void stopDgRelayServer(sessionToLogout);
    setAccessGranted(false);
    setAccessSessionId("");
    setAccessNotice("");
    if(reconnectTimerRef.current){clearTimeout(reconnectTimerRef.current);reconnectTimerRef.current=null}
    reconnectingRef.current=false;
    awaitingFreshSnapshotRef.current=false;
    socketGenerationRef.current+=1;
    const ws=socketRef.current;
    socketRef.current=null;
    try{ws?.close()}catch{}
    setSocket(null);
    setConnected(false);
    try{dgControllerRef.current?.close()}catch{}
    dgControllerRef.current=null;
    setDgConnected(false);
    setDgStatus("未連線");
    dgGameUrlRef.current=""; dgAuthPromiseRef.current=null; dgLastAuthAtRef.current=0; dgSameTokenRetryRef.current=0;
    dgFreshAuthorizationRequiredRef.current=false;
    setDgGameUrl("");
    setDgTables([]);
    platformTokenRef.current="";
    setActivePlatform("MT");
    setConnectionOpen(false);
    setHelpOpen(false);
    setRadarOpen(false);
    setRadarDetailId(null);
    setAnalysisTable(null);
    setFloatingOpen(false);
    setMtOpen(false);
    setInsideMt(false);
    resetStopLossForLogout();
    setToken("");
    setMtUrl("");
    lockedMtUrlRef.current="";
    setHasEnteredGame(false);
    setDgWasOpened(false);
    setGameViewUrl("");
    setPlatformLaunching(false);
    setWalletTransferOpen(false);
    setWalletTransferBusy(false);
    setDgNeedsRecovery(false);
    dgHasConnectedRef.current=false;
    dgForegroundRecoveryAttemptRef.current=0;
    dgBridgeActiveRef.current=false;
    suppressDgRecoveryRef.current=false;
    roadConnectBusyRef.current=false;
    // Revoke the server-side app session without awaiting it. The login screen is already active.
    if(sessionToLogout){void logoutAccess.mutateAsync({sessionId:sessionToLogout}).catch(()=>{});}
  };
  const syncAssist=()=>{
    if(activePlatform==="DG"){if(dgConnected)appendEvent("DG 懸浮輔助已同步即時資料");else notify("DG 尚未連線");return;}
    const ws=socketRef.current;if(ws?.readyState===WebSocket.OPEN){ws.send(JSON.stringify({method:"POST",action:{name:"/api/v1/gametype/*/game/*/room/*/tablesvg"}}));appendEvent("懸浮輔助已要求同步")}else notify("尚未連線")
  };
  const openCurrentPlatform=async(table?:TableData)=>{
    if(table)setAssistTableId(table.apiId??table.id);
    if(platformLaunching)return;
    const platformToken=platformTokenRef.current;
    if(!platformToken){notify("登入授權已失效，請重新登入");return;}
    setPlatformLaunching(true);
    try{
      if(activePlatform==="MT"){
        const url=await getMtLoginUrlFromPlatform(loginPlatform,platformToken);
        // A fresh MTLI login can issue a new MT token. Replace the old main-data
        // socket instead of authenticating twice with two tokens.
        socketGenerationRef.current+=1;
        const old=socketRef.current; socketRef.current=null;
        try{old?.close()}catch{}
        setSocket(null); setConnected(false);
        lockedMtUrlRef.current=url;
        setToken(url);
        setMtUrl(url);
        startConnection(undefined,url);
        setGameViewPlatform("MT");
        setGameViewUrl(url);
      }else{
        // DG 平台直接沿用牌路主頁已經取得、正在使用的同一組 DG 授權網址。
        // 不再按一次 DG平台就重新呼叫 DGLI/login，避免第二組 token 讓背景
        // Chromium / WebSocket 被 DG 判定為舊 session 而斷線。只有主頁尚未
        // 取得 DG 授權時，才補取一次並同時交給牌路 relay 使用。
        const needsWalletReentry=dgFreshAuthorizationRequiredRef.current;
        let url=dgGameUrlRef.current||dgGameUrl;
        if(needsWalletReentry){
          // The user explicitly transferred every game wallet back to main.
          // Retire the old DG relay/token first, then obtain exactly one fresh
          // DGLI launch. That login is what moves the main-wallet balance back
          // into DG; afterwards the foreground page and floating assistant
          // share this new single session as usual.
          if(dgBridgeActiveRef.current)await leaveDgSameSessionProxy();
          try{dgControllerRef.current?.close()}catch{}
          dgControllerRef.current=null;
          await stopDgRelayServer(accessSessionId);
          setDgConnected(false);
          setDgStatus("連線中");
          dgGameUrlRef.current="";
          setDgGameUrl("");
          url=await ensureDgAuthorization(true);
          const start=await fetch("/api/dg/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:accessSessionId,gameUrl:url})});
          let startData:any=null;try{startData=await start.json()}catch{}
          if(!start.ok||!startData?.ok)throw new Error(String(startData?.error||"DG 新工作階段啟動失敗"));
        }else if(!url)url=await ensureDgAuthorization(false);
        suppressDgRecoveryRef.current=false;
        dgForegroundRecoveryAttemptRef.current=0;
        setDgWasOpened(true);
        setDgNeedsRecovery(false);
        // DG ONLY: switch the existing relay into foreground-proxy mode BEFORE
        // opening the game. No second DG login/Chromium session is allowed here.
        // The proxied DG page's one real WebSocket also feeds the floating assistant.
        const proxyUrl=Platform.OS==="web"?await enterDgSameSessionProxy(url):url;
        dgFreshAuthorizationRequiredRef.current=false;
        setGameViewPlatform("DG");
        setGameViewUrl(proxyUrl||url);
      }
      setHasEnteredGame(true);
      setMtOpen(true);
    }catch(error:any){
      notify(error?.message||`取得 ${activePlatform} 平台授權失敗`);
    }finally{setPlatformLaunching(false)}
  };
  const closeGameView=()=>{
    const wasDg=gameViewPlatform==="DG";
    setMtOpen(false);
    if(wasDg&&dgBridgeActiveRef.current) void leaveDgSameSessionProxy();
  };

  const confirmTransferAll=()=>{
    if(!hasEnteredGame){notify("請先進入 MT 或 DG 平台");return;}
    setWalletTransferOpen(true);
  };
  const executeTransferAll=async()=>{
    if(walletTransferBusy)return;
    const platformToken=platformTokenRef.current;
    if(!platformToken){notify("登入授權已失效，請重新登入");return;}
    setWalletTransferBusy(true);
    try{
      const result=await transferAllToMainWallet(loginPlatform,platformToken);
      if(result.ok){
        // 轉回後不要關掉目前正在收牌路的 relay；只禁止「重新登入 DG」的自動恢復，
        // 避免剛轉回主錢包又因新的 DGLI/login 被平台自動轉回 DG。
        suppressDgRecoveryRef.current=true;
        dgFreshAuthorizationRequiredRef.current=true;
        setDgNeedsRecovery(false);
        notify("轉回成功");setWalletTransferOpen(false);
      }
      else if(result.empty){notify("目前無可轉回點數");setWalletTransferOpen(false);}
      else notify(result.message||"轉回失敗");
    }catch(error:any){notify(error?.message||"轉回失敗");}
    finally{setWalletTransferBusy(false)}
  };
  const action=(kind:string,table:TableData)=>{if(kind==="平台")void openCurrentPlatform(table);else if(kind==="分析")setAnalysisTable(table);else notify(`已關注百家樂 ${table.id}`)};
  const actionRef=useRef(action);
  actionRef.current=action;
  const stableTableAction=useMemo(()=>(kind:string,table:TableData)=>actionRef.current(kind,table),[]);
  const placeManualBet=(side:BetSide)=>{if(pendingBet){notify("上一筆仍在等待開獎");return}if(nextAmount<=0){notify("請先設定基本單注");return}setPendingBet({tableId:assistTableId,side,amount:nextAmount});appendEvent(`統計下注 ${assistTableId}：${side} ${nextAmount}`);setAssistPage(2)};
  const resetStats=()=>{setBankroll(initialBankroll);setPeakBankroll(initialBankroll);setStrategyLevel(0);setLabSequence([1,2,3,4]);setPendingBet(null);setRecords([])};
  const wins=records.filter(r=>r.pnl>0).length,losses=records.filter(r=>r.pnl<0).length,decisions=wins+losses;
  let streak=0;if(records.length){const win=records[0].pnl>0,loss=records[0].pnl<0;if(win||loss){for(const r of records){if((win&&r.pnl>0)||(loss&&r.pnl<0))streak++;else break}}}
  const maxDrawdown=Math.max(0,peakBankroll-bankroll);

  const MultiTableRadar=({insideMt=false}:{insideMt?:boolean})=>{
    // Keep the current best table at the first position on both desktop and mobile.
    const signals=[...radarSignals].sort((a,b)=>{
      if(a.id===bestRadar?.id)return -1;
      if(b.id===bestRadar?.id)return 1;
      return 0;
    });
    const renderRadarCard=(item:(typeof radarSignals)[number])=>{
      const best=item.id===bestRadar?.id;
      const state=confidenceState(item.confidence);
      return <Pressable key={item.id} onPress={()=>{setAssistTableId(item.id);setRadarDetailId(item.id)}} style={[s.radarCard,!desktop&&s.radarCardMobile,best&&s.radarCardBest]}>
        <View style={s.radarCardTop}><Text style={s.radarRoom}>{item.id}</Text>{best?<Text style={s.radarPick}>首選</Text>:null}</View>
        <View style={s.radarCardMain}>
          <View style={s.radarSideLine}><View style={[s.signalDot,{backgroundColor:item.ready?state.color:"#5D6C78",shadowColor:item.ready?state.color:"transparent"}]}/><Text style={[s.radarSide,{color:item.ready?resultColor(item.decision.side):"#7B8B96"}]}>{item.ready?item.decision.side:"等待"}</Text></View>
          <Text style={[s.radarConfidenceText,{color:item.ready?state.color:"#687680"}]}>{item.ready?state.label:"等待"}</Text>
        </View>
      </Pressable>;
    };
    if(!radarOpen){
      const bestState=bestRadar?confidenceState(bestRadar.confidence):null;
      return <Animated.View {...radarResponder.panHandlers} style={[s.radarLauncher,insideMt&&s.radarLauncherMt,!desktop&&s.radarLauncherMobile,{transform:radarPosition.getTranslateTransform()}]}>
        <MaterialIcons name="radar" size={15} color="#63C7FF"/>
        <Text style={s.radarLauncherText}>多桌雷達</Text>
        {bestRadar&&bestState?<View style={s.radarLauncherBestWrap}><View style={[s.signalDotSmall,{backgroundColor:bestState.color,shadowColor:bestState.color}]}/><Text style={[s.radarLauncherBest,{color:resultColor(bestRadar.decision.side)}]}>{bestRadar.id} · {bestRadar.decision.side}</Text></View>:null}
      </Animated.View>;
    }
    const mobileColumns:Array<Array<(typeof radarSignals)[number]>>=[];
    if(!desktop){for(let i=0;i<signals.length;i+=2)mobileColumns.push(signals.slice(i,i+2));}
    return <View style={[s.radarPanel,insideMt&&s.radarPanelMt,!desktop&&s.radarPanelMobile]}>
      <View style={s.radarHead}><View><Text style={s.radarKicker}>MT MATRIX · MULTI-TABLE RADAR</Text><Text style={s.radarTitle}>多桌雷達</Text></View><Pressable onPress={()=>setRadarOpen(false)} style={s.radarClose}><MaterialIcons name="keyboard-arrow-up" size={20} color="#DCEEFF"/></Pressable></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.radarRail,!desktop&&s.radarRailMobile]}>
        {desktop?signals.map(renderRadarCard):mobileColumns.map((column,i)=><View key={`radar-col-${i}`} style={s.radarMobileColumn}>{column.map(renderRadarCard)}</View>)}
      </ScrollView>
    </View>;
  };

  const FloatingAssistant=({insideMt=false}:{insideMt?:boolean})=>{
    const glow=latest?resultColor(latest):"#5A6B78";
    const page1=<View {...pageSwipe.panHandlers} style={s.assistPage}>
      <View style={s.decisionRow}><View style={s.decisionBox}><Text style={s.smallLabel}>最近</Text><View style={s.latestLine}><View style={[s.glowDot,{backgroundColor:glow,shadowColor:glow}]}/><Text style={[s.latestText,{color:glow}]}>{latest??"—"}</Text></View></View><View style={s.decisionBox}><Text style={s.smallLabel}>牌型</Text><Text style={s.detectText}>{detectPattern(assistTable?.results??[])}</Text></View><View style={s.decisionBox}><View style={s.recommendHeader}><View style={s.recommendTitleConfidence}><Text style={s.smallLabel}>推薦下注</Text><View style={[s.signalDotSmall,{backgroundColor:assistConfidenceState.color,shadowColor:assistConfidenceState.color}]}/><Text numberOfLines={1} style={[s.confidenceText,{color:assistConfidenceState.color,textShadowColor:assistConfidenceState.color}]}>{assistConfidenceState.label}</Text></View><Pressable onPress={()=>{setStrategyLevel(0);appendEvent(`${strategy}已手動重置至第 1 階`)}} style={s.martinResetMini}><Text style={s.martinResetMiniText}>重置</Text></Pressable></View><Text style={[s.recommendText,{color:resultColor(recommendation)}]}>{recommendation} {nextAmount.toLocaleString()}</Text><View style={s.recommendMetaRow}><Text style={[s.microText,s.recommendStrategyMeta]}>{strategy}｜第 {strategyLevel+1} 階｜下一注 {nextAmount.toLocaleString()}</Text></View></View></View>
      <View style={s.todayPnlBox}><Text style={s.smallLabel}>今日輸贏</Text><Text style={[s.todayPnlValue,{color:activeTodayPnl===null?"#FFFFFF":activeTodayPnl>0?"#4ED58B":activeTodayPnl<0?"#FF6973":"#FFFFFF"}]}>{activeTodayPnl===null?"—":`${activeTodayPnl>0?"+":""}${activeTodayPnl.toLocaleString()}`}</Text></View>
      <View style={s.aiBox}><View style={s.aiHead}><Text style={s.aiTitle}>AI分析</Text><Pressable style={({pressed}:any)=>[s.stopLossMiniBtn,pressed&&s.stopLossMiniBtnPressed]} onPress={openStopLossSettings}><Text style={s.stopLossMiniBtnText}>止損設定</Text></Pressable></View><Text style={s.aiText}>{analysisText(assistTable)}</Text></View>
    </View>;
    const page2=<View {...pageSwipe.panHandlers} style={s.assistPage}><View style={s.moneyGrid}><View style={s.fieldBox}><Text style={s.smallLabel}>目前本金</Text><TextInput keyboardType="numeric" value={String(bankroll)} onChangeText={v=>{const n=Math.max(0,Number(v)||0);setBankroll(n)}} style={s.moneyInput}/></View><View style={s.fieldBox}><Text style={s.smallLabel}>基本單注</Text><TextInput keyboardType="numeric" value={String(baseBet)} onChangeText={v=>setBaseBet(Math.max(0,Number(v)||0))} style={s.moneyInput}/></View><View style={s.fieldBox}><Text style={s.smallLabel}>下一注</Text><Text style={s.nextAmount}>{nextAmount.toLocaleString()}</Text></View></View><ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.strategyScroll} contentContainerStyle={s.strategyRow}>{strategies.map(x=><Pressable key={x} style={[s.strategyChip,strategy===x&&s.strategyChipActive]} onPress={()=>{setStrategy(x);setStrategyLevel(0)}}><Text style={[s.strategyChipText,strategy===x&&{color:"#fff"}]}>{x}</Text></Pressable>)}</ScrollView><View style={s.progressBox}><Text style={s.smallLabel}>策略進度</Text><Text style={s.progressText}>{strategy} · 第 {strategyLevel+1} 階　→　下一注 {nextAmount.toLocaleString()}</Text></View></View>;
    const page3=<View {...pageSwipe.panHandlers} style={s.assistPage}><View style={s.betButtons}><Pressable style={[s.betBtn,{backgroundColor:"#B8323B"}]} onPress={()=>placeManualBet("莊")}><Text style={s.betBtnText}>本局莊</Text></Pressable><Pressable style={[s.betBtn,{backgroundColor:"#1764C0"}]} onPress={()=>placeManualBet("閒")}><Text style={s.betBtnText}>本局閒</Text></Pressable><Pressable style={[s.betBtn,{backgroundColor:"#238A4B"}]} onPress={()=>placeManualBet("和")}><Text style={s.betBtnText}>和局</Text></Pressable></View><View style={s.statsGrid}><View><Text style={s.smallLabel}>目前本金</Text><Text style={s.statsValue}>{bankroll.toLocaleString()}</Text></View><View><Text style={s.smallLabel}>總損益</Text><Text style={[s.statsValue,{color:bankroll-initialBankroll>=0?"#4ED58B":"#FF6973"}]}>{(bankroll-initialBankroll>=0?"+":"")+(bankroll-initialBankroll).toLocaleString()}</Text></View><View><Text style={s.smallLabel}>勝 / 負</Text><Text style={s.statsValue}>{wins} / {losses}</Text></View><View><Text style={s.smallLabel}>勝率</Text><Text style={s.statsValue}>{decisions?((wins/decisions)*100).toFixed(1):"0.0"}%</Text></View></View><View style={s.recordBar}><Text style={s.microText}>{pendingBet?`等待開獎：${pendingBet.side} ${pendingBet.amount.toLocaleString()}`:`連${records[0]?.pnl>0?"勝":records[0]?.pnl<0?"敗":"續"} ${streak}　最大回撤 -${maxDrawdown.toLocaleString()}`}</Text><Pressable onPress={resetStats}><Text style={s.resetText}>重置統計</Text></Pressable></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.historyRow}>{records.slice(0,8).map((r,i)=><View key={i} style={s.historyChip}><Text style={{color:r.pnl>=0?"#53D990":"#FF7079",fontSize:9,fontWeight:"800"}}>{r.side} {r.pnl>=0?"+":""}{r.pnl.toLocaleString()}</Text></View>)}</ScrollView></View>;
    if(!floatingOpen)return null;
    return <Animated.View onLayout={(e:any)=>{const l=e.nativeEvent?.layout;if(l?.width&&l?.height){panelSizeRef.current={width:l.width,height:l.height}}}} style={[s.floatPanel,!desktop?s.floatPanelMobile:null,{width:panelBaseWidth},insideMt?s.floatPanelMt:null,Platform.OS==="web"?({overscrollBehavior:"contain",transformOrigin:"top left"} as any):null,{transform:!desktop?[...panelPosition.getTranslateTransform(),{scale:panelMobileScale}]:panelPosition.getTranslateTransform()}]}>
      <View style={[s.floatHeader,Platform.OS==="web"?({touchAction:"none",userSelect:"none",WebkitUserSelect:"none"} as any):null]} {...panelDrag.panHandlers}><View style={s.floatHeadLeft}><MatrixMark size={25} brand={activePlatform}/><View><View style={s.floatBrandLine}><Text style={s.floatTitle}>MATRIX ASSIST</Text><Text style={s.floatStatus}>{activeConnected?`● ${activePlatform} LIVE`:`● ${activePlatform} OFFLINE`}</Text></View><ThreadsSignature/></View></View><View style={s.row}><Pressable onPress={syncAssist} style={s.iconTextBtn}><MaterialIcons name="sync" size={15} color="#fff"/><Text style={s.iconText}>同步</Text></Pressable><Pressable onPress={()=>setV38Open(v=>!v)} style={[s.iconTextBtn,v38Open&&s.v38LaunchActive]}><MaterialIcons name="calculate" size={15} color="#fff"/><Text style={s.iconText}>算牌</Text></Pressable><Pressable onPress={()=>setTerminalParityOpen(v=>!v)} style={[s.iconTextBtn,terminalParityOpen&&s.v38LaunchActive]}><MaterialIcons name="functions" size={15} color="#fff"/><Text style={s.iconText}>奇偶</Text></Pressable><Pressable onPress={()=>setFloatingOpen(false)} style={s.iconBtn}><MaterialIcons name="close" size={18} color="#fff"/></Pressable></View></View>
      <View style={s.selectorWrap}>
        <Pressable style={s.selector} onPress={()=>{
          if(roomDropdownOpen){ roomDropdownOpenRef.current=false; setRoomDropdownOpen(false); }
          else { setRoomMenuTables(tables.map(t=>({...t,results:[...t.results]}))); roomDropdownOpenRef.current=true; setRoomDropdownOpen(true); }
        }}>
          <View style={s.selectorLeft}>
            <Text style={s.selectorValue}>{assistTableId}</Text>
            <MaterialIcons name={roomDropdownOpen?"keyboard-arrow-up":"keyboard-arrow-down"} size={18} color="#DCE8F0"/>

          </View>
          <Text style={s.selectorMeta}>{assistTable?.name||"荷官 —"} · 第 {assistTable?.round??0} 局</Text>
        </Pressable>
        {roomDropdownOpen?<View style={s.roomDropdown}>
          <ScrollView
            ref={roomDropdownScrollRef}
            style={[s.roomDropdownScroll,Platform.OS==="web"?({overflowY:"auto",overscrollBehavior:"contain",touchAction:"pan-y",WebkitOverflowScrolling:"touch"} as any):null]}
            contentContainerStyle={s.roomDropdownContent}
            nestedScrollEnabled
            scrollEnabled
            directionalLockEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            scrollEventThrottle={16}
            onScrollBeginDrag={()=>{roomDropdownOpenRef.current=true}}
            onScroll={(e:any)=>{roomDropdownOffsetRef.current=e.nativeEvent?.contentOffset?.y??roomDropdownOffsetRef.current}}
            onWheel={(e:any)=>{e.stopPropagation?.()}}
          >
            {roomMenuTables.map(t=>{
              const id=t.apiId??`BAG${t.id}`;
              // Confidence is read from the live radar signal, not the frozen room-menu snapshot.
              const liveSignal=radarSignals.find(x=>x.id===id);
              const roomReady=liveSignal?.ready??false;
              const roomState=confidenceState(liveSignal?.confidence??0);
              return <Pressable key={id} style={[s.roomDropdownItem,id===assistTableId&&s.roomDropdownItemActive]} onPress={()=>{setAssistTableId(id);roomDropdownOpenRef.current=false;setRoomDropdownOpen(false);setRoomMenuTables([])}}>
                <View style={s.roomDropdownLeft}><Text style={s.roomDropdownText}>{id}</Text><Text numberOfLines={1} style={s.roomDropdownDealer}>荷官 {t.name||"—"}</Text></View>
                <View style={s.roomDropdownRight}>
                  <View style={s.roomConfidence}>
                    <View style={[s.signalDotSmall,{backgroundColor:roomReady?roomState.color:"#5D6C78",shadowColor:roomReady?roomState.color:"transparent"}]}/>
                    <Text style={[s.roomConfidenceText,{color:roomReady?roomState.color:"#7B8B96",textShadowColor:roomReady?roomState.color:"transparent"}]}>{roomReady?roomState.label:"等待"}</Text>
                  </View>
                  <Text style={s.roomDropdownMeta}>第 {t.round??0} 局</Text>
                </View>
              </Pressable>
            })}
          </ScrollView>
        </View>:null}
      </View>
      {assistPage===0?page1:assistPage===1?page2:page3}<View style={s.pageDots}>{[0,1,2].map(i=><Pressable key={i} onPress={()=>setAssistPage(i)}><View style={[s.pageDot,assistPage===i&&s.pageDotActive]}/></Pressable>)}</View>
    </Animated.View>;
  };


  const TerminalParityModel=({insideMt=false}:{insideMt?:boolean})=>{
    if(!terminalParityOpen)return null;
    const data=v38ByTable[assistTableId];
    // Preserve MT's actual deal order: P1, B1, P2, B2, optional P3, optional B3.
    const dealt:string[]=[];
    if(data){
      const r=data.result;
      [0,1,2,3,4,5].forEach(i=>{const rank=mtCardRank(r[i]);if(rank)dealt.push(rank)});
    }
    const calc=terminalParityResult(dealt);
    const ready=!!data?.complete;
    const side=ready?calc.side:"觀望" as V38Side;
    const sideColor=side==="莊"?"#EF4E57":side==="閒"?"#2879E5":"#A7B5BF";
    const status=!activeConnected?"未連線":!data?"等待牌面":ready?"已完成":"發牌中";
    const faceLine=dealt.length?dealt.join("  "):"—";
    const valueLine=calc.values.length?calc.values.join("  "):"—";
    const tens=ready?Math.floor(calc.total/10):0,ones=ready?calc.total%10:0;
    const formula=ready?`${calc.total} → ${tens}+${ones} → ${calc.first}${calc.first>=10?` → ${calc.finalValue}`:""}`:"等待完整開牌";
    return <Animated.View style={[s.terminalPanel,!desktop&&s.terminalPanelMobile,insideMt&&s.v38PanelMt,{transform:terminalParityPosition.getTranslateTransform()}]}>
      <View style={s.terminalHeader} {...terminalParityDrag.panHandlers}>
        <View style={s.v38HeaderLeft}><MaterialIcons name="functions" size={16} color="#8ED8FF"/><View><Text style={s.terminalTitle}>終值奇偶模型</Text><Text style={s.v38Sub}>Terminal Parity Model · {status}</Text></View></View>
        <Pressable onPress={()=>setTerminalParityOpen(false)} style={s.iconBtn}><MaterialIcons name="close" size={17} color="#fff"/></Pressable>
      </View>
      <View style={s.terminalBody}>
        <View style={s.terminalLine}><Text style={s.terminalLabel}>牌面</Text><Text style={s.terminalCards}>{faceLine}</Text></View>
        <View style={s.terminalLine}><Text style={s.terminalLabel}>牌值</Text><Text style={s.terminalValues}>{valueLine}</Text></View>
        <View style={s.terminalCalcBox}><Text style={s.terminalCalc}>{formula}</Text></View>
        <View style={s.terminalResultRow}><View><Text style={s.terminalResultLabel}>終值</Text><Text style={s.terminalFinal}>{ready?`${calc.finalValue} · ${calc.finalValue%2===0?"偶數":"奇數"}`:"—"}</Text></View><View style={s.terminalSideWrap}><Text style={s.terminalNext}>下一局方向</Text><Text style={[s.terminalSide,{color:sideColor}]}>{side}</Text></View></View>
      </View>
    </Animated.View>;
  };

  const V38Calculator=({insideMt=false}:{insideMt?:boolean})=>{
    if(!v38Open)return null;
    const data=v38ByTable[assistTableId];
    const sideColor=(x:V38Side)=>x==="莊"?"#EF4E57":x==="閒"?"#2879E5":"#A7B5BF";
    const status=!activeConnected?"未連線":!data?"等待牌面":data.settled?"已結算":data.complete?"牌面完成":"發牌中";
    const cards=(xs?:string[])=>xs?.length?xs.join("  "):"—";
    const allCards=data?[...data.player,...data.banker]:[];
    const values=allCards.map(baccaratCardValue);
    const total=values.reduce((a,b)=>a+b,0);
    const pp=data?.playerPoint??0, bp=data?.bankerPoint??0;
    const aRem=total%3, bRem=total%2, mul=bp*pp, mulRem=mul%2, add=bp+pp, addRem=add%2;
    const ready=!!data?.complete;
    const output=(x:V38Side)=>ready?x:"觀望";
    const close=()=>{setV38DetailOpen(false);setV38Open(false)};
    return <Animated.View style={[s.v38Panel,!desktop&&s.v38PanelMobile,insideMt&&s.v38PanelMt,{transform:v38Position.getTranslateTransform()}]}>
      <View style={s.v38Header} {...v38Drag.panHandlers}>
        <View style={s.v38HeaderLeft}>
          <MaterialIcons name={v38DetailOpen?"functions":"calculate"} size={18} color="#8ED8FF"/>
          <View><Text style={s.v38Title}>{v38DetailOpen?"四式即時運算詳情":"V38 四式算牌"}</Text><Text style={s.v38Sub}>{assistTableId} · {status}</Text></View>
        </View>
        <View style={s.row}>
          {v38DetailOpen?
            <Pressable onPress={()=>setV38DetailOpen(false)} style={s.v38InfoBtn}><MaterialIcons name="arrow-back" size={13} color="#D9F1FF"/><Text style={s.v38InfoBtnText}>返回</Text></Pressable>:
            <Pressable onPress={()=>setV38DetailOpen(true)} style={s.v38InfoBtn}><MaterialIcons name="info-outline" size={13} color="#D9F1FF"/><Text style={s.v38InfoBtnText}>更多資訊</Text></Pressable>}
          <Pressable onPress={close} style={s.iconBtn}><MaterialIcons name="close" size={18} color="#fff"/></Pressable>
        </View>
      </View>
      {!v38DetailOpen?<View style={s.v38Body}>
        <View style={s.v38MetaRow}><Text style={s.v38Meta}>Shoe {data?.shoe??assistTable?.shoe??"—"}</Text><Text style={s.v38Meta}>Round {data?.round??assistTable?.round??0}</Text></View>
        <View style={s.v38Cards}>
          <View style={s.v38Hand}><Text style={[s.v38HandSide,{color:"#2879E5"}]}>閒</Text><Text style={s.v38CardText}>{cards(data?.player)}</Text><Text style={s.v38Point}>{data?`${data.playerPoint} 點`:"—"}</Text></View>
          <View style={s.v38Hand}><Text style={[s.v38HandSide,{color:"#EF4E57"}]}>莊</Text><Text style={s.v38CardText}>{cards(data?.banker)}</Text><Text style={s.v38Point}>{data?`${data.bankerPoint} 點`:"—"}</Text></View>
        </View>
        <View style={s.v38FormulaGrid}>{(["A","B","MUL","ADD"] as const).map(k=>{
          const value=data?.complete?data.formulas[k]:"觀望";
          return <View key={k} style={s.v38Formula}><Text style={s.v38FormulaName}>{k==="A"?"A公式":k==="B"?"B公式":k}</Text><Text style={[s.v38FormulaSide,{color:sideColor(value)}]}>{value}</Text></View>
        })}</View>
        <View style={s.v38Recommend}>
          <View><Text style={s.v38RecommendLabel}>下一局四式投票</Text><Text style={s.v38RecommendHint}>{data?.complete?(data.settled?"本局已確認，推薦已更新":"牌面完成，等待結算確認"):"等待完整 show_poker 資料"}</Text></View>
          <Text style={[s.v38RecommendSide,{color:sideColor(data?.complete?data.recommendation:"觀望")}]}>{data?.complete?data.recommendation:"觀望"}</Text>
        </View>
      </View>:
      <ScrollView style={s.v38DetailScroll} contentContainerStyle={s.v38DetailContent} showsVerticalScrollIndicator>
        <View style={s.v38VectorBox}>
          <View style={s.v38DetailHeadRow}><Text style={s.v38SectionCode}>INPUT VECTOR / LIVE</Text><Text style={[s.v38LiveDot,{color:ready?"#4BD693":"#FFB84D"}]}>{ready?"● VERIFIED":"● STREAM"}</Text></View>
          <Text style={s.v38VectorLine}>P = [{cards(data?.player)}]   →   Pₜ = {data?String(pp).padStart(2,"0"):"—"}</Text>
          <Text style={s.v38VectorLine}>B = [{cards(data?.banker)}]   →   Bₜ = {data?String(bp).padStart(2,"0"):"—"}</Text>
          <Text style={s.v38VectorLine}>V = [{values.length?values.join(", "):"—"}]   ΣV = {data?total:"—"}</Text>
        </View>

        <View style={s.v38ModelBox}>
          <View style={s.v38ModelTop}><Text style={s.v38ModelName}>MODEL A</Text><Text style={s.v38ModelTag}>MODULAR-3</Text><Text style={[s.v38ModelOut,{color:sideColor(output(data?.formulas.A??"觀望"))}]}>{output(data?.formulas.A??"觀望")}</Text></View>
          <Text style={s.v38Equation}>Fₐ(X) = [ Σᵢ V(Cᵢ) ] mod 3</Text>
          <Text style={s.v38Calc}>ΣV = {values.length?values.join(" + "):"—"} = {data?total:"—"}</Text>
          <Text style={s.v38Calc}>Rₐ = {data?`${total} − 3⌊${total}/3⌋ = ${aRem}`:"等待資料"}</Text>
          <Text style={s.v38Rule}>δₐ(R):  R=0 → BANKER  ·  R∈{'{1,2}'} → PLAYER</Text>
        </View>

        <View style={s.v38ModelBox}>
          <View style={s.v38ModelTop}><Text style={s.v38ModelName}>MODEL B</Text><Text style={s.v38ModelTag}>BINARY PARITY</Text><Text style={[s.v38ModelOut,{color:sideColor(output(data?.formulas.B??"觀望"))}]}>{output(data?.formulas.B??"觀望")}</Text></View>
          <Text style={s.v38Equation}>Fᵦ(X) = [ Σᵢ V(Cᵢ) ] mod 2</Text>
          <Text style={s.v38Calc}>Rᵦ = {data?`${total} − 2⌊${total}/2⌋ = ${bRem}`:"等待資料"}</Text>
          <Text style={s.v38Calc}>PARITY = {data?(bRem===0?"EVEN / 2ℤ":"ODD / 2ℤ+1"):"—"}</Text>
          <Text style={s.v38Rule}>EVEN → BANKER  ·  ODD → PLAYER</Text>
        </View>

        <View style={s.v38ModelBox}>
          <View style={s.v38ModelTop}><Text style={s.v38ModelName}>MODEL MUL</Text><Text style={s.v38ModelTag}>PRODUCT PARITY</Text><Text style={[s.v38ModelOut,{color:sideColor(output(data?.formulas.MUL??"觀望"))}]}>{output(data?.formulas.MUL??"觀望")}</Text></View>
          <Text style={s.v38Equation}>Fₘ(B,P) = (Bₜ × Pₜ) mod 2</Text>
          <Text style={s.v38Calc}>{data?`${bp} × ${pp} = ${mul}`:"等待資料"}</Text>
          <Text style={s.v38Calc}>Rₘ = {data?`${mul} − 2⌊${mul}/2⌋ = ${mulRem}`:"—"}</Text>
          <Text style={s.v38Rule}>{data?(mulRem===0?"2ℤ / EVEN → BANKER":"2ℤ+1 / ODD → PLAYER"):"EVEN → BANKER  ·  ODD → PLAYER"}</Text>
        </View>

        <View style={s.v38ModelBox}>
          <View style={s.v38ModelTop}><Text style={s.v38ModelName}>MODEL ADD</Text><Text style={s.v38ModelTag}>COMBINED PARITY</Text><Text style={[s.v38ModelOut,{color:sideColor(output(data?.formulas.ADD??"觀望"))}]}>{output(data?.formulas.ADD??"觀望")}</Text></View>
          <Text style={s.v38Equation}>F₊(B,P) = (Bₜ + Pₜ) mod 2</Text>
          <Text style={s.v38Calc}>{data?`${bp} + ${pp} = ${add}`:"等待資料"}</Text>
          <Text style={s.v38Calc}>R₊ = {data?`${add} − 2⌊${add}/2⌋ = ${addRem}`:"—"}</Text>
          <Text style={s.v38Rule}>{data?(addRem===0?"2ℤ / EVEN → BANKER":"2ℤ+1 / ODD → PLAYER"):"EVEN → BANKER  ·  ODD → PLAYER"}</Text>
        </View>
      </ScrollView>}
    </Animated.View>;
  };

  if(!accessGranted)return <AccessScreen notice={accessNotice} onAuthenticated={(sessionId,platformToken,platform)=>{
    setAccessSessionId(sessionId);
    setAccessNotice("");
    setActivePlatform("MT");
    platformTokenRef.current=platformToken;
    setLoginPlatform(platform);
    lockedMtUrlRef.current="";
    setToken("");
    setMtUrl("");
    dgGameUrlRef.current=""; dgAuthPromiseRef.current=null; dgLastAuthAtRef.current=0; dgSameTokenRetryRef.current=0;
    dgFreshAuthorizationRequiredRef.current=false;
    setDgGameUrl("");
    setDgTables([]);
    setDgConnected(false);
    setDgStatus("連線中");
    setDgNeedsRecovery(false);
    dgHasConnectedRef.current=false;
    dgForegroundRecoveryAttemptRef.current=0;
    suppressDgRecoveryRef.current=false;
    roadConnectBusyRef.current=false;
    setHasEnteredGame(false);
    setDgWasOpened(false);
    setGameViewUrl("");
    setAccessGranted(true);
  }}/>;

  return <ScreenContainer edges={["top","left","right","bottom"]} containerClassName="bg-[#080E17]" className="bg-[#080E17]">
    <View style={[s.screen,activePlatform==="DG"&&s.screenDg,desktop&&Platform.OS==="web"?s.screenDesktopZoom:null]}>
      <View style={[s.topbar,!desktop?s.topbarMobile:null,activePlatform==="DG"&&s.topbarDg]}><View style={s.brandRow}><View style={[s.brandIcon,activePlatform==="DG"&&s.brandIconDg]}><MatrixMark size={29} brand={activePlatform}/></View><View><Text style={[s.kicker,activePlatform==="DG"&&s.kickerDg]}>LIVE TABLE ANALYTICS</Text>{desktop?<View style={s.brandTitleRow}><Text style={s.title}>{activePlatform} MATRIX</Text><ThreadsSignature/></View>:<View style={s.brandMobileStack}><Text style={s.title}>{activePlatform} MATRIX</Text><ThreadsSignature mobile/></View>}</View></View><View style={s.row}><Pressable style={s.lineBtn} onPress={openLineContact}><View style={s.lineLogo}><Text style={s.lineLogoText}>LINE</Text></View><Text style={s.lineText}>LINE</Text></Pressable><Pressable style={s.headerBtn} onPress={()=>setHelpOpen(true)}><MaterialIcons name="help-outline" size={16} color="#fff"/><Text style={s.headerBtnText}>說明</Text></Pressable><Pressable style={s.headerBtn} onPress={logoutSession}><MaterialIcons name="logout" size={16} color="#fff"/><Text style={s.headerBtnText}>登出</Text></Pressable><Pressable style={s.headerBtn} onPress={()=>setConnectionOpen(true)}><MaterialIcons name="settings" size={16} color="#fff"/><Text style={s.headerBtnText}>連線</Text></Pressable></View></View>
      <ScrollView contentContainerStyle={s.content}><View style={[s.overview,!desktop&&s.overviewMobile,activePlatform==="DG"&&s.overviewDg]}><View style={!desktop?s.overviewTextMobile:undefined}><Text style={[s.overKicker,activePlatform==="DG"&&s.overKickerDg]}>REAL-TIME MONITORING</Text><Text style={s.overTitle}>LIVE TABLE MATRIX</Text><Text style={s.overSub}>{activePlatform==="DG"?"DG 真人桌況 · 黑金牌路 · 荷官同步":"即時桌況 · 牌路分析 · 荷官同步"}</Text></View><View style={[s.overStats,!desktop&&s.overStatsMobile]}><View style={[s.overStat,!desktop&&s.overStatMobile,activePlatform==="DG"&&s.overStatDg]}><Text style={s.smallLabel}>連線狀態</Text><Text style={[s.overValue,{color:activeConnected?"#4BD693":"#FFB54D"}]}>{activeConnected?"已連線":"連線中"}</Text></View><View style={[s.overStat,!desktop&&s.overStatMobile,activePlatform==="DG"&&s.overStatDg]}><Text style={s.smallLabel}>平台 · 可用 {availableTableCount} 桌</Text><View style={s.platformSwitch}><Pressable onPress={()=>setActivePlatform("MT")} style={[s.platformTab,activePlatform==="MT"&&s.platformTabMtActive]}><Text style={[s.platformTabText,activePlatform==="MT"&&s.platformTabTextActive]}>MT</Text></Pressable><Pressable onPress={()=>setActivePlatform("DG")} style={[s.platformTab,activePlatform==="DG"&&s.platformTabDgActive]}><Text style={[s.platformTabText,activePlatform==="DG"&&s.platformTabTextDgActive]}>DG</Text></Pressable><Pressable disabled={!hasEnteredGame||walletTransferBusy} onPress={confirmTransferAll} style={[s.walletReturnBtn,(!hasEnteredGame||walletTransferBusy)&&s.walletReturnBtnDisabled]}><MaterialIcons name="account-balance-wallet" size={13} color={hasEnteredGame?"#FFF1C6":"#71808B"}/><Text style={[s.walletReturnText,!hasEnteredGame&&s.walletReturnTextDisabled]}>{walletTransferBusy?"轉回中":"一鍵轉回"}</Text></Pressable></View></View></View></View><View style={s.listHead}><Text style={s.listTitle}>所有房型</Text><Text style={s.listHint}>{activePlatform} · 歷史牌局 · 即時更新 · 荷官同步</Text></View><View style={[s.cardsGrid,desktop&&s.cardsGridDesktop,desktop&&s.cardsGridDesktopCentered]}>{tables.map(t=><View key={t.apiId} style={desktop?s.cardWrapDesktop:s.cardWrap}><MemoTableCard table={t} desktop={desktop} onAction={stableTableAction} connected={activeConnected} platform={activePlatform}/></View>)}</View></ScrollView>

      {toast?<View style={s.toast}><Text style={s.toastText}>{toast}</Text></View>:null}

      <Modal visible={walletTransferOpen} transparent animationType="fade" onRequestClose={()=>!walletTransferBusy&&setWalletTransferOpen(false)}><View style={s.modalShade}><View style={s.smallModal}><View style={s.modalHead}><Text style={s.modalTitle}>一鍵轉回主錢包</Text><Pressable disabled={walletTransferBusy} onPress={()=>setWalletTransferOpen(false)}><MaterialIcons name="close" size={22} color="#fff"/></Pressable></View><Text style={s.helpText}>將目前所有遊戲錢包可轉回點數全部收回主錢包。</Text><View style={[s.modalActions,{marginTop:14}]}><Pressable disabled={walletTransferBusy} style={[s.actionBtn,{backgroundColor:"#344553",opacity:walletTransferBusy?0.55:1}]} onPress={()=>setWalletTransferOpen(false)}><Text style={s.btnText}>取消</Text></Pressable><Pressable disabled={walletTransferBusy} style={[s.actionBtn,{backgroundColor:"#8B6828",opacity:walletTransferBusy?0.68:1}]} onPress={()=>void executeTransferAll()}><Text style={s.btnText}>{walletTransferBusy?"轉回中...":"確認轉回"}</Text></Pressable></View></View></View></Modal>

      <Modal visible={stopLossOpen} transparent animationType="fade" onRequestClose={()=>setStopLossOpen(false)}><View style={s.stopLossShade}><View style={s.stopLossModal}>
        <View style={s.stopLossHead}><View style={s.stopLossTitleWrap}><MaterialIcons name="health-and-safety" size={16} color="#7DD7FF"/><Text style={s.stopLossTitle}>止損設定</Text></View><Pressable style={s.stopLossClose} onPress={()=>setStopLossOpen(false)}><MaterialIcons name="close" size={18} color="#DDE8F0"/></Pressable></View>
        <View style={s.stopLossRow}><Text style={s.stopLossLabel}>目前餘額</Text><Text style={s.stopLossBalance}>{currentBalance===null?"—":currentBalance.toLocaleString(undefined,{maximumFractionDigits:2})}</Text></View>
        <View style={s.stopLossPrincipalRow}><Text style={s.stopLossLabel}>本金</Text><TextInput value={stopLossPrincipal} onChangeText={setStopLossPrincipal} keyboardType="decimal-pad" placeholder="輸入本金" placeholderTextColor="#6D8292" style={s.stopLossInput}/></View>
        <Pressable style={({pressed}:any)=>[s.useBalanceBtn,pressed&&s.stopLossMiniBtnPressed]} onPress={useCurrentBalanceAsPrincipal}><Text style={s.useBalanceBtnText}>使用目前餘額</Text></Pressable>
        <View style={s.stopLossPercentRow}><Text style={s.stopLossLabel}>止損比例</Text><View style={s.stopLossStepper}><Pressable style={s.stepBtn} onPress={()=>setStopLossPercent(v=>Math.max(5,v-5))}><Text style={s.stepBtnText}>−</Text></Pressable><Text style={s.stopLossPercent}>{stopLossPercent}%</Text><Pressable style={s.stepBtn} onPress={()=>setStopLossPercent(v=>Math.min(90,v+5))}><Text style={s.stepBtnText}>＋</Text></Pressable></View></View>
        <View style={s.stopLossThresholdRow}><Text style={s.stopLossLabel}>警戒線</Text><Text style={s.stopLossThreshold}>{stopLossThreshold>0?stopLossThreshold.toLocaleString(undefined,{maximumFractionDigits:2}):"—"}</Text></View>
        <Pressable style={({pressed}:any)=>[s.stopLossEnableBtn,pressed&&{opacity:.78}]} onPress={enableStopLoss}><Text style={s.stopLossEnableText}>{stopLossEnabled?"更新提醒":"開啟提醒"}</Text></Pressable>
      </View></View></Modal>

      <Modal visible={stopLossAlertOpen} transparent animationType="fade" onRequestClose={()=>setStopLossAlertOpen(false)}><View style={s.stopLossShade}><View style={s.stopLossAlertModal}>
        <View style={s.stopLossAlertIcon}><MaterialIcons name="warning-amber" size={24} color="#FFCB66"/></View>
        <Text style={s.stopLossAlertTitle}>止損提醒</Text>
        <Text style={s.stopLossAlertText}>已達設定的止損警戒線</Text>
        <Text style={s.stopLossAlertSub}>建議適度休息，理性遊戲。</Text>
        <Pressable style={s.stopLossAckBtn} onPress={()=>setStopLossAlertOpen(false)}><Text style={s.stopLossAckText}>我知道了</Text></Pressable>
      </View></View></Modal>

      <Modal visible={connectionOpen} transparent animationType="fade" onRequestClose={()=>setConnectionOpen(false)}><View style={s.modalShade}><View style={s.connectionModal}><View style={s.modalHead}><Text style={s.modalTitle}>牌路連線中心</Text><Pressable onPress={()=>setConnectionOpen(false)}><MaterialIcons name="close" size={22} color="#DDE8F0"/></Pressable></View><Text style={s.modalNote}>MT、DG 進入牌路主頁後會自動連線。下列網址只供顯示，使用者無法修改。DG 單工作階段：內建</Text><View style={s.connectionStatusRow}><View style={s.connectionStatusCard}><Text style={s.fieldLabel}>MT</Text><Text style={[s.connectionStatusText,{color:connected?"#4BD693":"#FFB54D"}]}>{connected?"已連線":"連線中"}</Text></View><View style={s.connectionStatusCard}><Text style={s.fieldLabel}>DG</Text><Text style={[s.connectionStatusText,{color:dgConnected?"#4BD693":"#FFB54D"}]}>{dgConnected?"已連線":"連線中"}</Text></View></View><Text style={s.fieldLabel}>MT 即時牌路 WebSocket（固定）</Text><TextInput value={readonlyConnectionUrl(wsUrl)} editable={false} selectTextOnFocus style={s.modalInput}/><Text style={s.fieldLabel}>MT 牌路授權網址（唯讀）</Text><TextInput value={readonlyConnectionUrl(mtUrl)} editable={false} selectTextOnFocus style={s.modalInput}/><Text style={s.fieldLabel}>DG 牌路授權網址（唯讀）</Text><TextInput value={readonlyConnectionUrl(dgGameUrl)} editable={false} selectTextOnFocus style={s.modalInput}/><View style={s.modalActions}><Pressable style={[s.actionBtn,{backgroundColor:"#2E7CEB"}]} onPress={()=>void connectRoadDashboard(true)}><MaterialIcons name="sync" size={15} color="#fff"/><Text style={s.btnText}>重新連線</Text></Pressable><Pressable style={[s.actionBtn,{backgroundColor:"#344553"}]} onPress={()=>setConnectionOpen(false)}><Text style={s.btnText}>完成</Text></Pressable></View></View></View></Modal>
      <Modal visible={helpOpen} transparent animationType="fade" onRequestClose={()=>setHelpOpen(false)}><View style={s.modalShade}><View style={s.smallModal}><View style={s.modalHead}><Text style={s.modalTitle}>說明</Text><Pressable onPress={()=>setHelpOpen(false)}><MaterialIcons name="close" size={22} color="#fff"/></Pressable></View><Text style={s.helpText}>主頁只顯示 MT 目前提供的真人桌並即時更新。MT 懸浮輔助可左右滑動 3 頁：即時輔助、資金策略、輸贏統計。</Text></View></View></Modal>
      <Modal visible={!!radarDetailTable} transparent animationType="fade" onRequestClose={()=>setRadarDetailId(null)}><View style={s.modalShade}><View style={s.radarDetailModal}><View style={s.modalHead}><View><Text style={s.radarKicker}>MT MATRIX · LIVE ROAD SNAPSHOT</Text><Text style={s.radarDetailTitle}>{radarDetailId} · 第 {radarDetailTable?.round??0} 局</Text></View><Pressable onPress={()=>setRadarDetailId(null)} style={s.radarClose}><MaterialIcons name="close" size={20} color="#DCEEFF"/></Pressable></View>{radarDetailTable?<><View style={s.radarDetailStats}><View style={s.radarDetailStat}><Text style={s.radarDetailLabel}>目前推薦</Text><Text style={[s.radarDetailValue,{color:resultColor(radarDetailDecision.side)}]}>{radarDetailDecision.side}</Text></View><View style={s.radarDetailStat}><Text style={s.radarDetailLabel}>信心度</Text><View style={s.radarDetailConfidence}><View style={[s.signalDot,{backgroundColor:confidenceState(radarDetailConfidence).color,shadowColor:confidenceState(radarDetailConfidence).color}]}/><Text style={[s.radarDetailValue,{color:confidenceState(radarDetailConfidence).color,marginTop:0}]}>{confidenceState(radarDetailConfidence).label}</Text></View></View><View style={s.radarDetailStat}><Text style={s.radarDetailLabel}>目前牌型</Text><Text numberOfLines={1} style={s.radarDetailValue}>{detectPattern(radarDetailTable.results)}</Text></View><View style={s.radarDetailStat}><Text style={s.radarDetailLabel}>莊／閒／和</Text><Text style={s.radarDetailValue}>{radarDetailTable.banker}／{radarDetailTable.player}／{radarDetailTable.tie}</Text></View></View><View style={[s.radarRoadWrap,{height:desktop?190:150}]}><RoadGrid table={radarDetailTable} desktop={desktop} transparent/></View><Text style={s.radarDetailNote}>{analysisText(radarDetailTable)}</Text></>:null}</View></View></Modal>

      <Modal visible={!!analysisTable} transparent animationType="fade" onRequestClose={()=>setAnalysisTable(null)}><View style={s.modalShade}><View style={s.smallModal}><View style={s.modalHead}><Text style={s.modalTitle}>百家樂 {analysisTable?.id} 分析</Text><Pressable onPress={()=>setAnalysisTable(null)}><MaterialIcons name="close" size={22} color="#fff"/></Pressable></View><Text style={s.helpText}>{analysisText(analysisTable??undefined)}</Text></View></View></Modal>
      {mtOpen?<View style={s.mtOverlay}><View style={s.mtScreen}><View style={[s.mtTop,gameViewPlatform==="DG"&&s.topbarDg]}><View style={s.brandRow}><View style={[s.brandIcon,gameViewPlatform==="DG"&&s.brandIconDg]}><MatrixMark size={29} brand={gameViewPlatform}/></View><View><Text style={[s.kicker,gameViewPlatform==="DG"&&s.kickerDg]}>LIVE TABLE ANALYTICS</Text>{desktop?<View style={s.brandTitleRow}><Text style={s.title}>{gameViewPlatform} MATRIX</Text><ThreadsSignature/></View>:<View style={s.brandMobileStack}><Text style={s.title}>{gameViewPlatform} MATRIX</Text><ThreadsSignature mobile/></View>}</View></View><View style={s.row}><Pressable style={s.lineBtn} onPress={openLineContact}><View style={s.lineLogo}><Text style={s.lineLogoText}>LINE</Text></View><Text style={s.lineText}>LINE</Text></Pressable><Pressable style={s.headerBtn} onPress={()=>setHelpOpen(true)}><MaterialIcons name="help-outline" size={16} color="#fff"/><Text style={s.headerBtnText}>說明</Text></Pressable><Pressable style={s.headerBtn} onPress={closeGameView}><MaterialIcons name="arrow-back" size={16} color="#fff"/><Text style={s.headerBtnText}>回牌路</Text></Pressable></View></View><View style={s.iframeWrap}>{Platform.OS==="web"?createElement("iframe" as any,{src:gameViewUrl,style:{width:"100%",height:"100%",border:"0",background:"#000"},allow:"clipboard-read; clipboard-write; fullscreen"}):<View style={s.nativeMtFallback}><Text style={s.helpText}>目前原生模式請使用外部瀏覽器開啟目前平台。</Text></View>}</View></View></View>:null}
      {MultiTableRadar({insideMt:mtOpen})}
      {FloatingAssistant({insideMt:mtOpen})}
      {V38Calculator({insideMt:mtOpen})}
      {TerminalParityModel({insideMt:mtOpen})}
      <FloatingOrb position={orbPosition} responder={orbResponder} size={orbSize} iconSize={orbIconSize} connected={activeConnected} insideMt={mtOpen} platform={activePlatform}/>
    </View>
  </ScreenContainer>;
}

const s=StyleSheet.create({
  screen:{flex:1,backgroundColor:"#060D15"},screenDg:{backgroundColor:"#090806"},screenDesktopZoom:{zoom:1.18,width:"84.7458%",height:"84.7458%",marginLeft:"auto",marginRight:"auto"},row:{flexDirection:"row",alignItems:"center",gap:6},brandRow:{flexDirection:"row",alignItems:"center",gap:8},
  topbar:{minHeight:58,paddingHorizontal:14,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:"#31536B",backgroundColor:"#07111C"},topbarDg:{backgroundColor:"#110E08",borderBottomColor:"#8B6B2E"},topbarMobile:{minHeight:64,paddingHorizontal:10},brandMobileStack:{alignItems:"flex-start"},brandIcon:{width:34,height:34,borderRadius:8,borderWidth:1,borderColor:"#315D79",alignItems:"center",justifyContent:"center",backgroundColor:"#071521"},brandIconDg:{backgroundColor:"#171208",borderColor:"#9B7833"},brandTitleRow:{flexDirection:"row",alignItems:"center",gap:8},kicker:{color:"#7890A3",fontSize:8,letterSpacing:1.1},kickerDg:{color:"#C6A35A"},title:{color:"#F2F6F9",fontSize:16,fontWeight:"800"},
  lineBtn:{height:34,paddingHorizontal:9,borderRadius:7,backgroundColor:"#0C9B43",flexDirection:"row",alignItems:"center",gap:5},lineLogo:{width:23,height:23,borderRadius:11.5,backgroundColor:"#fff",alignItems:"center",justifyContent:"center"},lineLogoText:{fontSize:5.5,fontWeight:"900",color:"#0C9B43"},lineText:{color:"#fff",fontSize:10,fontWeight:"900"},headerBtn:{height:34,paddingHorizontal:9,borderRadius:7,backgroundColor:"#102A3D",flexDirection:"row",alignItems:"center",gap:5,borderWidth:1,borderColor:"#3D6682"},headerBtnText:{color:"#fff",fontSize:10,fontWeight:"800"},
  content:{padding:10,paddingBottom:90},overview:{borderWidth:1,borderColor:"#315B76",borderRadius:8,padding:12,flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:10,backgroundColor:"#0B1A28",overflow:"hidden"},overviewDg:{backgroundColor:"#151109",borderColor:"#8B6B2E"},overviewMobile:{flexDirection:"column",alignItems:"stretch",gap:10},overviewTextMobile:{width:"100%"},overKicker:{color:"#62B6E8",fontSize:7,letterSpacing:1.4},overKickerDg:{color:"#D1AE61"},overTitle:{color:"#F4FAFF",fontSize:18,fontWeight:"900",marginTop:2},overSub:{color:"#7894A8",fontSize:9,marginTop:3},overStats:{flexDirection:"row",gap:8},overStatsMobile:{width:"100%",gap:6},overStat:{minWidth:112,borderWidth:1,borderColor:"#31536B",borderRadius:6,padding:9,backgroundColor:"#091722"},overStatDg:{borderColor:"#745925",backgroundColor:"#100D08"},overStatMobile:{flex:1,minWidth:0,padding:8},overValue:{color:"#fff",fontSize:13,fontWeight:"900",marginTop:4},platformSwitch:{flexDirection:"row",alignItems:"center",marginTop:5,padding:2,borderRadius:6,backgroundColor:"rgba(0,0,0,.26)",borderWidth:1,borderColor:"rgba(130,151,166,.22)"},platformTab:{minWidth:42,height:23,paddingHorizontal:10,borderRadius:4,alignItems:"center",justifyContent:"center"},platformTabMtActive:{backgroundColor:"#176FA7",borderWidth:1,borderColor:"#55B4E9"},platformTabDgActive:{backgroundColor:"#6F5420",borderWidth:1,borderColor:"#D3AD5C"},platformTabText:{color:"#7F909C",fontSize:9,fontWeight:"900",letterSpacing:.5},platformTabTextActive:{color:"#EAF8FF"},platformTabTextDgActive:{color:"#FFF2C9"},walletReturnBtn:{height:23,marginLeft:4,paddingHorizontal:8,borderRadius:4,borderWidth:1,borderColor:"#9B7530",backgroundColor:"#241A0A",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:4},walletReturnBtnDisabled:{borderColor:"#3B4650",backgroundColor:"#151A1F",opacity:.62},walletReturnText:{color:"#FFF1C6",fontSize:8,fontWeight:"900"},walletReturnTextDisabled:{color:"#71808B"},listHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:7},listTitle:{color:"#F2F6F9",fontSize:15,fontWeight:"900"},listHint:{color:"#73899A",fontSize:8},
  cardsGrid:{width:"100%",alignSelf:"center"},cardsGridDesktop:{flexDirection:"row",flexWrap:"wrap",gap:10},cardsGridDesktopCentered:{maxWidth:1280},cardWrap:{width:"100%"},cardWrapDesktop:{width:"calc(50% - 5px)" as any,maxWidth:635},tableCard:{backgroundColor:"#08111A",borderWidth:1,borderColor:"#365B73",overflow:"hidden",marginBottom:10,shadowColor:"#000",shadowOpacity:0.28,shadowRadius:4},tableCardDesktop:{},tableCardDg:{backgroundColor:"#100D08",borderColor:"#8C6B2C",shadowColor:"#C49B48",shadowOpacity:.16},tableHead:{height:28,paddingHorizontal:5,backgroundColor:"#091621",flexDirection:"row",justifyContent:"space-between",alignItems:"center",borderBottomWidth:1,borderBottomColor:"#27485E"},tableHeadDg:{backgroundColor:"#171208",borderBottomColor:"#785B27"},game:{color:"#EAF6FF",fontSize:9,fontWeight:"700"},tableId:{color:"#F8FCFF",borderWidth:1,borderColor:"#6E91A8",paddingHorizontal:6,paddingVertical:1,fontSize:9,fontWeight:"900",backgroundColor:"#0E202E"},tableIdDg:{backgroundColor:"#241B0C",borderColor:"#C29A4D",color:"#FFF1C5"},headText:{color:"#B9CEDC",fontSize:8,fontWeight:"800"},statText:{fontSize:8,fontWeight:"900"},countWrap:{height:20,minWidth:28,borderWidth:1,borderColor:"#8D2030",borderRadius:4,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:2,paddingHorizontal:3},countdown:{color:"#FF5362",fontSize:8,fontWeight:"900"},miniBtn:{height:20,paddingHorizontal:6,borderRadius:4,alignItems:"center",justifyContent:"center",borderColor:"#3A6078",shadowColor:"#000",shadowOpacity:0.22,shadowRadius:2},miniBtnText:{color:"#fff",fontSize:7,fontWeight:"900"},
  tableBody:{flexDirection:"row",height:176,backgroundColor:"#fff",overflow:"hidden"},tableBodyDesktop:{height:190},tableBodyMobile:{height:164},tableBodyDg:{backgroundColor:"#F7F1E4"},dealer:{width:112,backgroundColor:"#F2F0EC",padding:4,justifyContent:"flex-end"},dealerDesktop:{width:"21.88%"},dealerMobile:{width:"21.88%",minWidth:76},dealerDg:{backgroundColor:"#EDE3CE"},photo:{position:"absolute",top:3,left:3,right:3,height:112,backgroundColor:"#DCE2E6",alignItems:"center",justifyContent:"center",overflow:"hidden"},photoDesktop:{height:"75%"},photoMobile:{height:"73%"},photoImage:{width:"100%",height:"100%",resizeMode:"cover"},liveMediaFill:{width:"100%",height:"100%",alignItems:"center",justifyContent:"center",overflow:"hidden"},crown:{fontSize:30,color:"#C5A24C"},dealerName:{color:"#FFFFFF",backgroundColor:"#6F2F82",alignSelf:"flex-start",paddingHorizontal:5,paddingVertical:2,fontSize:11,fontWeight:"900",lineHeight:14},dealerNameDg:{backgroundColor:"#6F5420",color:"#FFF4D2"},meta:{color:"#617889",fontSize:8.5,fontWeight:"700",lineHeight:11,marginTop:1},metaVideoRow:{height:12,flexDirection:"row",alignItems:"center",marginTop:1,overflow:"hidden"},metaVideoText:{flexShrink:1,marginTop:0,lineHeight:11},videoLabel:{color:"#7890A1",fontSize:7.5,fontWeight:"800",marginLeft:3,marginRight:2,lineHeight:10},videoSwitch:{width:18,height:9,borderRadius:5,backgroundColor:"#667B89",padding:1,justifyContent:"center"},videoSwitchOn:{backgroundColor:"#19B96C"},videoSwitchKnob:{width:7,height:7,borderRadius:3.5,backgroundColor:"#fff",alignSelf:"flex-start"},videoSwitchKnobOn:{alignSelf:"flex-end"},
  roadArea:{flex:1,flexDirection:"row",backgroundColor:"#fff",minWidth:0,overflow:"hidden"},roadAreaDesktop:{},roadAreaDg:{backgroundColor:"#FFF9ED"},beadPane:{width:"32%",height:"100%",flexShrink:0,borderRightWidth:1,borderColor:"#C9D2D9",overflow:"hidden",backgroundColor:"#FFFFFF"},beadPaneDesktop:{width:"32%"},beadPaneDg:{backgroundColor:"#FFF9ED",borderColor:"#CDBF9F"},beadGrid:{width:"100%",height:"100%",flexDirection:"row",flexWrap:"wrap",alignContent:"stretch",backgroundColor:"#FFFFFF"},beadGridDg:{backgroundColor:"#FFF9ED"},beadCell:{width:"16.6666667%",height:"16.6666667%",flexGrow:0,flexShrink:0,borderRightWidth:1,borderBottomWidth:1,borderColor:"#D9DEE3",alignItems:"center",justifyContent:"center",backgroundColor:"#FFFFFF"},beadCellDesktop:{},roadCellDg:{backgroundColor:"#FFF9ED",borderColor:"#DDD0B3"},beadDot:{width:"72%",aspectRatio:1,borderRadius:999,borderWidth:1,alignItems:"center",justifyContent:"center",shadowColor:"#000",shadowOpacity:.10,shadowRadius:1,elevation:1},beadDotDesktop:{width:"70%"},beadDotText:{color:"#FFFFFF",fontSize:8,fontWeight:"900",lineHeight:10,textAlign:"center"},beadDotTextDesktop:{fontSize:9,lineHeight:11},roadStack:{flex:1,minWidth:0,height:"100%"},bigGrid:{width:"100%",height:"62%",flexDirection:"row",flexWrap:"wrap",alignContent:"stretch"},bigGridDesktop:{},bigCell:{width:"6.6666667%",height:"16.6666667%",borderRightWidth:1,borderBottomWidth:1,borderColor:"#DDE4E9",alignItems:"center",justifyContent:"center",overflow:"hidden"},bigCellDesktop:{},bigMark:{width:"72%",maxWidth:"78%",aspectRatio:1,borderRadius:999,borderWidth:1.35,backgroundColor:"transparent",alignItems:"center",justifyContent:"center"},bigMarkDesktop:{width:"70%",borderWidth:1.2},tieNumber:{color:"#20B66B",fontSize:7,fontWeight:"900",lineHeight:8},tieNumberDesktop:{fontSize:7,lineHeight:8},lowerArea:{width:"100%",height:"38%",flexDirection:"row",borderTopWidth:1,borderTopColor:"#CCD6DE"},lowerAreaDesktop:{},lowerAreaDg:{borderTopColor:"#CDBF9F",backgroundColor:"#FFF9ED"},lowerPane:{width:"33.333333%",height:"100%",flexDirection:"row",flexWrap:"wrap",alignContent:"stretch",borderRightWidth:1,borderRightColor:"#DDE4E9"},lowerPaneDg:{borderRightColor:"#DDD0B3",backgroundColor:"#FFF9ED"},lowerCell:{width:"10%",height:"16.6666667%",alignItems:"center",justifyContent:"center",borderRightWidth:.5,borderBottomWidth:.5,borderColor:"#E4E8EB",overflow:"hidden"},lowerCellDesktop:{},lowerHollow:{width:"55%",aspectRatio:1,borderRadius:999,borderWidth:1.4,backgroundColor:"transparent"},lowerSolid:{width:"52%",aspectRatio:1,borderRadius:999},lowerSlash:{width:"58%",height:2,borderRadius:2,transform:[{rotate:"-45deg"}]},
  orb:{position:"absolute",right:16,bottom:24,zIndex:10020,width:50,height:50,borderRadius:25,backgroundColor:"#07131E",borderWidth:2,borderColor:"#6CC8FF",alignItems:"center",justifyContent:"center",shadowColor:"#000",shadowOpacity:0.5,shadowRadius:10,elevation:12,touchAction:"none" as any,userSelect:"none" as any,cursor:"grab" as any},orbMt:{bottom:34,zIndex:10020,elevation:40},orbStatus:{position:"absolute",right:4,top:4,width:8,height:8,borderRadius:4,borderWidth:1,borderColor:"#fff"},
  v38LaunchActive:{backgroundColor:"#0F7AAE"},
  v38InfoBtn:{height:28,paddingHorizontal:8,borderRadius:5,borderWidth:1,borderColor:"#315F78",backgroundColor:"#0C2A3D",flexDirection:"row",alignItems:"center",gap:4},v38InfoBtnText:{color:"#D9F1FF",fontSize:8,fontWeight:"900"},v38DetailScroll:{height:194},v38DetailContent:{padding:7,paddingBottom:12,gap:6},v38VectorBox:{backgroundColor:"#0A1C29",borderWidth:1,borderColor:"#31576D",borderRadius:6,padding:7},v38DetailHeadRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:5},v38SectionCode:{color:"#8ED8FF",fontSize:8,fontWeight:"900",letterSpacing:.7},v38LiveDot:{fontSize:7.5,fontWeight:"900"},v38VectorLine:{color:"#D7E5ED",fontSize:8.5,fontWeight:"700",fontFamily:Platform.OS==="web"?"monospace":undefined,lineHeight:14},v38ModelBox:{backgroundColor:"#091722",borderWidth:1,borderColor:"#274A60",borderRadius:6,padding:7},v38ModelTop:{flexDirection:"row",alignItems:"center",gap:6,marginBottom:5},v38ModelName:{color:"#F4FAFF",fontSize:9,fontWeight:"900",letterSpacing:.5},v38ModelTag:{color:"#7599AD",fontSize:6.8,fontWeight:"900",flex:1},v38ModelOut:{fontSize:11,fontWeight:"900"},v38Equation:{color:"#BCE8FF",fontSize:9,fontWeight:"800",fontFamily:Platform.OS==="web"?"monospace":undefined,marginBottom:4},v38Calc:{color:"#D5E0E7",fontSize:8,fontWeight:"700",fontFamily:Platform.OS==="web"?"monospace":undefined,lineHeight:13},v38Rule:{color:"#7897AA",fontSize:7,fontWeight:"700",marginTop:4},
  terminalPanel:{position:"absolute",right:88,top:120,width:300,zIndex:10012,backgroundColor:"rgba(5,15,24,.985)",borderWidth:1,borderColor:"#3B789C",borderRadius:9,overflow:"hidden",shadowColor:"#000",shadowOpacity:.5,shadowRadius:12,elevation:32},terminalPanelMobile:{left:12,right:"auto" as any,top:115,width:300,maxWidth:"92%" as any},terminalHeader:{height:38,paddingHorizontal:8,flexDirection:"row",alignItems:"center",justifyContent:"space-between",backgroundColor:"#082033",borderBottomWidth:1,borderBottomColor:"#285B79",touchAction:"none" as any,userSelect:"none" as any,cursor:"grab" as any},terminalTitle:{color:"#F4FAFF",fontSize:11,fontWeight:"900",letterSpacing:.35},terminalBody:{padding:8},terminalLine:{minHeight:26,flexDirection:"row",alignItems:"center",borderBottomWidth:1,borderBottomColor:"#173246"},terminalLabel:{width:38,color:"#7FA1B5",fontSize:8,fontWeight:"900"},terminalCards:{flex:1,color:"#F4FAFF",fontSize:12,fontWeight:"900",letterSpacing:.7},terminalValues:{flex:1,color:"#B8CBD7",fontSize:9,fontWeight:"800",letterSpacing:.6},terminalCalcBox:{marginTop:6,minHeight:31,borderRadius:5,backgroundColor:"#0B1B29",borderWidth:1,borderColor:"#24465D",alignItems:"center",justifyContent:"center",paddingHorizontal:6},terminalCalc:{color:"#BCE8FF",fontSize:10,fontWeight:"900",fontFamily:Platform.OS==="web"?"monospace":undefined},terminalResultRow:{marginTop:6,minHeight:48,borderRadius:6,backgroundColor:"#10283A",borderWidth:1,borderColor:"#326884",paddingHorizontal:8,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},terminalResultLabel:{color:"#86A5B7",fontSize:7.5,fontWeight:"900"},terminalFinal:{color:"#F1F7FA",fontSize:12,fontWeight:"900",marginTop:2},terminalSideWrap:{alignItems:"flex-end"},terminalNext:{color:"#86A5B7",fontSize:7.5,fontWeight:"900"},terminalSide:{fontSize:20,fontWeight:"900",marginTop:1},
  v38Panel:{position:"absolute",right:88,top:120,width:360,zIndex:10010,backgroundColor:"rgba(5,15,24,.985)",borderWidth:1,borderColor:"#3B789C",borderRadius:10,overflow:"hidden",shadowColor:"#000",shadowOpacity:.5,shadowRadius:14,elevation:30},v38PanelMobile:{left:12,right:"auto" as any,top:115,width:340,maxWidth:"92%" as any},v38PanelMt:{zIndex:10015,elevation:45},v38Header:{height:42,paddingHorizontal:9,flexDirection:"row",alignItems:"center",justifyContent:"space-between",backgroundColor:"#082033",borderBottomWidth:1,borderBottomColor:"#285B79",touchAction:"none" as any,userSelect:"none" as any,cursor:"grab" as any},v38HeaderLeft:{flexDirection:"row",alignItems:"center",gap:8},v38Title:{color:"#F4FAFF",fontSize:12,fontWeight:"900",letterSpacing:.5},v38Sub:{color:"#80A7BD",fontSize:8,fontWeight:"800",marginTop:1},v38Body:{padding:8},v38MetaRow:{flexDirection:"row",justifyContent:"space-between",marginBottom:6},v38Meta:{color:"#9DB2C0",fontSize:9,fontWeight:"800"},v38Cards:{flexDirection:"row",gap:6},v38Hand:{flex:1,minHeight:54,backgroundColor:"#0E2232",borderWidth:1,borderColor:"#294C63",borderRadius:6,padding:7},v38HandSide:{fontSize:10,fontWeight:"900"},v38CardText:{color:"#F5FAFD",fontSize:14,fontWeight:"900",marginTop:5},v38Point:{color:"#C7D7E1",fontSize:9,fontWeight:"800",marginTop:3},v38FormulaGrid:{flexDirection:"row",gap:5,marginTop:6},v38Formula:{flex:1,backgroundColor:"#0B1B29",borderWidth:1,borderColor:"#24465D",borderRadius:5,paddingVertical:6,alignItems:"center"},v38FormulaName:{color:"#9EB6C6",fontSize:8,fontWeight:"900"},v38FormulaSide:{fontSize:13,fontWeight:"900",marginTop:2},v38Recommend:{marginTop:6,minHeight:50,backgroundColor:"#10283A",borderWidth:1,borderColor:"#326884",borderRadius:6,paddingHorizontal:8,paddingVertical:6,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},v38RecommendLabel:{color:"#E8F4FA",fontSize:10,fontWeight:"900"},v38RecommendHint:{color:"#83A2B5",fontSize:7.5,fontWeight:"700",marginTop:3},v38RecommendSide:{fontSize:21,fontWeight:"900"},
  floatPanel:{position:"absolute",right:74,bottom:22,zIndex:100,backgroundColor:"rgba(6,16,25,.975)",borderWidth:1,borderColor:"#416C88",borderRadius:9,overflow:"hidden",shadowColor:"#000",shadowOpacity:.45,shadowRadius:14,elevation:15},floatPanelMt:{zIndex:9999},floatHeader:{height:38,paddingHorizontal:9,flexDirection:"row",alignItems:"center",justifyContent:"space-between",backgroundColor:"#081A28",borderBottomWidth:1,borderBottomColor:"#234A63",touchAction:"none" as any,userSelect:"none" as any,cursor:"grab" as any},floatHeadLeft:{flexDirection:"row",alignItems:"center",gap:8},floatBrandLine:{flexDirection:"row",alignItems:"center",gap:7},floatTitle:{color:"#F5FAFD",fontWeight:"900",fontSize:12,letterSpacing:.7},floatStatus:{color:"#56D48C",fontSize:8,fontWeight:"900"},iconBtn:{width:27,height:27,borderRadius:5,backgroundColor:"#214A70",alignItems:"center",justifyContent:"center"},iconTextBtn:{height:27,paddingHorizontal:7,borderRadius:5,backgroundColor:"#214A70",flexDirection:"row",gap:3,alignItems:"center"},iconText:{color:"#fff",fontSize:8,fontWeight:"800"},selectorWrap:{marginHorizontal:6,marginTop:6,position:"relative",zIndex:130},selector:{height:38,paddingHorizontal:9,borderWidth:1,borderColor:"#31516B",borderRadius:5,backgroundColor:"#09151F",flexDirection:"row",alignItems:"center",justifyContent:"space-between"},selectorLeft:{flexDirection:"row",alignItems:"center",gap:4},selectorConfidence:{flexDirection:"row",alignItems:"center",gap:4,marginLeft:4},selectorValue:{color:"#F0F5F8",fontSize:11,fontWeight:"900"},selectorMeta:{color:"#B6C5D0",fontSize:9},roomDropdown:{position:"absolute",left:0,right:0,top:42,maxHeight:205,backgroundColor:"#0A1722",borderWidth:1,borderColor:"#345A76",borderRadius:6,zIndex:160,elevation:30,overflow:"hidden",shadowColor:"#000",shadowOpacity:.45,shadowRadius:10},roomDropdownScroll:{height:205,maxHeight:205,overflow:"scroll"},roomDropdownContent:{paddingBottom:2},roomDropdownItem:{minHeight:42,paddingHorizontal:10,paddingVertical:5,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:"#183044"},roomDropdownItemActive:{backgroundColor:"#1B5B88"},roomDropdownLeft:{flex:1,minWidth:0,paddingRight:8},roomDropdownText:{color:"#EDF5FA",fontSize:10,fontWeight:"900"},roomDropdownDealer:{color:"#AFC1CD",fontSize:8,marginTop:2},roomDropdownMeta:{color:"#8EA7B9",fontSize:8,fontWeight:"800"},roomDropdownRight:{alignItems:"flex-end",justifyContent:"center",gap:3},roomConfidence:{flexDirection:"row",alignItems:"center",gap:5},roomConfidenceText:{fontSize:8,fontWeight:"900",textShadowRadius:7},assistPage:{padding:6,minHeight:150},decisionRow:{flexDirection:"row",gap:5},decisionBox:{flex:1,minHeight:68,backgroundColor:"#102335",borderWidth:1,borderColor:"#294B64",borderRadius:5,padding:7},smallLabel:{color:"#FFFFFF",fontSize:12,fontWeight:"900"},latestLine:{flexDirection:"row",alignItems:"center",gap:7,marginTop:7},glowDot:{width:17,height:17,borderRadius:8.5,shadowOpacity:1,shadowRadius:10,elevation:8},latestText:{fontSize:16,fontWeight:"900"},detectText:{color:"#FFFFFF",fontSize:14,fontWeight:"900",marginTop:7},recommendText:{fontSize:17,fontWeight:"900",marginTop:7},microText:{color:"#FFFFFF",fontSize:12,fontWeight:"900",marginTop:4},todayPnlBox:{marginTop:5,backgroundColor:"#102335",borderWidth:1,borderColor:"#294B64",borderRadius:5,paddingHorizontal:8,paddingVertical:6,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},todayPnlValue:{fontSize:16,fontWeight:"900"},aiBox:{marginTop:5,backgroundColor:"#0B1925",borderRadius:5,padding:7},aiHead:{minHeight:20,flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:6},aiTitle:{color:"#B7D3E6",fontSize:11,fontWeight:"900"},stopLossMiniBtn:{height:20,paddingHorizontal:7,borderRadius:4,borderWidth:1,borderColor:"#315D79",backgroundColor:"#123149",alignItems:"center",justifyContent:"center"},stopLossMiniBtnPressed:{opacity:.72},stopLossMiniBtnText:{color:"#D9F2FF",fontSize:8,fontWeight:"900"},aiText:{color:"#C6D2DB",fontSize:11,lineHeight:17,marginTop:5},aiTextMobile:{fontSize:9.5,lineHeight:13,marginTop:3},moneyGrid:{flexDirection:"row",gap:5},fieldBox:{flex:1,backgroundColor:"#102335",borderRadius:5,padding:7,minHeight:58},moneyInput:{color:"#fff",fontSize:13,fontWeight:"900",padding:0,marginTop:5},nextAmount:{color:"#54D79A",fontSize:15,fontWeight:"900",marginTop:6},strategyScroll:{marginTop:6,maxHeight:30},strategyRow:{gap:4},strategyChip:{height:25,paddingHorizontal:8,borderRadius:4,backgroundColor:"#172B3B",justifyContent:"center"},strategyChipActive:{backgroundColor:"#2B78B5"},strategyChipText:{color:"#AABCC8",fontSize:7.5,fontWeight:"800"},progressBox:{marginTop:6,backgroundColor:"#0B1925",borderRadius:5,padding:7},progressText:{color:"#DDE9F0",fontSize:9,fontWeight:"800",marginTop:4},recommendHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},martinResetMini:{paddingHorizontal:7,height:20,borderRadius:4,backgroundColor:"#214A70",alignItems:"center",justifyContent:"center"},martinResetMiniText:{color:"#fff",fontSize:8,fontWeight:"900"},martinResetBtn:{marginTop:7,height:27,borderRadius:4,backgroundColor:"#214A70",alignItems:"center",justifyContent:"center"},martinResetText:{color:"#fff",fontSize:9,fontWeight:"900"},betButtons:{flexDirection:"row",gap:5},betBtn:{flex:1,height:38,borderRadius:5,alignItems:"center",justifyContent:"center"},betBtnText:{color:"#fff",fontSize:12,fontWeight:"900"},statsGrid:{marginTop:6,backgroundColor:"#102335",borderRadius:5,padding:7,flexDirection:"row",justifyContent:"space-between"},statsValue:{color:"#fff",fontSize:11,fontWeight:"900",marginTop:3},recordBar:{marginTop:5,flexDirection:"row",justifyContent:"space-between",alignItems:"center"},resetText:{color:"#51BDF1",fontSize:8,fontWeight:"900"},historyRow:{gap:4,marginTop:5},historyChip:{backgroundColor:"#142A3B",borderRadius:4,paddingHorizontal:6,paddingVertical:4},pageDots:{height:19,flexDirection:"row",gap:7,alignItems:"center",justifyContent:"center"},pageDot:{width:6,height:6,borderRadius:3,backgroundColor:"#526574"},pageDotActive:{backgroundColor:"#fff"},
  recommendTitleConfidence:{flexDirection:"row",alignItems:"center",gap:5},
  recommendMetaRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:3,marginTop:3},recommendStrategyMeta:{marginTop:0,flexShrink:1},confidenceInline:{flexDirection:"row",alignItems:"center",gap:4,flexShrink:0},confidenceText:{fontSize:8,fontWeight:"900",textShadowRadius:7},
  radarLauncher:{position:"absolute",top:66,right:14,zIndex:90,width:210,height:32,paddingHorizontal:9,borderRadius:7,borderWidth:1,borderColor:"#315D79",backgroundColor:"rgba(7,21,33,.97)",flexDirection:"row",alignItems:"center",gap:6,shadowColor:"#63C7FF",shadowOpacity:.20,shadowRadius:8,elevation:18,touchAction:"none" as any,userSelect:"none" as any,cursor:"grab" as any},radarLauncherMt:{zIndex:9998},radarLauncherMobile:{top:61,right:8,width:188},radarLauncherText:{color:"#EAF6FF",fontSize:9,fontWeight:"900"},radarLauncherBestWrap:{marginLeft:"auto",flexDirection:"row",alignItems:"center",gap:4},radarLauncherBest:{fontSize:8,fontWeight:"900"},
  radarPanel:{position:"absolute",top:66,left:14,right:14,zIndex:90,height:92,borderRadius:9,borderWidth:1,borderColor:"#315D79",backgroundColor:"rgba(6,18,29,.985)",paddingHorizontal:8,paddingVertical:6,shadowColor:"#63C7FF",shadowOpacity:.13,shadowRadius:10,elevation:18},radarPanelMt:{zIndex:9998},radarPanelMobile:{top:61,left:7,right:7,height:144},radarHead:{height:27,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},radarKicker:{color:"#62B6E8",fontSize:6.5,fontWeight:"900",letterSpacing:1},radarTitleRow:{flexDirection:"row",alignItems:"center",gap:8},radarTitle:{color:"#F4FAFF",fontSize:11,fontWeight:"900"},radarBest:{color:"#63C7FF",fontSize:8,fontWeight:"900"},radarWaiting:{color:"#82929D",fontSize:8,fontWeight:"800"},radarClose:{width:26,height:24,borderRadius:5,borderWidth:1,borderColor:"#315D79",backgroundColor:"#0B1A28",alignItems:"center",justifyContent:"center"},radarRail:{gap:5,paddingRight:4,alignItems:"center"},radarRailMobile:{alignItems:"flex-start",paddingBottom:2},radarMobileColumn:{gap:5},radarCard:{width:92,height:50,borderRadius:6,borderWidth:1,borderColor:"#31495A",backgroundColor:"#0B1924",paddingHorizontal:6,paddingVertical:5},radarCardMobile:{width:104,height:52},radarCardBest:{borderColor:"#63C7FF",backgroundColor:"#0D2232",shadowColor:"#63C7FF",shadowOpacity:.30,shadowRadius:7,elevation:6},radarCardTop:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},radarRoom:{color:"#E8EEF2",fontSize:8,fontWeight:"900"},radarPick:{color:"#EAF8FF",backgroundColor:"#156A95",borderRadius:3,paddingHorizontal:4,paddingVertical:1,fontSize:5.5,fontWeight:"900",borderWidth:1,borderColor:"#63C7FF"},radarCardMain:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginTop:7},radarSideLine:{flexDirection:"row",alignItems:"center",gap:5},radarSide:{fontSize:12,fontWeight:"900"},radarConfidence:{flexDirection:"row",alignItems:"center",gap:2},radarConfidenceText:{fontSize:8,fontWeight:"900"},radarPattern:{color:"#91A6B4",fontSize:6.5,fontWeight:"800",marginTop:1},signalDot:{width:9,height:9,borderRadius:4.5,borderWidth:1,borderColor:"rgba(255,255,255,.45)",shadowOpacity:1,shadowRadius:9,elevation:10},signalDotSmall:{width:7,height:7,borderRadius:3.5,borderWidth:1,borderColor:"rgba(255,255,255,.50)",shadowOpacity:1,shadowRadius:8,elevation:9},
  radarDetailModal:{width:"96%",maxWidth:900,backgroundColor:"#0A1721",borderWidth:1,borderColor:"#315D79",borderRadius:10,padding:12},radarDetailTitle:{color:"#F4FAFF",fontSize:16,fontWeight:"900",marginTop:2},radarDetailStats:{flexDirection:"row",gap:6,marginBottom:8,flexWrap:"wrap"},radarDetailStat:{flexGrow:1,minWidth:90,backgroundColor:"#102335",borderWidth:1,borderColor:"#294B64",borderRadius:6,paddingHorizontal:8,paddingVertical:6},radarDetailLabel:{color:"#AFC1CD",fontSize:7,fontWeight:"800"},radarDetailValue:{color:"#F3F7F9",fontSize:11,fontWeight:"900",marginTop:2},radarDetailConfidence:{flexDirection:"row",alignItems:"center",gap:5,marginTop:2},radarRoadWrap:{backgroundColor:"#07131D",borderRadius:7,overflow:"hidden",borderWidth:1,borderColor:"#315D79"},radarDetailNote:{color:"#C6D2DB",fontSize:9,lineHeight:14,marginTop:8},
  matrixMark:{backgroundColor:"#071521",borderWidth:1,borderColor:"#4DA8D8",alignItems:"center",justifyContent:"center",overflow:"hidden",shadowColor:"#57C7FF",shadowOpacity:.26,shadowRadius:6,elevation:3},matrixMarkInner:{width:"72%",height:"72%",borderRadius:5,borderWidth:1,borderColor:"rgba(107,205,255,.45)",backgroundColor:"rgba(20,72,102,.22)",alignItems:"center",justifyContent:"center"},matrixMarkAccent:{position:"absolute",bottom:"13%",width:"46%",height:2,borderRadius:1,backgroundColor:"#53D1F5",shadowColor:"#53D1F5",shadowOpacity:.9,shadowRadius:4},matrixMarkAccentDg:{backgroundColor:"#D3A64D",shadowColor:"#D3A64D"},matrixMarkText:{color:"#EAF9FF",fontWeight:"900",letterSpacing:-.9,textShadowColor:"#5FD4FF",textShadowRadius:5},matrixMarkTextDg:{color:"#FFE7A5",textShadowColor:"#C99C42"},threadsSignature:{flexDirection:"row",alignItems:"center",gap:4},threadsGlyph:{color:"#F2F8FC",fontSize:11,fontWeight:"900",borderWidth:1,borderColor:"#557487",borderRadius:8,width:16,height:16,lineHeight:14,textAlign:"center"},threadsId:{color:"#D9E3EA",fontSize:10.5,fontWeight:"900",letterSpacing:.15},threadsSignatureMobile:{marginTop:1,gap:3},threadsWord:{color:"#F2F8FC",fontSize:8.5,fontWeight:"900",letterSpacing:.15},threadsIdMobile:{fontSize:9.5},
  floatPanelMobile:{left:18,top:170,right:"auto" as any,bottom:"auto" as any,borderRadius:9},floatHeaderMobile:{height:28,paddingHorizontal:6},selectorWrapMobile:{marginHorizontal:5,marginTop:4},selectorMobile:{height:28,paddingHorizontal:7},assistPageMobile:{paddingHorizontal:5,paddingTop:4,paddingBottom:2,minHeight:96},decisionRowMobile:{gap:4},decisionBoxMobile:{minHeight:46,paddingHorizontal:5,paddingVertical:4},todayPnlBoxMobile:{marginTop:3,paddingHorizontal:7,paddingVertical:3},aiBoxMobile:{marginTop:3,paddingHorizontal:5,paddingVertical:4},pageDotsMobile:{height:12},
  loginScreen:{flex:1,backgroundColor:"#020A12",alignItems:"center",justifyContent:"center",padding:18,overflow:"hidden"},loginVideo:{...StyleSheet.absoluteFillObject},loginShade:{...StyleSheet.absoluteFillObject,backgroundColor:"rgba(2,10,18,.46)"},loginPanel:{width:"100%",maxWidth:480,backgroundColor:"rgba(7,31,44,.76)",borderWidth:1,borderColor:"rgba(82,151,177,.62)",borderRadius:18,padding:18,shadowColor:"#000",shadowOpacity:.4,shadowRadius:20,elevation:14},loginTopline:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:26},loginTopText:{color:"#A9BED0",fontSize:9,letterSpacing:1.8,fontWeight:"700"},loginSafe:{color:"#39E0B0",fontSize:9,fontWeight:"800"},loginHero:{flexDirection:"row",alignItems:"stretch",width:"100%",marginBottom:16,minHeight:112},loginHeroMobile:{minHeight:108},loginBrandMobile:{flex:1.9,gap:8,paddingRight:7},loginTitleMobile:{fontSize:23,letterSpacing:-.45},threadsCardMobile:{flex:.82,minWidth:166,marginLeft:7,paddingHorizontal:10},loginBrand:{flex:1.9,flexDirection:"row",alignItems:"center",justifyContent:"flex-start",gap:13,paddingLeft:2,paddingRight:12},loginBrandCopy:{flexShrink:1},loginIcon:{width:56,height:56,borderRadius:14,borderWidth:1,borderColor:"#315D79",alignItems:"center",justifyContent:"center",backgroundColor:"rgba(5,20,31,.34)"},loginKicker:{color:"#8DB4CE",fontSize:10,letterSpacing:1.5,fontWeight:"800"},loginTitle:{color:"#F5F8FA",fontSize:28,fontWeight:"900",marginTop:5},loginSub:{color:"#91A7B8",fontSize:11.5,marginTop:4},loginSubMobile:{fontSize:9.5,letterSpacing:-.2},loginHeroDivider:{width:1,marginVertical:7,backgroundColor:"rgba(111,169,197,.25)"},threadsCard:{flex:.9,minWidth:142,marginLeft:13,paddingHorizontal:14,paddingVertical:9,borderRadius:15,borderWidth:1,borderColor:"rgba(108,177,205,.40)",backgroundColor:"rgba(3,18,29,.32)",justifyContent:"center"},threadsHead:{flexDirection:"row",alignItems:"center",gap:6},threadsLogo:{width:32,height:32,borderRadius:9,borderWidth:1,borderColor:"rgba(224,243,255,.52)",backgroundColor:"rgba(255,255,255,.07)",alignItems:"center",justifyContent:"center"},threadsLogoText:{color:"#F5FBFF",fontSize:22,fontWeight:"900",lineHeight:26},threadsLabel:{color:"#A9C4D6",fontSize:9,fontWeight:"900",letterSpacing:1.35},threadsName:{color:"#F5F9FC",fontSize:17,fontWeight:"900",marginTop:6},threadsAccount:{color:"#56D7D0",fontSize:14,fontWeight:"900",marginTop:1},threadsFollow:{height:34,marginTop:6,borderRadius:8,borderWidth:1,borderColor:"rgba(78,192,235,.65)",backgroundColor:"rgba(23,128,180,.22)",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:4},threadsFollowPressed:{opacity:.72,transform:[{scale:.985}]},threadsFollowText:{color:"#EAF8FF",fontSize:10,fontWeight:"900",letterSpacing:1.15},loginDivider:{height:1,backgroundColor:"rgba(109,157,184,.32)",marginBottom:20},loginHintRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:11},loginHint:{color:"#A7B8C5",fontSize:11,flexShrink:1},registerBtn:{height:28,paddingHorizontal:11,borderRadius:7,borderWidth:1,borderColor:"rgba(66,185,245,.68)",backgroundColor:"rgba(22,140,235,.16)",alignItems:"center",justifyContent:"center",flexShrink:0},registerBtnPressed:{opacity:.72},registerBtnText:{color:"#42B9F5",fontSize:10,fontWeight:"900"},kickNotice:{color:"#FFB4B9",fontSize:10,fontWeight:"800",lineHeight:15,backgroundColor:"rgba(132,35,45,.22)",borderWidth:1,borderColor:"rgba(255,105,115,.35)",borderRadius:7,paddingHorizontal:10,paddingVertical:8,marginTop:-8,marginBottom:14},loginLabel:{color:"#B9C8D3",fontSize:11,fontWeight:"700",marginBottom:6},loginInput:{height:48,backgroundColor:"rgba(2,17,28,.68)",borderRadius:8,borderWidth:1,borderColor:"#385B70",color:"#fff",paddingHorizontal:14,fontSize:14,marginBottom:14},passwordWrap:{height:48,backgroundColor:"rgba(2,17,28,.68)",borderRadius:8,borderWidth:1,borderColor:"#385B70",flexDirection:"row",alignItems:"center",marginBottom:16},passwordInput:{flex:1,height:"100%",color:"#fff",paddingHorizontal:14,fontSize:14},eyeBtn:{width:46,height:"100%",alignItems:"center",justifyContent:"center"},loginBtn:{height:50,backgroundColor:"#168CEB",borderRadius:8,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:8},loginBtnText:{color:"#fff",fontSize:14,fontWeight:"900"},error:{color:"#FF959C",fontSize:11,textAlign:"center",marginTop:10},loginFooterRow:{marginTop:10,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:7,flexWrap:"nowrap"},loginFooterLeft:{flexDirection:"row",alignItems:"center",gap:4},loginFooterDivider:{color:"rgba(145,171,188,.55)",fontSize:10},loginFoot:{color:"#71899A",fontSize:8.5,textAlign:"center"},loginHelp:{color:"#42B9F5",fontSize:10,fontWeight:"800",textAlign:"center",marginTop:0},
  modalShade:{flex:1,backgroundColor:"rgba(0,0,0,.72)",alignItems:"center",justifyContent:"center",padding:16},stopLossShade:{flex:1,backgroundColor:"rgba(0,0,0,.62)",alignItems:"center",justifyContent:"center",padding:14,zIndex:20000},stopLossModal:{width:"88%",maxWidth:300,backgroundColor:"#101E2A",borderWidth:1,borderColor:"#315D79",borderRadius:9,padding:11,shadowColor:"#000",shadowOpacity:.5,shadowRadius:18,elevation:30},stopLossHead:{height:25,flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:7},stopLossTitleWrap:{flexDirection:"row",alignItems:"center",gap:6},stopLossTitle:{color:"#F1F7FB",fontSize:13,fontWeight:"900"},stopLossClose:{width:24,height:24,alignItems:"center",justifyContent:"center"},stopLossRow:{height:31,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderTopWidth:1,borderTopColor:"#20384A"},stopLossLabel:{color:"#B8C9D4",fontSize:10,fontWeight:"800"},stopLossBalance:{color:"#F3F8FB",fontSize:13,fontWeight:"900"},stopLossPrincipalRow:{height:38,flexDirection:"row",alignItems:"center",gap:8},stopLossInput:{flex:1,height:30,borderWidth:1,borderColor:"#36536A",borderRadius:5,backgroundColor:"#08131D",color:"#fff",paddingHorizontal:8,fontSize:11,fontWeight:"800"},useBalanceBtn:{alignSelf:"flex-end",height:24,paddingHorizontal:8,borderRadius:4,backgroundColor:"#173B56",borderWidth:1,borderColor:"#315D79",alignItems:"center",justifyContent:"center",marginBottom:5},useBalanceBtnText:{color:"#BDE8FF",fontSize:8,fontWeight:"900"},stopLossPercentRow:{height:34,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderTopWidth:1,borderTopColor:"#20384A"},stopLossStepper:{flexDirection:"row",alignItems:"center",gap:7},stepBtn:{width:25,height:24,borderRadius:4,backgroundColor:"#173B56",alignItems:"center",justifyContent:"center"},stepBtnText:{color:"#fff",fontSize:16,fontWeight:"900",lineHeight:18},stopLossPercent:{minWidth:38,textAlign:"center",color:"#F5FAFD",fontSize:12,fontWeight:"900"},stopLossThresholdRow:{height:33,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderTopWidth:1,borderTopColor:"#20384A"},stopLossThreshold:{color:"#FFCB66",fontSize:13,fontWeight:"900"},stopLossEnableBtn:{height:32,borderRadius:5,backgroundColor:"#1E7AB5",alignItems:"center",justifyContent:"center",marginTop:5},stopLossEnableText:{color:"#fff",fontSize:10,fontWeight:"900"},stopLossAlertModal:{width:"82%",maxWidth:270,backgroundColor:"#101E2A",borderWidth:1,borderColor:"#6B5A32",borderRadius:10,paddingHorizontal:15,paddingVertical:14,alignItems:"center",shadowColor:"#000",shadowOpacity:.55,shadowRadius:18,elevation:31},stopLossAlertIcon:{width:38,height:38,borderRadius:19,backgroundColor:"rgba(255,203,102,.10)",alignItems:"center",justifyContent:"center",marginBottom:5},stopLossAlertTitle:{color:"#FFF3D2",fontSize:15,fontWeight:"900"},stopLossAlertText:{color:"#F1F6F9",fontSize:11,fontWeight:"900",marginTop:7,textAlign:"center"},stopLossAlertSub:{color:"#AFC0CB",fontSize:9.5,marginTop:4,textAlign:"center"},stopLossAckBtn:{height:31,minWidth:108,borderRadius:5,backgroundColor:"#1E7AB5",alignItems:"center",justifyContent:"center",marginTop:11,paddingHorizontal:14},stopLossAckText:{color:"#fff",fontSize:10,fontWeight:"900"},connectionModal:{width:"100%",maxWidth:760,maxHeight:"92%",backgroundColor:"#162231",borderWidth:1,borderColor:"#31506A",borderRadius:8,padding:18},smallModal:{width:"100%",maxWidth:520,backgroundColor:"#162231",borderWidth:1,borderColor:"#31506A",borderRadius:8,padding:18},modalHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:12},modalTitle:{color:"#fff",fontSize:17,fontWeight:"800"},modalNote:{color:"#BAC7D0",fontSize:10,lineHeight:15,backgroundColor:"#0C1721",padding:10,borderRadius:5,marginBottom:12},fieldLabel:{color:"#C6D3DC",fontSize:10,marginBottom:5,marginTop:8},modalInput:{height:42,borderWidth:1,borderColor:"#36536A",borderRadius:5,backgroundColor:"#08131D",color:"#fff",paddingHorizontal:10},connectionStatusRow:{flexDirection:"row",gap:8,marginBottom:4},connectionStatusCard:{flex:1,borderWidth:1,borderColor:"#36536A",borderRadius:6,backgroundColor:"#08131D",paddingHorizontal:10,paddingVertical:8},connectionStatusText:{fontSize:13,fontWeight:"900",marginTop:2},mappingRow:{flexDirection:"row",gap:6,marginTop:10,flexWrap:"wrap"},mapChip:{color:"#C8D4DD",fontSize:9,backgroundColor:"#263A4C",paddingHorizontal:8,paddingVertical:6,borderRadius:4},modalActions:{flexDirection:"row",gap:7,marginTop:12,flexWrap:"wrap"},actionBtn:{height:38,paddingHorizontal:12,borderRadius:5,justifyContent:"center"},btnText:{color:"#fff",fontWeight:"900",fontSize:10},syncText:{color:"#AFC0CB",fontSize:9,marginTop:11},logBox:{height:130,backgroundColor:"#08131D",borderRadius:5,padding:9,marginTop:4},logText:{color:"#B8C8D2",fontSize:8,lineHeight:13},helpText:{color:"#D2DDE4",fontSize:11,lineHeight:18},
  mtOverlay:{...StyleSheet.absoluteFillObject,zIndex:500,backgroundColor:"#05090E"},mtScreen:{flex:1,backgroundColor:"#05090E"},mtTop:{minHeight:58,paddingHorizontal:14,flexDirection:"row",alignItems:"center",justifyContent:"space-between",backgroundColor:"#10202D",borderBottomWidth:1,borderBottomColor:"#28465A"},mtTitle:{color:"#fff",fontSize:15,fontWeight:"900"},iframeWrap:{flex:1},nativeMtFallback:{flex:1,alignItems:"center",justifyContent:"center"},toast:{position:"absolute",bottom:78,left:20,right:20,backgroundColor:"#203A4E",borderRadius:8,padding:9,zIndex:200},toastText:{color:"#fff",textAlign:"center",fontSize:10}
});
