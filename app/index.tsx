import { createElement, useEffect, useMemo, useRef, useState } from "react";
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
import * as Linking from "expo-linking";
import { useVideoPlayer, VideoView } from "expo-video";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import {
  applyLiveShowWin,
  applyLiveTables,
  applyLiveWait,
  getApiTableId,
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

type Result = RoadResult;
type TableData = {
  id: string; apiId?: string; game: string; name: string; players: string;
  countdown?: number; countdownUpdatedAt?: number; roomId?: string; tableBadge?: string;
  shoe: string; round: number; banker: number; player: number; tie: number;
  results: Result[]; trend: string; live?: boolean; dealerPhoto?: string; dealerId?: string;
  lastUpdated?: number; lastResultKey?: string;
};

type StrategyName = "平注" | "馬丁" | "達朗貝爾" | "Fibonacci" | "Paroli" | "1-3-2-6" | "Labouchere" | "Oscar's Grind";
type BetSide = "莊" | "閒" | "和";
type BetRecord = { side: BetSide; result: Result; amount: number; pnl: number; at: number };
type PendingBet = { tableId: string; side: BetSide; amount: number; resultKey?: string } | null;

const baccaratTableIds = ["BAG01","BAG02","BAG03","BAG03A","BAG05","BAG06","BAG07","BAG08","BAG09","BAG10","BAG11","BAG12","BAG13","BAG13A","BAG15"];
const initialTables: TableData[] = baccaratTableIds.map((apiId) => ({
  id: apiId.replace(/^BAG0?/, ""), apiId, game: "百家樂", name: "—", players: "—",
  roomId: "—", tableBadge: "—", shoe: "—", round: 0, banker: 0, player: 0, tie: 0,
  results: [], trend: "",
}));
const lineContactUrl = "https://line.me/ti/p/7DdkANrGbj";
const resultColor = (r?: Result) => r === "莊" ? "#EF4E57" : r === "閒" ? "#2879E5" : r === "和" ? "#20B66B" : "#70889A";
const strategies: StrategyName[] = ["平注","馬丁","達朗貝爾","Fibonacci","Paroli","1-3-2-6","Labouchere","Oscar's Grind"];

function openLineContact() {
  if (typeof window !== "undefined") window.open(lineContactUrl, "_blank", "noopener,noreferrer");
  else Linking.openURL(lineContactUrl).catch(() => undefined);
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

type ConfidenceLevel = "高" | "中" | "低";

function confidencePercent(scoreBanker: number, scorePlayer: number) {
  // Preserve the original radar's score-gap confidence model, but expose it as a percentage.
  // gap 0/1 = weak (<50), gap 2/3 = medium (50-79), gap 4+ = strong (80+).
  const gap = Math.abs(scoreBanker - scorePlayer);
  return Math.max(35, Math.min(99, Math.round(35 + gap * 12)));
}

function confidenceLevel(scoreBanker: number, scorePlayer: number): ConfidenceLevel {
  const pct = confidencePercent(scoreBanker, scorePlayer);
  if (pct >= 80) return "高";
  if (pct >= 50) return "中";
  return "低";
}

function confidenceGlowColor(percent: number) {
  if (percent >= 80) return "#F3C85B";
  if (percent >= 50) return "#79D8FF";
  return "#FFFFFF";
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
    `【綜合】莊 ${d.scoreBanker.toFixed(1)}／閒 ${d.scorePlayer.toFixed(1)}，可信度${confidenceLevel(d.scoreBanker,d.scorePlayer)}，整段牌路與三路問路綜合後，我會選${d.side}。`
  ].join("\n");
}

function strategyAmount(name: StrategyName, base: number, level: number, lab: number[]) {
  const b = Math.max(0, base || 0);
  if (name === "馬丁") return b * Math.pow(2, Math.max(0, level));
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

function ResultDot({ result, desktop, transparent=false }: { result: Result; desktop: boolean; transparent?:boolean }) {
  const color = result === "莊" ? ROAD_SPEC.colors.solidRed : result === "閒" ? ROAD_SPEC.colors.solidBlue : ROAD_SPEC.colors.tie;
  return <View style={[s.beadDot, desktop && s.beadDotDesktop,transparent&&s.beadDotGlass, { backgroundColor: color, borderColor:transparent?"#FFFFFF":color }]}>
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
function RoadGrid({ table, desktop, transparent=false }: { table: TableData; desktop: boolean; transparent?:boolean }) {
  const beads = useMemo(() => buildSlidingBeadGrid(table.results), [table.results]);
  const big = useMemo(() => buildRoadWindow(buildBigRoad(table.results), 15), [table.results]);
  const lower = useMemo(() => [
    buildRoadWindow(buildDerivedRoad(table.results, 1, false), 10),
    buildRoadWindow(buildDerivedRoad(table.results, 2, true), 10),
    buildRoadWindow(buildDerivedRoad(table.results, 3, false), 10),
  ], [table.results]);
  return <View style={[s.roadArea, desktop && s.roadAreaDesktop,transparent&&s.roadGlass]}>
    <View style={[s.beadPane, desktop && s.beadPaneDesktop,transparent&&s.beadPaneGlass]}><View style={[s.beadGrid,transparent&&s.beadGridGlass]}>{Array.from({length:36},(_,i)=><View key={i} style={[s.beadCell,desktop&&s.beadCellDesktop,transparent&&s.beadCellGlass]}>{beads[i]?<ResultDot result={beads[i]!} desktop={desktop} transparent={transparent}/>:null}</View>)}</View></View>
    <View style={s.roadStack}>
      <View style={[s.bigGrid,desktop&&s.bigGridDesktop]}>{Array.from({length:90},(_,i)=>{ const row=Math.floor(i/15),col=i%15,m=big.find(x=>x.row===row&&x.col===col); return <View key={i} style={[s.bigCell,desktop&&s.bigCellDesktop,transparent&&s.roadCellGlass]}>{m?<View style={[s.bigMark,desktop&&s.bigMarkDesktop,transparent&&s.bigMarkGlass,{borderColor:m.result==="莊"?ROAD_SPEC.colors.hollowRed:m.result==="閒"?ROAD_SPEC.colors.hollowBlue:ROAD_SPEC.colors.tie}]}>{m.tieCount?<Text style={[s.tieNumber,desktop&&s.tieNumberDesktop]}>{m.tieCount}</Text>:null}</View>:null}</View> })}</View>
      <View style={[s.lowerArea,desktop&&s.lowerAreaDesktop]}>{lower.map((road,ri)=><View key={ri} style={s.lowerPane}>{Array.from({length:60},(_,i)=>{ const row=Math.floor(i/10),col=i%10,m=road.find(x=>x.row===row&&x.col===col); if(!m)return <View key={i} style={[s.lowerCell,desktop&&s.lowerCellDesktop,transparent&&s.roadCellGlass]}/>; const color=derivedColor(ri,m.result); return <View key={i} style={[s.lowerCell,desktop&&s.lowerCellDesktop,transparent&&s.roadCellGlass]}>{ri===0?<View style={[s.lowerHollow,transparent&&s.lowerHollowGlass,{borderColor:color}]}/>:ri===1?<View style={[s.lowerSolid,transparent&&s.lowerSolidGlass,{backgroundColor:color}]}/>:<View style={[s.lowerSlash,transparent&&s.lowerSlashGlass,{backgroundColor:color}]}/>}</View> })}</View>)}</View>
    </View>
  </View>;
}

function CountdownBadge({count,updatedAt}:{count?:number;updatedAt?:number}){
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[]);
  const elapsed=updatedAt?Math.floor((now-updatedAt)/1000):0;
  return <View style={s.countWrap}><MaterialIcons name="schedule" size={11} color="#DDE8F0"/><Text style={s.countdown}>{count==null?"—":Math.max(0,count-elapsed)}</Text></View>;
}

function TableCard({table,desktop,onAction}:{table:TableData;desktop:boolean;onAction:(kind:string,table:TableData)=>void}){
  return <View style={[s.tableCard,desktop&&s.tableCardDesktop]}>
    <View style={s.tableHead}>
      <View style={s.row}><View style={s.vipMark}><MaterialIcons name="diamond" size={11} color="#E1C477"/></View><View><Text style={s.game}>BACCARAT · LIVE</Text><Text style={s.tableId}>{table.id}</Text></View></View>
      <View style={s.row}><View style={s.playerBadge}><MaterialIcons name="person-outline" size={11} color="#D7B76A"/><Text style={s.headText}>{table.players}</Text></View><CountdownBadge count={table.countdown} updatedAt={table.countdownUpdatedAt}/></View>
    </View>
    <View style={s.tableStatusRail}>
      <View style={s.tableStats}><Text style={[s.statText,{color:"#F35762"}]}>BANKER {table.banker}</Text><Text style={[s.statText,{color:"#4D96F3"}]}>PLAYER {table.player}</Text><Text style={[s.statText,{color:"#45C98A"}]}>TIE {table.tie}</Text></View>
      <View style={s.row}><Pressable style={s.miniBtn} onPress={()=>onAction("分析",table)}><MaterialIcons name="auto-graph" size={11} color="#D7B76A"/><Text style={s.miniBtnText}>分析</Text></Pressable><Pressable style={s.miniBtn} onPress={()=>onAction("關注",table)}><MaterialIcons name="star-border" size={11} color="#D7B76A"/><Text style={s.miniBtnText}>關注</Text></Pressable><Pressable style={[s.miniBtn,s.miniBtnPrimary]} onPress={()=>onAction("MT平台",table)}><MaterialIcons name="open-in-new" size={11} color="#090704"/><Text style={s.miniBtnPrimaryText}>MT</Text></Pressable></View>
    </View>
    <View style={[s.tableBody,desktop?s.tableBodyDesktop:s.tableBodyMobile]}>
      <View style={[s.dealer,desktop?s.dealerDesktop:s.dealerMobile]}>
        <View style={[s.photo,desktop?s.photoDesktop:s.photoMobile]}>{table.dealerPhoto?<Image source={{uri:table.dealerPhoto}} style={s.photoImage}/>:<MaterialIcons name="person" size={30} color="#B89952"/>}</View>
        <View style={s.dealerPlate}><Text numberOfLines={1} style={s.dealerName}>{table.name||"—"}</Text><Text style={s.meta}>ROOM {table.roomId||table.id}</Text><Text style={s.meta}>SHOE {table.shoe} · ROUND {table.round}</Text></View>
      </View>
      <RoadGrid table={table} desktop={desktop}/>
    </View>
  </View>;
}

const MemoTableCard = TableCard;

function FloatingOrb({
  position,
  responder,
  size,
  iconSize,
  connected,
  insideMt = false,
}: {
  position: Animated.ValueXY;
  responder: ReturnType<typeof PanResponder.create>;
  size: number;
  iconSize: number;
  connected: boolean;
  insideMt?: boolean;
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
      <Image source={{uri:"/login-logo-v2.png"}} style={{width:iconSize*1.45,height:iconSize*1.45,resizeMode:"contain"}} />
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
}

function AccessScreen({onAuthenticated}:{onAuthenticated:()=>void}){
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
  const login=trpc.trackerAccess.login.useMutation({onSuccess:r=>r.success?(setError(""),onAuthenticated()):setError("帳號或密碼不正確"),onError:()=>setError("登入驗證暫時無法完成")});
  const submit=()=>{if(!username.trim()||!password){setError("請輸入帳號與密碼");return}login.mutate({username,password})};
  return <ScreenContainer edges={["top","left","right","bottom"]} containerClassName="bg-[#050403]" className="bg-[#050403]">
    <View style={s.loginScreen}>{Platform.OS==="web"?createElement("video" as any,{ref:(node:any)=>{webVideoRef.current=node},src:"/poker.mp4",autoPlay:true,muted:true,defaultMuted:true,playsInline:true,preload:"auto",controls:false,disablePictureInPicture:true,style:{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",pointerEvents:"none"},onLoadedData:(e:any)=>{const v=e.currentTarget;v.muted=true;v.defaultMuted=true;void v.play?.().catch?.(()=>undefined)},onCanPlay:(e:any)=>{const v=e.currentTarget;v.muted=true;void v.play?.().catch?.(()=>undefined)},onEnded:(e:any)=>{const v=e.currentTarget;playCount.current+=1;if(playCount.current<2){v.currentTime=0;void v.play?.().catch?.(()=>undefined)}else{v.pause()}}}):<VideoView player={player} style={s.loginVideo} contentFit="cover" nativeControls={false}/>}<View style={s.loginShade}/><View style={s.loginPanel}>
      <View style={s.loginBrand}><View style={[s.loginIcon,{backgroundColor:"rgba(8,7,5,.80)"}]}><Image source={{uri:"/login-logo-v2.png"}} style={s.loginLogoImage}/></View><View style={s.loginBrandCopy}><Text style={s.loginTitle}>MTmatrlx</Text><Text style={s.loginChineseName}>MT破解屍</Text></View></View>
      <View style={s.loginDivider}/><View style={s.loginAccessHead}><View><Text style={s.loginAccessTitle}>會員登入</Text><Text style={s.loginHint}>請輸入帳號與密碼進入系統</Text></View><View style={s.loginLock}><MaterialIcons name="lock" size={16} color="#C1A96F"/></View></View>
      <Text style={s.loginLabel}>帳號</Text><View style={s.loginFieldWrap}><MaterialIcons name="person-outline" size={19} color="#A18B62"/><TextInput value={username} onChangeText={setUsername} placeholder="請輸入帳號" placeholderTextColor="#6F614A" autoCapitalize="none" autoCorrect={false} style={s.loginFieldInput}/></View>
      <Text style={s.loginLabel}>密碼</Text><View style={s.passwordWrap}><MaterialIcons name="lock-outline" size={18} color="#A18B62"/><TextInput value={password} onChangeText={setPassword} placeholder="請輸入密碼" placeholderTextColor="#6F614A" secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} style={s.passwordInput} onSubmitEditing={submit}/><Pressable style={s.eyeBtn} onPress={()=>setShowPassword(v=>!v)}><MaterialIcons name={showPassword?"visibility-off":"visibility"} size={19} color="#A58C60"/></Pressable></View>
      <Pressable style={[s.loginBtn,login.isPending&&s.loginBtnPending]} onPress={submit} disabled={login.isPending}><View style={s.loginBtnIcon}><MaterialIcons name="verified-user" size={18} color="#0A0805"/></View><Text style={s.loginBtnText}>{login.isPending?"正在驗證":"登入 MTmatrlx"}</Text><MaterialIcons name="arrow-forward" size={18} color="#0A0805"/></Pressable>{error?<Text style={s.error}>{error}</Text>:null}
      <View style={s.loginBottomRow}><View style={s.loginSecureNote}><MaterialIcons name="verified" size={13} color="#CDB16B"/><Text style={s.loginFoot}>加密驗證 · 不儲存登入密碼</Text></View><Pressable onPress={openLineContact} style={s.loginHelpBtn}><MaterialIcons name="support-agent" size={15} color="#D7B76A"/><Text style={s.loginHelp}>LINE 客服</Text></Pressable></View>
    </View></View>
  </ScreenContainer>;
}

function eventName(payload:any){return typeof payload?.action==="string"?payload.action:payload?.action?.name??payload?.name??""}
function eventTables(payload:any):any[]|null{const c=[payload?.msg?.tables?.tables,payload?.msg?.tables,payload?.data?.tables?.tables,payload?.data?.tables,payload?.tables?.tables,payload?.tables];return c.find(Array.isArray)??null}
function extractMtUrlToken(value:string){try{return new URL(value.trim()).searchParams.get("token")?.trim()??""}catch{return value.trim().replace(/^token=/i,"")}}
function resultKeyFromPayload(payload:any){const b=payload?.body??payload?.msg??payload?.data??{};return `${String(b?.shoe??"")}|${String(b?.round??"")}`}

/**
 * Keep exactly one shoe per table.
 * MT tables/tablesvg snapshots are the authoritative road for the current shoe.
 * show_win is only a fast incremental update while waiting for the next snapshot.
 * A real shoe-id change starts a fresh road; round changes never trigger a shoe reset.
 */
function applyTablesSameShoe(current: TableData[], sources: any[]): TableData[] {
  const next = applyLiveTables(current, sources) as TableData[];
  return next.map((table) => {
    const prev = current.find((x) => (x.apiId ?? `BAG${x.id}`) === (table.apiId ?? `BAG${table.id}`));
    if (!prev) return table;

    const prevShoe = String(prev.shoe ?? "");
    const nextShoe = String(table.shoe ?? "");

    // Only an actual shoe-id change is a shoe change.
    if (prevShoe && prevShoe !== "—" && nextShoe && nextShoe !== "—" && prevShoe !== nextShoe) {
      return { ...table, results: [...table.results] };
    }

    // Same shoe: when MT supplies a non-empty snapshot, trust it even if it is
    // shorter than our locally appended show_win history. This lets the app
    // automatically repair a missed/duplicate/out-of-order live event instead
    // of requiring a manual reconnect.
    const source = sources.find((item) => {
      const sourceId = getApiTableId(item);
      const tableId = table.apiId ?? `BAG${table.id}`;
      return sourceId === tableId || String(item?.table_name ?? "") === table.id;
    });
    const trend = source?.trend ?? {};
    const rawSnapshot = trend?.bead_plate2 ?? trend?.bead_plate ?? source?.bead_plate2;
    const hasSnapshot = Array.isArray(rawSnapshot) ? rawSnapshot.length > 0 : typeof rawSnapshot === "string" && rawSnapshot.replace(/[^0-9]/g, "").length >= 2;

    if (hasSnapshot) return table;

    // If this packet has no road snapshot at all, do not erase the live road.
    return { ...table, results: [...prev.results] };
  });
}

export default function HomeScreen(){
  const {width,height}=useWindowDimensions();
  const desktop=width>=1000;
  const tablet=width>=700&&width<1000;
  const orbSize=desktop?Math.max(68,Math.min(90,width*0.045)):tablet?60:Math.max(48,Math.min(56,width*0.13));
  const orbIconSize=Math.round(orbSize*0.44);
  const panelBaseWidth=desktop?560:Math.min(560,Math.max(330,width-28));
  // The mobile panel is almost screen-wide, so it must start near the screen
  // edge instead of inheriting the desktop 74px clearance for the floating orb.
  const panelRight=desktop?74:10;
  const [accessGranted,setAccessGranted]=useState(false);
  const [connectionOpen,setConnectionOpen]=useState(false);
  const [helpOpen,setHelpOpen]=useState(false);
  const [analysisTable,setAnalysisTable]=useState<TableData|null>(null);
  const [radarDetailId,setRadarDetailId]=useState<string|null>(null);
  const [mtOpen,setMtOpen]=useState(false);
  const [floatingOpen,setFloatingOpen]=useState(false);
  const [roomDropdownOpen,setRoomDropdownOpen]=useState(false);
  const roomDropdownOpenRef=useRef(false);
  // Freeze the room menu while it is open so live table updates cannot reset its scroll position.
  const [roomMenuTables,setRoomMenuTables]=useState<TableData[]>([]);
  const [assistScale,setAssistScale]=useState(1);
  const [assistPage,setAssistPage]=useState(0);
  const [assistTableId,setAssistTableId]=useState("BAG01");
  const [connected,setConnected]=useState(false);
  const [token,setToken]=useState("");
  const [mtUrl,setMtUrl]=useState("");
  const [wsUrl]=useState("wss://a1.ofalive99.net/game/ws");
  const [socket,setSocket]=useState<WebSocket|null>(null);
  const reconnectingRef=useRef(false);
  const reconnectCooldownUntilRef=useRef(0);
  const awaitingFreshSnapshotRef=useRef(false);
  const reconnectTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const roomDropdownScrollRef=useRef<ScrollView|null>(null);
  const roomDropdownOffsetRef=useRef(0);
  const [tables,setTables]=useState<TableData[]>(initialTables);
  // WebSocket packets are processed immediately into this ref. React painting is
  // committed at most once per animation frame, so the socket frequency is NOT
  // reduced while drag gestures no longer fight dozens of synchronous renders.
  const liveTablesRef=useRef<TableData[]>(initialTables);
  const tablesFrameRef=useRef<number|null>(null);
  const updateLiveTables=(updater:(current:TableData[])=>TableData[])=>{
    const current=liveTablesRef.current;
    const next=updater(current);
    if(next===current)return;
    liveTablesRef.current=next;
    if(tablesFrameRef.current==null){
      tablesFrameRef.current=requestAnimationFrame(()=>{
        tablesFrameRef.current=null;
        setTables(liveTablesRef.current);
      });
    }
  };
  const [events,setEvents]=useState<string[]>([]);
  const [toast,setToast]=useState("");
  const [bankroll,setBankroll]=useState(100000);
  const [initialBankroll,setInitialBankroll]=useState(100000);
  const [baseBet,setBaseBet]=useState(1000);
  const [strategy,setStrategy]=useState<StrategyName>("平注");
  const [strategyLevel,setStrategyLevel]=useState(0);
  const [labSequence,setLabSequence]=useState<number[]>([1,2,3,4]);
  const [pendingBet,setPendingBet]=useState<PendingBet>(null);
  const [records,setRecords]=useState<BetRecord[]>([]);
  const [radarOpen,setRadarOpen]=useState(true);
  const [peakBankroll,setPeakBankroll]=useState(100000);
  const orbPosition=useRef(new Animated.ValueXY()).current;
  const panelPosition=useRef(new Animated.ValueXY()).current;
  const resizeStartScale=useRef(1);
  const panelSizeRef=useRef({width:panelBaseWidth,height:245});
  const orbDraggingRef=useRef(false);
  const panelDraggingRef=useRef(false);
  const appendEvent=(x:string)=>setEvents(e=>[`[${new Date().toLocaleTimeString()}] ${x}`,...e].slice(0,40));
  const notify=(x:string)=>{setToast(x);setTimeout(()=>setToast(""),1800)};
  const nextAmount=Math.max(0,Math.round(strategyAmount(strategy,baseBet,strategyLevel,labSequence)));
  const assistTable=tables.find(t=>(t.apiId??`BAG${t.id}`)===assistTableId)??tables[0];
  const latest=assistTable?.results.at(-1);
  const decision=roadDecision(assistTable?.results??[]);
  const recommendation=decision.side;
  const confidence=confidenceLevel(decision.scoreBanker,decision.scorePlayer);
  const confidencePct=confidencePercent(decision.scoreBanker,decision.scorePlayer);
  const confidenceColor=confidenceGlowColor(confidencePct);
  const radarSignals=useMemo(()=>tables.map(table=>{
    const results=table.results??[];
    const ready=roadSides(results).length>=3;
    const tableDecision=roadDecision(results);
    const level=confidenceLevel(tableDecision.scoreBanker,tableDecision.scorePlayer);
    const confidencePct=confidencePercent(tableDecision.scoreBanker,tableDecision.scorePlayer);
    return {table,id:table.apiId??`BAG${table.id}`,ready,decision:tableDecision,level,confidencePct,gap:Math.abs(tableDecision.scoreBanker-tableDecision.scorePlayer)};
  }),[tables]);
  const bestRadar=radarSignals.filter(item=>item.ready).reduce<(typeof radarSignals)[number]|null>((best,item)=>!best||item.gap>best.gap?item:best,null);
  const radarDetailTable=radarDetailId?tables.find(table=>(table.apiId??`BAG${table.id}`)===radarDetailId)??null:null;
  const radarDetailDecision=roadDecision(radarDetailTable?.results??[]);
  const radarDetailConfidence=confidenceLevel(radarDetailDecision.scoreBanker,radarDetailDecision.scorePlayer);
  const radarDetailConfidencePct=confidencePercent(radarDetailDecision.scoreBanker,radarDetailDecision.scorePlayer);

  useEffect(()=>()=>socket?.close(),[socket]);
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
    const scale=desktop?assistScale:1;
    const visualWidth=Math.min(width-16,Math.max(1,panelSizeRef.current.width*scale));
    const visualHeight=Math.min(height-16,Math.max(1,panelSizeRef.current.height*scale));
    // Match the panel's real absolute layout. Clamping this base to zero made a
    // mobile panel that starts off-screen snap back to the left after dragging.
    const baseLeft=width-panelRight-visualWidth;
    const baseTop=Math.max(0,height-22-visualHeight);
    const minX=8-baseLeft;
    const maxX=width-8-visualWidth-baseLeft;
    const minY=8-baseTop;
    const maxY=height-8-visualHeight-baseTop;
    panelPosition.stopAnimation((v:any)=>panelPosition.setValue({
      x:Math.max(Math.min(minX,maxX),Math.min(Math.max(minX,maxX),Number(v?.x)||0)),
      y:Math.max(Math.min(minY,maxY),Math.min(Math.max(minY,maxY),Number(v?.y)||0)),
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
      clampPanelPosition();
      panelDraggingRef.current=false;
    },
    onPanResponderTerminate:()=>{if(panelDraggingRef.current){panelPosition.flattenOffset();clampPanelPosition();panelDraggingRef.current=false}},
    onPanResponderTerminationRequest:()=>false,
    onShouldBlockNativeResponder:()=>true,
  }),[panelPosition,width,height,desktop,assistScale,panelBaseWidth,panelRight]);
  const pageSwipe=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:()=>false,
    onMoveShouldSetPanResponder:(_,g)=>!roomDropdownOpen&&Math.abs(g.dx)>=6&&Math.abs(g.dx)>Math.abs(g.dy)*1.12,
    onMoveShouldSetPanResponderCapture:()=>false,
    onPanResponderRelease:(_,g)=>{if(roomDropdownOpen)return;if(g.dx<=-24)setAssistPage(p=>Math.min(2,p+1));if(g.dx>=24)setAssistPage(p=>Math.max(0,p-1))},
    onPanResponderTerminationRequest:()=>false
  }),[roomDropdownOpen]);
  const resizeResponder=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:()=>desktop&&!roomDropdownOpenRef.current,
    onStartShouldSetPanResponderCapture:()=>desktop&&!roomDropdownOpenRef.current,
    onMoveShouldSetPanResponder:()=>desktop&&!roomDropdownOpenRef.current,
    onMoveShouldSetPanResponderCapture:()=>desktop&&!roomDropdownOpenRef.current,
    onPanResponderGrant:()=>{if(roomDropdownOpenRef.current)return;resizeStartScale.current=assistScale},
    onPanResponderMove:(_,g)=>{if(!desktop)return;const delta=(g.dx+g.dy)/360;setAssistScale(Math.max(.72,Math.min(1.75,resizeStartScale.current+delta)))},
    onPanResponderTerminationRequest:()=>false,
  }),[desktop,assistScale]);

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
          if(strategy==="馬丁") return outcome==="loss"?Math.min(level+1,10):0;
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

  const startConnection=(autoReason?:string)=>{
    const authToken=extractMtUrlToken(token||mtUrl);
    if(!authToken){notify("請貼登入後含 token 的 MT 網址");reconnectingRef.current=false;return}
    if(autoReason)appendEvent(`偵測牌路不同步：${autoReason}，自動重新連線確認`);
    awaitingFreshSnapshotRef.current=true;
    socket?.close();
    const ws=new WebSocket(wsUrl);setSocket(ws);let authenticated=false,subscribed=false;
    const requestTables=(quiet=false)=>{if(authenticated&&ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify({method:"GET",action:{name:"/api/v1/gametype/*/game/*/room/*/tables",data:{gametype_id:3,game_id:1,room_id:1}}}));if(!quiet)appendEvent("已請求 15 桌歷史牌局")}};
    const requestSvg=()=>authenticated&&ws.readyState===WebSocket.OPEN&&ws.send(JSON.stringify({method:"POST",action:{name:"/api/v1/gametype/*/game/*/room/*/tablesvg"}}));
    const subscribe=()=>{if(authenticated&&ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify({method:"GET",action:{name:"/api/v1/gametype/*/game/*/room/*/mulitple_join",data:{table_id:baccaratTableIds.join(",")}}}));subscribed=true;appendEvent("已訂閱 15 桌即時事件")}};
    ws.onopen=()=>{appendEvent("WebSocket 已連線，正在驗證");ws.send(JSON.stringify({method:"POST",action:{name:"/api/v1/authenticate",path:"/api/v1/authenticate"},body:{type:3,token:authToken}}))};
    ws.onmessage=e=>{try{const p=JSON.parse(e.data),name=eventName(p);if(name==="/api/v1/authenticate"){if(Number(p?.err)===0){authenticated=true;setConnected(true);appendEvent("authenticate 成功");requestTables();setTimeout(requestSvg,200);setTimeout(subscribe,400)}else{setConnected(false);appendEvent("authenticate 失敗")}return}const src=eventTables(p);if(src&&name.includes("/tables")){
      const filtered=src.filter(x=>baccaratTableIds.includes(getApiTableId(x)));
      updateLiveTables(c=>{
        // The first complete snapshot after every connection/reconnection is the
        // confirmation source, exactly like a manual reconnect.
        if(awaitingFreshSnapshotRef.current){
          awaitingFreshSnapshotRef.current=false;
          reconnectingRef.current=false;
          reconnectCooldownUntilRef.current=Date.now()+8000;
          appendEvent("重新連線牌路確認完成");
          return applyTablesSameShoe(c,filtered);
        }

        let mismatchTable="";
        for(const source of filtered){
          const id=getApiTableId(source);
          const local=c.find(t=>(t.apiId??`BAG${t.id}`)===id);
          if(!local)continue;
          const trend=source?.trend??{};
          const sourceShoe=String(trend?.current_shoe??source?.shoe??"");
          const serverResults=parseBeadPlate(trend?.bead_plate2??trend?.bead_plate??source?.bead_plate2);
          if(!serverResults.length)continue;
          // A real shoe change is normal and must not be treated as corruption.
          if(sourceShoe&&sourceShoe!=="—"&&String(local.shoe)!=="—"&&sourceShoe!==String(local.shoe))continue;
          if(serverResults.length!==local.results.length||serverResults.some((r,i)=>r!==local.results[i])){mismatchTable=id;break}
        }

        if(mismatchTable&&!reconnectingRef.current&&Date.now()>=reconnectCooldownUntilRef.current){
          reconnectingRef.current=true;
          reconnectTimerRef.current=setTimeout(()=>startConnection(`${mismatchTable} 本靴牌路與 MT snapshot 不一致`),250);
          // Keep the currently displayed road until the fresh connection confirms it.
          return c;
        }
        return applyTablesSameShoe(c,filtered);
      });
      if(!subscribed)subscribe();return}if(name.includes("/show_win")){const actual=winnerToRoadResult((p?.body??p?.msg??p?.data??{})?.winner);if(actual)settlePending(actual,p);updateLiveTables(c=>applyLiveShowWin(c,p));setTimeout(requestSvg,350);return}if(name.includes("/table/")&&(name.endsWith("/wait")||name.endsWith("/end"))){updateLiveTables(c=>applyLiveWait(c,p,baccaratTableIds));return}}catch{}};
    ws.onerror=()=>{setConnected(false);appendEvent("WebSocket 發生錯誤")};ws.onclose=()=>{setConnected(false);appendEvent("WebSocket 已中斷")};
  };
  const stopConnection=()=>{if(reconnectTimerRef.current){clearTimeout(reconnectTimerRef.current);reconnectTimerRef.current=null}reconnectingRef.current=false;awaitingFreshSnapshotRef.current=false;socket?.close();setSocket(null);setConnected(false);appendEvent("已手動中斷")};
  const syncAssist=()=>{if(socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify({method:"POST",action:{name:"/api/v1/gametype/*/game/*/room/*/tablesvg"}}));appendEvent("懸浮輔助已要求同步")}else notify("尚未連線")};
  const openMtPlatform=(table?:TableData)=>{if(table)setAssistTableId(table.apiId??`BAG${table.id}`);if(!(mtUrl.trim()||token.trim())){notify("請先在連線設定填入 MT 平台網址");setConnectionOpen(true);return}setMtOpen(true)};
  const action=(kind:string,table:TableData)=>{if(kind==="MT平台")openMtPlatform(table);else if(kind==="分析")setAnalysisTable(table);else notify(`已關注百家樂 ${table.id}`)};
  const actionRef=useRef(action);
  actionRef.current=action;
  const stableTableAction=useMemo(()=>(kind:string,table:TableData)=>actionRef.current(kind,table),[]);
  const placeManualBet=(side:BetSide)=>{if(pendingBet){notify("上一筆仍在等待開獎");return}if(nextAmount<=0){notify("請先設定基本單注");return}setPendingBet({tableId:assistTableId,side,amount:nextAmount});appendEvent(`統計下注 ${assistTableId}：${side} ${nextAmount}`);setAssistPage(2)};
  const resetStats=()=>{setBankroll(initialBankroll);setPeakBankroll(initialBankroll);setStrategyLevel(0);setLabSequence([1,2,3,4]);setPendingBet(null);setRecords([])};
  const wins=records.filter(r=>r.pnl>0).length,losses=records.filter(r=>r.pnl<0).length,decisions=wins+losses;
  let streak=0;if(records.length){const win=records[0].pnl>0,loss=records[0].pnl<0;if(win||loss){for(const r of records){if((win&&r.pnl>0)||(loss&&r.pnl<0))streak++;else break}}}
  const maxDrawdown=Math.max(0,peakBankroll-bankroll);

  const MultiTableRadar=({insideMt=false}:{insideMt?:boolean})=>{
    const bestText=bestRadar?`${bestRadar.id} ${bestRadar.decision.side} · ${bestRadar.confidencePct}%`:"等待資料";
    const displaySignals=bestRadar?[bestRadar,...radarSignals.filter(item=>item.id!==bestRadar.id)]:radarSignals;
    return <View style={[s.radarBar,insideMt&&s.radarBarMt,!radarOpen&&s.radarBarClosed]}>
      <View style={s.radarLead}><Text style={s.radarKicker}>MT MATRIX · MULTI-TABLE RADAR</Text><Text style={s.radarTitle}>多桌雷達</Text><Text numberOfLines={1} style={s.radarBest}>{bestRadar?`首選 ${bestText}`:"等待有效牌路"}</Text></View>
      {radarOpen?<ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.radarScroll} contentContainerStyle={s.radarRail}>{displaySignals.map(item=>{
        const selected=item.id===assistTableId;
        const best=item.id===bestRadar?.id;
        const sideColor=item.ready?resultColor(item.decision.side):"#777";
        const glowColor=item.ready?confidenceGlowColor(item.confidencePct):"#666";
        return <Pressable key={item.id} onPress={()=>{setAssistTableId(item.id);setRadarDetailId(item.id)}} style={[s.radarCard,selected&&s.radarCardSelected,best&&s.radarCardBest]}>
          <View style={s.radarCardTop}><Text style={[s.radarRoom,best&&s.radarRoomBest]}>{item.id}</Text>{best?<Text style={s.radarPick}>👑 首選</Text>:null}</View>
          <View style={s.radarSignalRow}>
            <Text style={[s.radarSide,best&&s.radarSideBest,{color:sideColor}]}>{item.ready?item.decision.side:"等待"}</Text>
            {item.ready?<View style={s.radarConfidence}><View style={[s.bulbGlow,{backgroundColor:glowColor,shadowColor:glowColor}]}/><MaterialIcons name="lightbulb" size={11} color={glowColor}/><Text style={[s.radarLevel,best&&s.radarLevelBest,{color:glowColor}]}>{item.confidencePct}%</Text></View>:<Text style={[s.radarLevel,{color:"#777"}]}>—</Text>}
          </View>
        </Pressable>;
      })}</ScrollView>:<Text numberOfLines={1} style={s.radarCollapsedText}>{bestText}</Text>}
      <Pressable onPress={()=>setRadarOpen(open=>!open)} style={s.radarToggle}><MaterialIcons name={radarOpen?"keyboard-arrow-up":"keyboard-arrow-down"} size={19} color="#D7A93F"/></Pressable>
    </View>;
  };

  const FloatingAssistant=({insideMt=false}:{insideMt?:boolean})=>{
    const glow=latest?resultColor(latest):"#5A6B78";
    const page1=<View {...pageSwipe.panHandlers} style={s.obsPage}>
      <View style={s.obsTopline}><View><Text style={s.obsKicker}>DECISION / 即時決策</Text><Text style={s.obsRoom}>{assistTableId} · ROUND {assistTable?.round??"—"}</Text></View><View style={[s.obsLivePill,{borderColor:connected?"#75613A":"#343434"}]}><View style={[s.obsLiveDot,{backgroundColor:connected?"#BFA66A":"#666"}]}/><Text style={s.obsLiveText}>{connected?"LIVE":"OFFLINE"}</Text></View></View>
      <View style={{flexDirection:"row",gap:8,marginBottom:8}}>
        <View style={[s.obsHero,{flex:1.62,marginBottom:0}]}><Text style={s.obsHeroLabel}>NEXT SIGNAL</Text><Text style={[s.obsHeroSide,{color:resultColor(recommendation)}]}>{recommendation}</Text><Text style={s.obsHeroAmount}>{nextAmount.toLocaleString()}</Text><View style={{alignSelf:"flex-start",marginTop:6,paddingHorizontal:7,paddingVertical:3,borderRadius:10,borderWidth:1,borderColor:confidenceColor,backgroundColor:"rgba(0,0,0,.28)",flexDirection:"row",alignItems:"center",gap:4}}><View style={[s.bulbGlow,{backgroundColor:confidenceColor,shadowColor:confidenceColor}]}/><MaterialIcons name="lightbulb" size={11} color={confidenceColor}/><Text style={{color:confidenceColor,fontSize:9,fontWeight:"900"}}>信心度 {confidencePct}%</Text></View><Text style={s.obsHeroMeta}>{strategy} · 信號依目前牌路動態更新</Text></View>
        <View style={[s.obsSignalStrip,{flex:1,minHeight:0,marginBottom:0,flexDirection:"column",alignItems:"stretch",paddingHorizontal:10,paddingVertical:4}]}><View style={[s.obsSignalItem,{justifyContent:"center",paddingVertical:4}]}><Text style={s.obsMiniLabel}>最近</Text><View style={[s.obsLatestInline,{marginTop:2}]}><View style={[s.obsTinyDot,{backgroundColor:glow}]}/><Text style={[s.obsSignalValue,{fontSize:11.5,lineHeight:14,marginTop:0}]}>{latest??"—"}</Text></View></View><View style={[s.obsVLine,{width:"100%",height:1,marginHorizontal:0,marginVertical:0}]}/><View style={[s.obsSignalItem,{justifyContent:"center",paddingVertical:4}]}><Text style={s.obsMiniLabel}>牌型</Text><Text numberOfLines={2} style={[s.obsSignalValue,{fontSize:11.5,lineHeight:14,marginTop:2}]}>{detectPattern(assistTable?.results??[])}</Text></View><View style={[s.obsVLine,{width:"100%",height:1,marginHorizontal:0,marginVertical:0}]}/><View style={[s.obsSignalItem,{justifyContent:"center",paddingVertical:4}]}><Text style={s.obsMiniLabel}>狀態</Text><Text style={[s.obsSignalValue,{fontSize:11.5,lineHeight:14,marginTop:2}]}>{connected?"同步中":"待連線"}</Text></View></View>
      </View>
      <View style={s.obsReason}><View style={s.obsReasonHead}><MaterialIcons name="auto-awesome" size={14} color="#BFA66A"/><Text style={s.obsReasonTitle}>WHY / 分析依據</Text></View><Text style={s.obsReasonText}>{analysisText(assistTable)}</Text></View>
    </View>;
    const page2=<View {...pageSwipe.panHandlers} style={s.obsPage}>
      <View style={s.obsTopline}><View><Text style={s.obsKicker}>CAPITAL / 資金控制</Text><Text style={s.obsRoom}>STRATEGY CONSOLE</Text></View><Text style={s.obsStep}>STEP {strategyLevel+1}</Text></View>
      <View style={s.obsCapitalHero}><View><Text style={s.obsMiniLabel}>NEXT SIZE / 下一注</Text><Text style={s.obsCapitalAmount}>{nextAmount.toLocaleString()}</Text></View><View style={s.obsCapitalRight}><Text style={s.obsMiniLabel}>CURRENT</Text><Text style={s.obsStrategyName}>{strategy}</Text></View></View>
      <View style={s.obsInputRow}><View style={s.obsInputBlock}><Text style={s.obsMiniLabel}>BANKROLL / 本金</Text><TextInput keyboardType="numeric" value={String(bankroll)} onChangeText={v=>{const n=Math.max(0,Number(v)||0);setBankroll(n)}} style={s.obsInput}/></View><View style={s.obsInputBlock}><Text style={s.obsMiniLabel}>BASE UNIT / 單注</Text><TextInput keyboardType="numeric" value={String(baseBet)} onChangeText={v=>setBaseBet(Math.max(0,Number(v)||0))} style={s.obsInput}/></View></View>
      <Text style={s.obsSectionLabel}>STRATEGY SELECT</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.obsStrategyRail}>{strategies.map(x=><Pressable key={x} style={[s.obsStrategyTab,strategy===x&&s.obsStrategyTabActive]} onPress={()=>{setStrategy(x);setStrategyLevel(0)}}><Text style={[s.obsStrategyTabText,strategy===x&&s.obsStrategyTabTextActive]}>{x}</Text></Pressable>)}</ScrollView>
      <View style={s.obsProgressLine}><View style={s.obsProgressMark}/><Text style={s.obsProgressText}>{strategy} · 第 {strategyLevel+1} 階 · 下一注 {nextAmount.toLocaleString()}</Text></View>
    </View>;
    const page3=<View {...pageSwipe.panHandlers} style={s.obsPage}>
      <View style={s.obsTopline}><View><Text style={s.obsKicker}>SESSION / 戰績流</Text><Text style={s.obsRoom}>PERFORMANCE LEDGER</Text></View><Pressable onPress={resetStats}><Text style={s.obsReset}>RESET</Text></Pressable></View>
      <View style={s.obsPnlHero}><Text style={s.obsMiniLabel}>SESSION P/L</Text><Text style={[s.obsPnl,{color:bankroll-initialBankroll>=0?"#D6C18C":"#FF7079"}]}>{(bankroll-initialBankroll>=0?"+":"")+(bankroll-initialBankroll).toLocaleString()}</Text><Text style={s.obsPnlMeta}>{wins} WIN · {losses} LOSS · {decisions?((wins/decisions)*100).toFixed(1):"0.0"}%</Text></View>
      <View style={s.obsActionRail}><Pressable style={[s.obsSideBtn,s.obsBanker]} onPress={()=>placeManualBet("莊")}><Text style={s.obsSideEn}>BANKER</Text><Text style={s.obsSideZh}>莊</Text></Pressable><Pressable style={[s.obsSideBtn,s.obsPlayer]} onPress={()=>placeManualBet("閒")}><Text style={s.obsSideEn}>PLAYER</Text><Text style={s.obsSideZh}>閒</Text></Pressable><Pressable style={[s.obsSideBtn,s.obsTie]} onPress={()=>placeManualBet("和")}><Text style={s.obsSideEn}>TIE</Text><Text style={s.obsSideZh}>和</Text></Pressable></View>
      <View style={s.obsLedgerHead}><Text style={s.obsSectionLabel}>{pendingBet?`等待開獎 · ${pendingBet.side} ${pendingBet.amount.toLocaleString()}`:`RECENT FLOW · STREAK ${streak}`}</Text><Text style={s.obsDrawdown}>DD -{maxDrawdown.toLocaleString()}</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.obsLedger}>{records.length?records.slice(0,8).map((r,i)=><View key={i} style={s.obsLedgerItem}><Text style={s.obsLedgerIndex}>{String(records.length-i).padStart(2,"0")}</Text><Text style={s.obsLedgerSide}>{r.side}</Text><Text style={[s.obsLedgerPnl,{color:r.pnl>=0?"#D6C18C":"#FF7079"}]}>{r.pnl>=0?"+":""}{r.pnl.toLocaleString()}</Text></View>):<View style={s.obsEmpty}><Text style={s.obsEmptyText}>尚無 Session 紀錄</Text></View>}</ScrollView>
    </View>;
    if(!floatingOpen)return null;
    return <Animated.View onLayout={(e:any)=>{const l=e.nativeEvent?.layout;if(l?.width&&l?.height){panelSizeRef.current={width:l.width,height:l.height}}}} style={[s.floatPanel,{width:panelBaseWidth,maxWidth:width-20,right:panelRight},insideMt?s.floatPanelMt:null,desktop&&Platform.OS==="web"?({zoom:assistScale} as any):null,{transform:panelPosition.getTranslateTransform()}]}>
      <View style={s.floatHeader} {...panelDrag.panHandlers}><View style={s.floatHeadLeft}><Text style={s.floatTitle}>MTmatrlx · OBSIDIAN</Text><Text style={s.floatStatus}>{connected?"等待下一把開獎":"等待連線"}</Text></View><View style={s.row}><Pressable onPress={syncAssist} style={s.iconTextBtn}><MaterialIcons name="sync" size={15} color="#fff"/><Text style={s.iconText}>同步</Text></Pressable><Pressable onPress={()=>setFloatingOpen(false)} style={s.iconBtn}><MaterialIcons name="close" size={18} color="#fff"/></Pressable></View></View>
      <View style={s.selectorWrap}>
        <Pressable style={s.selector} onPress={()=>{
          if(roomDropdownOpen){ roomDropdownOpenRef.current=false; setRoomDropdownOpen(false); }
          else { setRoomMenuTables(tables.map(t=>({...t,results:[...t.results]}))); roomDropdownOpenRef.current=true; setRoomDropdownOpen(true); }
        }}>
          <View style={s.selectorLeft}><Text style={s.selectorValue}>{assistTableId}</Text><MaterialIcons name={roomDropdownOpen?"keyboard-arrow-up":"keyboard-arrow-down"} size={18} color="#DCE8F0"/></View>
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
            {roomMenuTables.map(t=>{const id=t.apiId??`BAG${t.id}`;return <Pressable key={id} style={[s.roomDropdownItem,id===assistTableId&&s.roomDropdownItemActive]} onPress={()=>{setAssistTableId(id);roomDropdownOpenRef.current=false;setRoomDropdownOpen(false)}}><View style={s.roomDropdownLeft}><Text style={s.roomDropdownText}>{id}</Text><Text numberOfLines={1} style={s.roomDropdownDealer}>荷官 {t.name||"—"}</Text></View><Text style={s.roomDropdownMeta}>第 {t.round??0} 局</Text></Pressable>})}
          </ScrollView>
        </View>:null}
      </View>
      {assistPage===0?page1:assistPage===1?page2:page3}<View style={s.pageDots}>{[0,1,2].map(i=><Pressable key={i} onPress={()=>setAssistPage(i)}><View style={[s.pageDot,assistPage===i&&s.pageDotActive]}/></Pressable>)}</View>
      {desktop?<View style={s.resizeHandle} {...resizeResponder.panHandlers}><MaterialIcons name="south-east" size={18} color="#CBE7FA"/></View>:null}
    </Animated.View>;
  };

  if(!accessGranted)return <AccessScreen onAuthenticated={()=>setAccessGranted(true)}/>;

  return <ScreenContainer edges={["top","left","right","bottom"]} containerClassName="bg-[#070605]" className="bg-[#070605]">
    <View style={s.screen}>
      <View style={s.topbar}><View style={s.brandRow}><View style={s.brandIcon}><Image source={{uri:"/login-logo-v2.png"}} style={{width:31,height:31,resizeMode:"contain"}}/></View><View><Text style={s.kicker}>MTmatrlx · LIVE</Text><Text style={s.title}>即時多桌牌路</Text></View></View><View style={s.row}><Pressable style={s.lineBtn} onPress={openLineContact}><View style={s.lineLogo}><Text style={s.lineLogoText}>LINE</Text></View><Text style={s.lineText}>LINE</Text></Pressable><Pressable style={s.headerBtn} onPress={()=>setHelpOpen(true)}><MaterialIcons name="help-outline" size={16} color="#D7B76A"/><Text style={s.headerBtnText}>說明</Text></Pressable><Pressable style={s.headerBtn} onPress={()=>setConnectionOpen(true)}><MaterialIcons name="settings" size={16} color="#D7B76A"/><Text style={s.headerBtnText}>連線</Text></Pressable></View></View>
      <ScrollView contentContainerStyle={s.content}><View style={[s.overview,!desktop&&s.overviewMobile]}><View style={!desktop?s.overviewTextMobile:undefined}><Text style={s.overKicker}>BLACK GOLD TERMINAL</Text><Text style={s.overTitle}>即時桌況控制中心</Text><Text style={s.overSub}>Private multi-table intelligence · live road matrix</Text></View><View style={[s.overStats,!desktop&&s.overStatsMobile]}><View style={[s.overStat,!desktop&&s.overStatMobile]}><Text style={s.smallLabel}>連線狀態</Text><Text style={[s.overValue,{color:connected?"#4BD693":"#FF6973"}]}>{connected?"已連線":"未連線"}</Text></View><View style={[s.overStat,!desktop&&s.overStatMobile]}><Text style={s.smallLabel}>可用桌型</Text><Text style={s.overValue}>15 桌</Text></View></View></View><View style={s.listHead}><Text style={s.listTitle}>LIVE TABLE MATRIX</Text><Text style={s.listHint}>REAL-TIME · ROAD ENGINE · DEALER SYNC</Text></View><View style={[s.cardsGrid,desktop&&s.cardsGridDesktop,desktop&&s.cardsGridDesktopCentered]}>{tables.map(t=><View key={t.apiId} style={desktop?s.cardWrapDesktop:s.cardWrap}><MemoTableCard table={t} desktop={desktop} onAction={stableTableAction}/></View>)}</View></ScrollView>
      {MultiTableRadar({})}{FloatingAssistant({})}<FloatingOrb position={orbPosition} responder={orbResponder} size={orbSize} iconSize={orbIconSize} connected={connected}/>
      {toast?<View style={s.toast}><Text style={s.toastText}>{toast}</Text></View>:null}

      <Modal visible={connectionOpen} transparent animationType="fade" onRequestClose={()=>setConnectionOpen(false)}><View style={s.modalShade}><View style={s.connectionModal}><View style={s.modalHead}><Text style={s.modalTitle}>CONNECTION CENTER</Text><Pressable onPress={()=>setConnectionOpen(false)}><MaterialIcons name="close" size={22} color="#DDE8F0"/></Pressable></View><Text style={s.modalNote}>MTmatrlx 私人連線中心。牌路資料與 MT 平台維持獨立工作階段，關閉面板不影響既有連線。</Text><Text style={s.fieldLabel}>主頁牌路 WebSocket（固定）</Text><TextInput value={wsUrl} editable={false} secureTextEntry style={s.modalInput}/><Text style={s.fieldLabel}>主頁牌路來源 / Token</Text><TextInput value={token} onChangeText={setToken} secureTextEntry placeholder="貼入含 token 的登入網址" placeholderTextColor="#63798B" style={s.modalInput}/><Text style={s.fieldLabel}>MT 平台獨立網址</Text><TextInput value={mtUrl} onChangeText={setMtUrl} placeholder="https://.../?token=..." placeholderTextColor="#63798B" style={s.modalInput}/><View style={s.mappingRow}><Text style={s.mapChip}>winner 1：閒</Text><Text style={s.mapChip}>winner 2：莊</Text><Text style={s.mapChip}>winner 3：和</Text></View><View style={s.modalActions}><Pressable style={[s.actionBtn,s.actionBtnOutline]} onPress={syncAssist}><Text style={s.btnText}>驗證主頁牌路</Text></Pressable><Pressable style={[s.actionBtn,s.actionBtnGold]} onPress={()=>startConnection()}><Text style={[s.btnText,{color:"#0A0805"}]}>開始連線</Text></Pressable><Pressable style={[s.actionBtn,s.actionBtnDanger]} onPress={stopConnection}><Text style={s.btnText}>中斷</Text></Pressable><Pressable style={[s.actionBtn,s.actionBtnDark]} onPress={()=>setConnectionOpen(false)}><Text style={s.btnText}>完成</Text></Pressable></View><Text style={s.syncText}>同步階段：主頁已同步 {tables.filter(t=>t.live).length} 桌</Text><Text style={s.fieldLabel}>即時事件</Text><ScrollView style={s.logBox}>{events.map((x,i)=><Text key={i} style={s.logText}>{x}</Text>)}</ScrollView></View></View></Modal>
      <Modal visible={helpOpen} transparent animationType="fade" onRequestClose={()=>setHelpOpen(false)}><View style={s.modalShade}><View style={s.smallModal}><View style={s.modalHead}><Text style={s.modalTitle}>說明</Text><Pressable onPress={()=>setHelpOpen(false)}><MaterialIcons name="close" size={22} color="#fff"/></Pressable></View><Text style={s.helpText}>主頁顯示 15 桌即時牌路。MTmatrlx · OBSIDIAN 可左右滑動 3 頁：即時輔助、資金策略、輸贏統計。</Text></View></View></Modal>
      <Modal visible={!!analysisTable} transparent animationType="fade" onRequestClose={()=>setAnalysisTable(null)}><View style={s.modalShade}><View style={s.smallModal}><View style={s.modalHead}><Text style={s.modalTitle}>百家樂 {analysisTable?.id} 分析</Text><Pressable onPress={()=>setAnalysisTable(null)}><MaterialIcons name="close" size={22} color="#fff"/></Pressable></View><Text style={s.helpText}>{analysisText(analysisTable??undefined)}</Text></View></View></Modal>
      <Modal visible={mtOpen} animationType="slide" onRequestClose={()=>setMtOpen(false)}><View style={s.mtScreen}><View style={s.mtTop}><View style={s.brandRow}><View style={s.brandIcon}><Image source={{uri:"/login-logo-v2.png"}} style={{width:31,height:31,resizeMode:"contain"}}/></View><View><Text style={s.kicker}>MTmatrlx · LIVE</Text><Text style={s.title}>即時多桌牌路</Text></View></View><View style={s.row}><Pressable style={s.lineBtn} onPress={openLineContact}><View style={s.lineLogo}><Text style={s.lineLogoText}>LINE</Text></View><Text style={s.lineText}>LINE</Text></Pressable><Pressable style={s.headerBtn} onPress={()=>setHelpOpen(true)}><MaterialIcons name="help-outline" size={16} color="#D7B76A"/><Text style={s.headerBtnText}>說明</Text></Pressable><Pressable style={s.headerBtn} onPress={()=>setMtOpen(false)}><MaterialIcons name="arrow-back" size={16} color="#fff"/><Text style={s.headerBtnText}>回牌路</Text></Pressable></View></View><View style={s.iframeWrap}>{Platform.OS==="web"?createElement("iframe" as any,{src:mtUrl.trim()||token.trim(),style:{width:"100%",height:"100%",border:"0",background:"#000"},allow:"clipboard-read; clipboard-write; fullscreen"}):<View style={s.nativeMtFallback}><Text style={s.helpText}>目前原生模式請使用外部瀏覽器開啟 MT 平台。</Text></View>}</View>{MultiTableRadar({insideMt:true})}{FloatingAssistant({insideMt:true})}<FloatingOrb position={orbPosition} responder={orbResponder} size={orbSize} iconSize={orbIconSize} connected={connected} insideMt/></View></Modal>
      <Modal visible={!!radarDetailTable} transparent animationType="fade" onRequestClose={()=>setRadarDetailId(null)}><View style={[s.modalShade,s.radarDetailShade]}><View style={s.radarDetailModal}><View style={s.modalHead}><View><Text style={s.radarDetailKicker}>LIVE ROAD SNAPSHOT</Text><Text style={s.radarDetailTitle}>{radarDetailId} · 第 {radarDetailTable?.round??0} 局</Text></View><Pressable onPress={()=>setRadarDetailId(null)} style={s.radarDetailClose}><MaterialIcons name="close" size={22} color="#fff"/></Pressable></View>{radarDetailTable?<><View style={s.radarDetailStats}><View style={s.radarDetailStat}><Text style={s.radarDetailLabel}>目前推薦</Text><Text style={[s.radarDetailValue,{color:resultColor(radarDetailDecision.side)}]}>{radarDetailDecision.side}</Text></View><View style={s.radarDetailStat}><Text style={s.radarDetailLabel}>信心度</Text><View style={s.radarDetailConfidenceRow}><View style={[s.bulbGlow,{backgroundColor:confidenceGlowColor(radarDetailConfidencePct),shadowColor:confidenceGlowColor(radarDetailConfidencePct)}]}/><MaterialIcons name="lightbulb" size={14} color={confidenceGlowColor(radarDetailConfidencePct)}/><Text style={[s.radarDetailValue,{color:confidenceGlowColor(radarDetailConfidencePct),marginTop:0}]}>{radarDetailConfidencePct}%</Text></View></View><View style={s.radarDetailStat}><Text style={s.radarDetailLabel}>目前牌型</Text><Text numberOfLines={1} style={s.radarDetailValue}>{detectPattern(radarDetailTable.results)}</Text></View><View style={s.radarDetailStat}><Text style={s.radarDetailLabel}>莊／閒／和</Text><Text style={s.radarDetailValue}>{radarDetailTable.banker}／{radarDetailTable.player}／{radarDetailTable.tie}</Text></View></View><View style={[s.radarRoadWrap,{height:desktop?190:164}]}><RoadGrid table={radarDetailTable} desktop={desktop} transparent/></View><Text style={s.radarDetailNote}>{analysisText(radarDetailTable)}</Text></>:null}</View></View></Modal>
    </View>
  </ScreenContainer>;
}

const s=StyleSheet.create({
  vipMark:{width:24,height:24,borderRadius:7,borderWidth:1,borderColor:"#5B4727",backgroundColor:"#12100B",alignItems:"center",justifyContent:"center"},
  playerBadge:{height:22,paddingHorizontal:7,borderRadius:11,borderWidth:1,borderColor:"#4A3A22",backgroundColor:"#0D0B08",flexDirection:"row",alignItems:"center",gap:4},
  tableStatusRail:{minHeight:34,paddingHorizontal:7,paddingVertical:5,backgroundColor:"#0C0A07",borderTopWidth:1,borderTopColor:"#2E2518",borderBottomWidth:1,borderBottomColor:"#3A2F1D",flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  tableStats:{flexDirection:"row",alignItems:"center",gap:10},
  miniBtnPrimary:{backgroundColor:"#D7B76A",borderColor:"#E6CC8A"},miniBtnPrimaryText:{color:"#090704",fontSize:7,fontWeight:"900"},
  dealerPlate:{position:"absolute",left:4,right:4,bottom:4,backgroundColor:"rgba(7,5,3,.82)",borderWidth:1,borderColor:"rgba(215,183,106,.32)",padding:5},
  assistSectionHead:{paddingHorizontal:2,paddingTop:3,paddingBottom:7},assistEyebrow:{color:"#B99A56",fontSize:7,letterSpacing:1.4,fontWeight:"900"},assistSectionTitle:{color:"#F4E9CF",fontSize:12,fontWeight:"900",marginTop:2},
  decisionBoxGold:{borderColor:"#8A6B32",backgroundColor:"#171209"},fieldBoxGold:{borderWidth:1,borderColor:"#6E552B",backgroundColor:"#161108"},
  aiHead:{flexDirection:"row",alignItems:"center",gap:6},
  screen:{flex:1,backgroundColor:"#070605"},row:{flexDirection:"row",alignItems:"center",gap:6},brandRow:{flexDirection:"row",alignItems:"center",gap:8},
  bulbGlow:{width:5,height:5,borderRadius:3,shadowOpacity:1,shadowRadius:9,elevation:8,marginRight:-10},radarConfidence:{marginLeft:"auto",flexDirection:"row",alignItems:"center",gap:3},radarDetailConfidenceRow:{flexDirection:"row",alignItems:"center",gap:5,marginTop:2},
  radarBar:{position:"absolute",top:70,left:10,right:10,zIndex:80,height:96,backgroundColor:"rgba(7,10,12,.96)",borderWidth:1,borderColor:"#7A5D25",borderRadius:9,flexDirection:"row",alignItems:"center",paddingHorizontal:7,shadowColor:"#000",shadowOpacity:.48,shadowRadius:12,elevation:16},radarBarMt:{zIndex:9998},radarBarClosed:{height:34,right:"auto" as any,width:260},radarLead:{width:128,paddingHorizontal:5},radarKicker:{color:"#C79C42",fontSize:6.5,letterSpacing:1,fontWeight:"900"},radarTitle:{color:"#FFF2C2",fontSize:11,fontWeight:"900",marginTop:1},radarBest:{color:"#E7B94D",fontSize:8,fontWeight:"900",marginTop:2},radarScroll:{flex:1,height:84},radarRail:{height:84,flexDirection:"column",flexWrap:"wrap",columnGap:5,rowGap:4,alignContent:"flex-start",paddingRight:5},radarCard:{width:92,height:39,borderRadius:7,borderWidth:1,borderColor:"#30343A",backgroundColor:"rgba(12,16,19,.96)",paddingHorizontal:6,paddingVertical:4,justifyContent:"space-between"},radarCardSelected:{borderColor:"#70808C"},radarCardBest:{width:108,backgroundColor:"#1A1408",borderWidth:2,borderColor:"#D7A93F",shadowColor:"#E7B94D",shadowOpacity:.8,shadowRadius:10,elevation:10},radarCardTop:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},radarRoom:{color:"#F3E9D3",fontSize:8,fontWeight:"900"},radarRoomBest:{color:"#FFF1BF"},radarPick:{color:"#120E06",fontSize:5.5,fontWeight:"900",backgroundColor:"#E7B94D",paddingHorizontal:3,paddingVertical:1,borderRadius:4},radarSignalRow:{flexDirection:"row",alignItems:"center",gap:3},radarDot:{width:5,height:5,borderRadius:3},radarSide:{fontSize:10.5,fontWeight:"900"},radarSideBest:{fontSize:13},radarLevel:{fontSize:7,fontWeight:"900",marginLeft:"auto",flexShrink:0,whiteSpace:"nowrap" as any},radarLevelBest:{backgroundColor:"rgba(0,0,0,.42)",paddingHorizontal:3,paddingVertical:1,borderRadius:4},radarGap:{color:"#FFE39A",fontSize:6.5,fontWeight:"900",flexShrink:0},radarCollapsedText:{flex:1,color:"#E2D6BD",fontSize:9,fontWeight:"900"},radarToggle:{width:28,height:28,borderRadius:7,backgroundColor:"#17130D",alignItems:"center",justifyContent:"center",marginLeft:5},
  radarDetailShade:{backgroundColor:"transparent"},radarDetailModal:{width:"96%",maxWidth:920,backgroundColor:"rgba(10,9,7,.24)",borderWidth:1,borderColor:"#D1A34D",borderRadius:14,padding:12,shadowColor:"#000",shadowOpacity:.16,shadowRadius:9,elevation:30},radarDetailKicker:{color:"#E0C276",fontSize:7,letterSpacing:1.4,fontWeight:"900",textShadowColor:"#000",textShadowRadius:3},radarDetailTitle:{color:"#FFF4D9",fontSize:17,fontWeight:"900",marginTop:2,textShadowColor:"#000",textShadowRadius:4},radarDetailClose:{width:32,height:32,borderRadius:7,backgroundColor:"rgba(15,14,12,.38)",alignItems:"center",justifyContent:"center"},radarDetailStats:{flexDirection:"row",gap:6,marginBottom:8,flexWrap:"wrap"},radarDetailStat:{flexGrow:1,minWidth:90,backgroundColor:"rgba(10,9,7,.24)",borderWidth:1,borderColor:"rgba(209,163,77,.78)",borderRadius:7,paddingHorizontal:8,paddingVertical:6},radarDetailLabel:{color:"#E1D1AD",fontSize:7,fontWeight:"800",textShadowColor:"#000",textShadowRadius:3},radarDetailValue:{color:"#FFF7E6",fontSize:11,fontWeight:"900",marginTop:2,textShadowColor:"#000",textShadowRadius:4},radarRoadWrap:{height:260,backgroundColor:"transparent",borderRadius:8,overflow:"hidden",borderWidth:1,borderColor:"#C89B45"},radarDetailNote:{color:"#FFF2D7",fontSize:9,lineHeight:14,marginTop:8,textShadowColor:"#000",textShadowRadius:4},
  topbar:{minHeight:64,paddingHorizontal:16,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:"#4B3B21",backgroundColor:"#090704"},brandIcon:{width:38,height:38,borderRadius:11,borderWidth:1,borderColor:"#B9974F",backgroundColor:"#151008",alignItems:"center",justifyContent:"center",shadowColor:"#D7B76A",shadowOpacity:.18,shadowRadius:8},kicker:{color:"#9E8C68",fontSize:9.5,letterSpacing:1.1},title:{color:"#F6EEDC",fontSize:18,fontWeight:"800"},
  lineBtn:{height:34,paddingHorizontal:9,borderRadius:7,backgroundColor:"#1F6B43",flexDirection:"row",alignItems:"center",gap:5},lineLogo:{width:23,height:23,borderRadius:11.5,backgroundColor:"#fff",alignItems:"center",justifyContent:"center"},lineLogoText:{fontSize:6.5,fontWeight:"900",color:"#1F6B43"},lineText:{color:"#fff",fontSize:11,fontWeight:"900"},headerBtn:{height:34,paddingHorizontal:9,borderRadius:7,backgroundColor:"#16130E",flexDirection:"row",alignItems:"center",gap:5,borderWidth:1,borderColor:"#4B3E28"},headerBtnText:{color:"#fff",fontSize:11,fontWeight:"800"},
  content:{padding:10,paddingBottom:90},overview:{borderWidth:1,borderColor:"#493B25",borderRadius:8,padding:12,flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:10,backgroundColor:"#0D0B08",overflow:"hidden"},overviewMobile:{flexDirection:"column",alignItems:"stretch",gap:10},overviewTextMobile:{width:"100%"},overKicker:{color:"#B39A63",fontSize:8.5,letterSpacing:1.4},overTitle:{color:"#fff",fontSize:20,fontWeight:"900",marginTop:2},overSub:{color:"#8E8068",fontSize:10.5,marginTop:3},overStats:{flexDirection:"row",gap:8},overStatsMobile:{width:"100%",gap:6},overStat:{minWidth:112,borderWidth:1,borderColor:"#4C3D26",borderRadius:6,padding:9},overStatMobile:{flex:1,minWidth:0,padding:8},overValue:{color:"#fff",fontSize:15,fontWeight:"900",marginTop:4},listHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:7},listTitle:{color:"#F6EEDC",fontSize:17,fontWeight:"900"},listHint:{color:"#897A60",fontSize:9.5},
  cardsGrid:{width:"100%",alignSelf:"center"},cardsGridDesktop:{flexDirection:"row",flexWrap:"wrap",gap:10},cardsGridDesktopCentered:{maxWidth:1280},cardWrap:{width:"100%"},cardWrapDesktop:{width:"calc(50% - 5px)" as any,maxWidth:635},tableCard:{backgroundColor:"#090806",borderWidth:1,borderColor:"#4F3E23",borderRadius:12,overflow:"hidden",marginBottom:12,shadowColor:"#000",shadowOpacity:.34,shadowRadius:12,elevation:5},tableCardDesktop:{},tableHead:{height:44,paddingHorizontal:8,backgroundColor:"#090704",flexDirection:"row",justifyContent:"space-between",alignItems:"center"},game:{color:"#A98D52",fontSize:8.5,fontWeight:"900",letterSpacing:1.1},tableId:{color:"#F3E7CA",fontSize:15,fontWeight:"900",letterSpacing:.4,marginTop:1},headText:{color:"#fff",fontSize:9.5,fontWeight:"800"},statText:{fontSize:9.5,fontWeight:"900"},countWrap:{height:20,minWidth:28,borderWidth:1,borderColor:"#8D2030",borderRadius:4,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:2,paddingHorizontal:3},countdown:{color:"#FF5362",fontSize:10,fontWeight:"900"},miniBtn:{height:24,paddingHorizontal:7,borderRadius:7,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:3,borderWidth:1,borderColor:"#4A3A22",backgroundColor:"#12100B"},miniBtnText:{color:"#fff",fontSize:8.5,fontWeight:"900"},
  tableBody:{flexDirection:"row",height:176,backgroundColor:"#fff",overflow:"hidden"},tableBodyDesktop:{height:190},tableBodyMobile:{height:164},dealer:{width:112,backgroundColor:"#11100D",padding:4,justifyContent:"flex-end"},dealerDesktop:{width:"21.88%"},dealerMobile:{width:"21.88%",minWidth:76},photo:{position:"absolute",top:3,left:3,right:3,height:112,backgroundColor:"#181510",alignItems:"center",justifyContent:"center",overflow:"hidden"},photoDesktop:{height:"82%"},photoMobile:{height:"80%"},photoImage:{width:"100%",height:"100%",resizeMode:"cover"},crown:{fontSize:30,color:"#D5B568"},dealerName:{color:"#F3E7CB",fontSize:13,fontWeight:"900",lineHeight:14},meta:{color:"#8D7E62",fontSize:10,fontWeight:"700",lineHeight:11,marginTop:1},
  roadArea:{flex:1,flexDirection:"row",backgroundColor:"#fff",minWidth:0,overflow:"hidden"},roadAreaDesktop:{},roadGlass:{backgroundColor:"rgba(255,255,255,.68)"},beadPane:{width:"32%",height:"100%",flexShrink:0,borderRightWidth:1,borderColor:"#C9D2D9",overflow:"hidden",backgroundColor:"#FFFFFF"},beadPaneDesktop:{width:"32%"},beadPaneGlass:{backgroundColor:"rgba(255,255,255,.08)",borderColor:"rgba(190,203,214,.82)"},beadGrid:{width:"100%",height:"100%",flexDirection:"row",flexWrap:"wrap",alignContent:"stretch",backgroundColor:"#FFFFFF"},beadGridGlass:{backgroundColor:"transparent"},beadCell:{width:"16.6666667%",height:"16.6666667%",flexGrow:0,flexShrink:0,borderRightWidth:1,borderBottomWidth:1,borderColor:"#D9DEE3",alignItems:"center",justifyContent:"center",backgroundColor:"#FFFFFF"},beadCellDesktop:{},beadCellGlass:{backgroundColor:"rgba(255,255,255,.04)",borderColor:"rgba(190,203,214,.78)"},roadCellGlass:{backgroundColor:"rgba(255,255,255,.04)",borderColor:"rgba(190,203,214,.74)"},beadDot:{width:"72%",aspectRatio:1,borderRadius:999,borderWidth:1,alignItems:"center",justifyContent:"center",shadowColor:"#000",shadowOpacity:.10,shadowRadius:1,elevation:1},beadDotDesktop:{width:"70%"},beadDotGlass:{width:"82%",borderWidth:1.5,shadowColor:"rgba(0,0,0,.75)",shadowOpacity:.55,shadowRadius:2,elevation:5},beadDotText:{color:"#FFFFFF",fontSize:9,fontWeight:"900",lineHeight:10,textAlign:"center",textShadowColor:"rgba(0,0,0,.80)",textShadowRadius:2},beadDotTextDesktop:{fontSize:10,lineHeight:11},roadStack:{flex:1,minWidth:0,height:"100%"},bigGrid:{width:"100%",height:"62%",flexDirection:"row",flexWrap:"wrap",alignContent:"stretch"},bigGridDesktop:{},bigCell:{width:"6.6666667%",height:"16.6666667%",borderRightWidth:1,borderBottomWidth:1,borderColor:"#DDE4E9",alignItems:"center",justifyContent:"center",overflow:"hidden"},bigCellDesktop:{},bigMark:{width:"72%",maxWidth:"78%",aspectRatio:1,borderRadius:999,borderWidth:1.35,backgroundColor:"transparent",alignItems:"center",justifyContent:"center"},bigMarkDesktop:{width:"70%",borderWidth:1.2},bigMarkGlass:{borderWidth:2.35,backgroundColor:"rgba(255,255,255,.62)",shadowColor:"rgba(0,0,0,.45)",shadowOpacity:.45,shadowRadius:2,elevation:4},tieNumber:{color:"#20B66B",fontSize:8,fontWeight:"900",lineHeight:8,textShadowColor:"#FFFFFF",textShadowRadius:2},tieNumberDesktop:{fontSize:8,lineHeight:8},lowerArea:{width:"100%",height:"38%",flexDirection:"row",borderTopWidth:1,borderTopColor:"#CCD6DE"},lowerAreaDesktop:{},lowerPane:{width:"33.333333%",height:"100%",flexDirection:"row",flexWrap:"wrap",alignContent:"stretch",borderRightWidth:1,borderRightColor:"#DDE4E9"},lowerCell:{width:"10%",height:"16.6666667%",alignItems:"center",justifyContent:"center",borderRightWidth:.5,borderBottomWidth:.5,borderColor:"#E4E8EB",overflow:"hidden"},lowerCellDesktop:{},lowerHollow:{width:"55%",aspectRatio:1,borderRadius:999,borderWidth:1.4,backgroundColor:"transparent"},lowerSolid:{width:"52%",aspectRatio:1,borderRadius:999},lowerHollowGlass:{borderWidth:2,backgroundColor:"rgba(255,255,255,.55)",shadowColor:"rgba(0,0,0,.45)",shadowOpacity:.35,shadowRadius:1,elevation:3},lowerSolidGlass:{borderWidth:1,borderColor:"rgba(255,255,255,.92)",shadowColor:"rgba(0,0,0,.50)",shadowOpacity:.42,shadowRadius:1,elevation:3},lowerSlash:{width:"58%",height:2,borderRadius:2,transform:[{rotate:"-45deg"}]},lowerSlashGlass:{height:3,shadowColor:"rgba(0,0,0,.55)",shadowOpacity:.48,shadowRadius:1,elevation:3},
  orb:{position:"absolute",right:16,bottom:24,zIndex:90,width:50,height:50,borderRadius:25,backgroundColor:"#15110A",borderWidth:2,borderColor:"#D6B768",alignItems:"center",justifyContent:"center",shadowColor:"#000",shadowOpacity:.45,shadowRadius:9,elevation:12,touchAction:"none" as any,userSelect:"none" as any,cursor:"grab" as any},orbMt:{bottom:34},orbStatus:{position:"absolute",right:4,top:4,width:8,height:8,borderRadius:4,borderWidth:1,borderColor:"#fff"},
  floatPanel:{position:"absolute",right:74,bottom:22,zIndex:100,backgroundColor:"rgba(9,10,11,.78)",borderWidth:1,borderColor:"#292A2C",borderRadius:10,overflow:"hidden",shadowColor:"#000",shadowOpacity:.55,shadowRadius:18,elevation:18},floatPanelMt:{zIndex:9999},floatHeader:{height:44,paddingHorizontal:10,flexDirection:"row",alignItems:"center",justifyContent:"space-between",backgroundColor:"rgba(13,14,15,.76)",borderBottomWidth:1,borderBottomColor:"#242527",touchAction:"none" as any,userSelect:"none" as any,cursor:"grab" as any},floatHeadLeft:{flexDirection:"row",alignItems:"center",gap:8},floatTitle:{color:"#F0F5F9",fontWeight:"900",fontSize:13.5},floatStatus:{color:"#56D48C",fontSize:9.5},iconBtn:{width:27,height:27,borderRadius:5,backgroundColor:"#151617",alignItems:"center",justifyContent:"center"},iconTextBtn:{height:27,paddingHorizontal:7,borderRadius:5,backgroundColor:"#151617",flexDirection:"row",gap:3,alignItems:"center"},iconText:{color:"#fff",fontSize:9.5,fontWeight:"800"},selectorWrap:{marginHorizontal:6,marginTop:6,position:"relative",zIndex:130},selector:{height:38,paddingHorizontal:9,borderWidth:1,borderColor:"rgba(185,161,102,.28)",borderRadius:5,backgroundColor:"rgba(13,14,15,.68)",flexDirection:"row",alignItems:"center",justifyContent:"space-between"},selectorLeft:{flexDirection:"row",alignItems:"center",gap:4},selectorValue:{color:"#F0F5F8",fontSize:12.5,fontWeight:"900"},selectorMeta:{color:"#B6C5D0",fontSize:10.5},roomDropdown:{position:"absolute",left:0,right:0,top:42,maxHeight:205,backgroundColor:"rgba(13,14,15,.94)",borderWidth:1,borderColor:"#2E3032",borderRadius:6,zIndex:160,elevation:30,overflow:"hidden",shadowColor:"#000",shadowOpacity:.45,shadowRadius:10},roomDropdownScroll:{height:205,maxHeight:205,overflow:"scroll"},roomDropdownContent:{paddingBottom:2},roomDropdownItem:{minHeight:42,paddingHorizontal:10,paddingVertical:5,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:"#242527"},roomDropdownItemActive:{backgroundColor:"#191A1B"},roomDropdownLeft:{flex:1,minWidth:0,paddingRight:8},roomDropdownText:{color:"#F3E9D1",fontSize:11.5,fontWeight:"900"},roomDropdownDealer:{color:"#A59574",fontSize:9.5,marginTop:2},roomDropdownMeta:{color:"#9C8962",fontSize:9.5,fontWeight:"800"},assistPage:{padding:6,minHeight:150},decisionRow:{flexDirection:"row",gap:5},decisionBox:{flex:1,minHeight:68,backgroundColor:"#12100C",borderWidth:1,borderColor:"#4A3B24",borderRadius:5,padding:7},smallLabel:{color:"#9A8864",fontSize:7.5},latestLine:{flexDirection:"row",alignItems:"center",gap:7,marginTop:7},glowDot:{width:17,height:17,borderRadius:8.5,shadowOpacity:1,shadowRadius:10,elevation:8},latestText:{fontSize:16,fontWeight:"900"},detectText:{color:"#F6EEDC",fontSize:11,fontWeight:"900",marginTop:7},recommendText:{fontSize:14,fontWeight:"900",marginTop:7},microText:{color:"#958567",fontSize:7,marginTop:2},aiBox:{marginTop:5,backgroundColor:"#0D0B08",borderRadius:5,padding:7},aiTitle:{color:"#D8BB75",fontSize:11,fontWeight:"900"},aiText:{color:"#C7B99D",fontSize:11,lineHeight:17,marginTop:5},moneyGrid:{flexDirection:"row",gap:5},fieldBox:{flex:1,backgroundColor:"#12100C",borderRadius:5,padding:7,minHeight:58},moneyInput:{color:"#fff",fontSize:13,fontWeight:"900",padding:0,marginTop:5},nextAmount:{color:"#D9B45D",fontSize:15,fontWeight:"900",marginTop:6},strategyScroll:{marginTop:6,maxHeight:30},strategyRow:{gap:4},strategyChip:{height:25,paddingHorizontal:8,borderRadius:4,backgroundColor:"#19150E",justifyContent:"center"},strategyChipActive:{backgroundColor:"#B89446"},strategyChipText:{color:"#A39372",fontSize:7.5,fontWeight:"800"},progressBox:{marginTop:6,backgroundColor:"#0D0B08",borderRadius:5,padding:7},progressText:{color:"#E9DFC9",fontSize:9,fontWeight:"800",marginTop:4},betButtons:{flexDirection:"row",gap:5},betBtn:{flex:1,height:38,borderRadius:5,alignItems:"center",justifyContent:"center"},betBtnText:{color:"#fff",fontSize:12,fontWeight:"900"},statsGrid:{marginTop:6,backgroundColor:"#12100C",borderRadius:5,padding:7,flexDirection:"row",justifyContent:"space-between"},statsValue:{color:"#fff",fontSize:11,fontWeight:"900",marginTop:3},recordBar:{marginTop:5,flexDirection:"row",justifyContent:"space-between",alignItems:"center"},resetText:{color:"#D7B76A",fontSize:8,fontWeight:"900"},historyRow:{gap:4,marginTop:5},historyChip:{backgroundColor:"#17130D",borderRadius:4,paddingHorizontal:6,paddingVertical:4},pageDots:{height:19,flexDirection:"row",gap:7,alignItems:"center",justifyContent:"center"},pageDot:{width:6,height:6,borderRadius:3,backgroundColor:"#66573A"},pageDotActive:{backgroundColor:"#fff"},resizeHandle:{position:"absolute",right:0,bottom:0,width:34,height:34,borderTopLeftRadius:9,backgroundColor:"#221B10",borderLeftWidth:1,borderTopWidth:1,borderColor:"#6D562D",alignItems:"center",justifyContent:"center",zIndex:190,cursor:"nwse-resize" as any},resizeText:{color:"#D9BE7A",fontSize:7,fontWeight:"900"},
  obsPage:{paddingHorizontal:12,paddingTop:10,paddingBottom:8,minHeight:205,backgroundColor:"#0A0B0C"},obsTopline:{flexDirection:"row",alignItems:"flex-start",justifyContent:"space-between",marginBottom:10},obsKicker:{color:"#8D7D5B",fontSize:7,letterSpacing:1.6,fontWeight:"900"},obsRoom:{color:"#E9E7E1",fontSize:12,fontWeight:"900",marginTop:3,letterSpacing:.2},obsLivePill:{height:24,paddingHorizontal:8,borderRadius:12,borderWidth:1,flexDirection:"row",alignItems:"center",gap:5,backgroundColor:"#0E0F10"},obsLiveDot:{width:5,height:5,borderRadius:3},obsLiveText:{color:"#BEB9AE",fontSize:7,fontWeight:"900",letterSpacing:1},obsHero:{backgroundColor:"#101112",borderLeftWidth:2,borderLeftColor:"#B9A166",paddingHorizontal:12,paddingVertical:11,marginBottom:8},obsHeroLabel:{color:"#77736B",fontSize:7,letterSpacing:1.5,fontWeight:"900"},obsHeroSide:{fontSize:29,fontWeight:"900",lineHeight:33,marginTop:2},obsHeroAmount:{color:"#F2F0EA",fontSize:15,fontWeight:"900",marginTop:1},obsHeroMeta:{color:"#77736B",fontSize:7.5,marginTop:4},obsSignalStrip:{minHeight:45,backgroundColor:"#0D0E0F",flexDirection:"row",alignItems:"center",paddingHorizontal:10,marginBottom:8},obsSignalItem:{flex:1},obsMiniLabel:{color:"#8A8780",fontSize:8.5,letterSpacing:.8,fontWeight:"800"},obsSignalValue:{color:"#E2DFD8",fontSize:10.5,fontWeight:"900",marginTop:3},obsLatestInline:{flexDirection:"row",alignItems:"center",gap:5,marginTop:3},obsTinyDot:{width:6,height:6,borderRadius:3},obsVLine:{width:1,height:22,backgroundColor:"#252628",marginHorizontal:8},obsReason:{paddingTop:7,borderTopWidth:1,borderTopColor:"#222325"},obsReasonHead:{flexDirection:"row",alignItems:"center",gap:5},obsReasonTitle:{color:"#BDA66D",fontSize:9.5,fontWeight:"900",letterSpacing:.8},obsReasonText:{color:"#C2BFB8",fontSize:11.5,lineHeight:17,marginTop:5},obsStep:{color:"#A99568",fontSize:9.5,fontWeight:"900",letterSpacing:1},obsCapitalHero:{minHeight:72,backgroundColor:"rgba(16,17,18,.66)",borderBottomWidth:1,borderBottomColor:"#28292B",padding:12,flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:8},obsCapitalAmount:{color:"#D6C18C",fontSize:26,fontWeight:"900",marginTop:2},obsCapitalRight:{alignItems:"flex-end"},obsStrategyName:{color:"#E8E5DE",fontSize:12.5,fontWeight:"900",marginTop:4},obsInputRow:{flexDirection:"row",gap:7,marginBottom:9},obsInputBlock:{flex:1,backgroundColor:"rgba(13,14,15,.62)",padding:9,borderBottomWidth:1,borderBottomColor:"#343536"},obsInput:{color:"#F1EFEA",fontSize:15.5,fontWeight:"900",padding:0,marginTop:5},obsSectionLabel:{color:"#8B877F",fontSize:8.5,letterSpacing:1.2,fontWeight:"900"},obsStrategyRail:{gap:5,paddingVertical:7},obsStrategyTab:{height:28,paddingHorizontal:10,justifyContent:"center",backgroundColor:"rgba(17,18,20,.58)",borderBottomWidth:1,borderBottomColor:"#292A2C"},obsStrategyTabActive:{borderBottomColor:"#B9A166",backgroundColor:"rgba(34,32,25,.72)"},obsStrategyTabText:{color:"#918D85",fontSize:9.5,fontWeight:"800"},obsStrategyTabTextActive:{color:"#D6C18C"},obsProgressLine:{minHeight:30,flexDirection:"row",alignItems:"center",gap:7,borderTopWidth:1,borderTopColor:"#222325",marginTop:2},obsProgressMark:{width:14,height:1,backgroundColor:"#B9A166"},obsProgressText:{color:"#BDB9B1",fontSize:10,fontWeight:"800"},obsReset:{color:"#AA9565",fontSize:9.5,fontWeight:"900",letterSpacing:1},obsPnlHero:{alignItems:"center",justifyContent:"center",backgroundColor:"rgba(16,17,18,.66)",paddingVertical:11,marginBottom:8},obsPnl:{fontSize:27,fontWeight:"900",marginTop:1},obsPnlMeta:{color:"#908C84",fontSize:9.5,fontWeight:"800",marginTop:2},obsActionRail:{flexDirection:"row",gap:5,marginBottom:9},obsSideBtn:{flex:1,minHeight:43,justifyContent:"center",paddingHorizontal:9,borderLeftWidth:2,backgroundColor:"rgba(17,18,20,.62)"},obsBanker:{borderLeftColor:"#B8323B"},obsPlayer:{borderLeftColor:"#1764C0"},obsTie:{borderLeftColor:"#238A4B"},obsSideEn:{color:"#8E8A82",fontSize:8,fontWeight:"900",letterSpacing:.8},obsSideZh:{color:"#E8E5DE",fontSize:14.5,fontWeight:"900",marginTop:1},obsLedgerHead:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:5},obsDrawdown:{color:"#8D8981",fontSize:8.5,fontWeight:"800"},obsLedger:{gap:4},obsLedgerItem:{width:72,minHeight:47,backgroundColor:"rgba(13,14,15,.62)",padding:7,borderTopWidth:1,borderTopColor:"#292A2C"},obsLedgerIndex:{color:"#77797C",fontSize:8,fontWeight:"900"},obsLedgerSide:{color:"#D8D5CE",fontSize:10.5,fontWeight:"900",marginTop:2},obsLedgerPnl:{fontSize:9.5,fontWeight:"900",marginTop:2},obsEmpty:{height:47,justifyContent:"center",paddingHorizontal:10},obsEmptyText:{color:"#77797C",fontSize:9.5},
  loginScreen:{flex:1,backgroundColor:"#050403",alignItems:"center",justifyContent:"center",padding:18,overflow:"hidden"},loginVideo:{...StyleSheet.absoluteFillObject},loginShade:{...StyleSheet.absoluteFillObject,backgroundColor:"rgba(3,2,1,.48)"},loginPanel:{width:"100%",maxWidth:480,backgroundColor:"rgba(8,7,5,.80)",borderWidth:1,borderColor:"rgba(215,183,106,.52)",borderRadius:24,padding:28,shadowColor:"#000",shadowOpacity:.68,shadowRadius:38,elevation:24},loginBrand:{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:16,marginBottom:24},loginBrandCopy:{alignItems:"flex-start"},loginIcon:{width:62,height:62,borderRadius:17,borderWidth:1,borderColor:"rgba(215,183,106,.72)",alignItems:"center",justifyContent:"center",backgroundColor:"#050403",overflow:"hidden"},loginLogoImage:{width:"100%",height:"100%",resizeMode:"cover"},loginTitle:{color:"#F7EFD9",fontSize:35,fontWeight:"900",letterSpacing:.2},loginChineseName:{color:"#D7B76A",fontSize:15,fontWeight:"800",letterSpacing:1.2,marginTop:3},loginDivider:{height:1,backgroundColor:"rgba(215,183,106,.20)",marginBottom:18},loginAccessHead:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:17},loginAccessTitle:{color:"#F7EFD9",fontSize:18,fontWeight:"900"},loginLock:{width:34,height:34,borderRadius:10,borderWidth:1,borderColor:"rgba(215,183,106,.22)",backgroundColor:"rgba(17,13,8,.62)",alignItems:"center",justifyContent:"center"},loginHint:{color:"#B19E7A",fontSize:11,marginTop:4},loginLabel:{color:"#C0AD84",fontSize:11,fontWeight:"800",letterSpacing:.8,marginBottom:7},loginFieldWrap:{height:50,backgroundColor:"rgba(8,6,3,.66)",borderRadius:10,borderWidth:1,borderColor:"rgba(132,104,54,.58)",flexDirection:"row",alignItems:"center",paddingLeft:14,marginBottom:15},loginFieldInput:{flex:1,height:"100%",color:"#F7EFDE",paddingHorizontal:11,fontSize:15},passwordWrap:{height:50,backgroundColor:"rgba(8,6,3,.66)",borderRadius:10,borderWidth:1,borderColor:"rgba(132,104,54,.58)",flexDirection:"row",alignItems:"center",paddingLeft:14,marginBottom:18},passwordInput:{flex:1,height:"100%",color:"#F7EFDE",paddingHorizontal:11,fontSize:15},eyeBtn:{width:46,height:"100%",alignItems:"center",justifyContent:"center"},loginBtn:{height:52,backgroundColor:"#D7B76A",borderRadius:10,alignItems:"center",justifyContent:"space-between",paddingHorizontal:16,flexDirection:"row",shadowColor:"#D7B76A",shadowOpacity:.16,shadowRadius:12,elevation:6},loginBtnPending:{opacity:.68},loginBtnIcon:{width:28,height:28,borderRadius:8,backgroundColor:"rgba(10,8,5,.18)",alignItems:"center",justifyContent:"center"},loginBtnText:{color:"#0A0805",fontSize:14.5,fontWeight:"900",letterSpacing:.4},error:{color:"#FF9AA0",fontSize:11.5,textAlign:"center",marginTop:10},loginBottomRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginTop:17},loginSecureNote:{flexDirection:"row",alignItems:"center",gap:5},loginFoot:{color:"#A89572",fontSize:10},loginHelpBtn:{flexDirection:"row",alignItems:"center",gap:5,paddingHorizontal:9,paddingVertical:6,borderRadius:8,backgroundColor:"rgba(215,183,106,.12)"},loginHelp:{color:"#D7B76A",fontSize:10.5,fontWeight:"900"},
  modalShade:{flex:1,backgroundColor:"rgba(0,0,0,.72)",alignItems:"center",justifyContent:"center",padding:16},connectionModal:{width:"100%",maxWidth:760,maxHeight:"92%",backgroundColor:"#0D0E0F",borderWidth:1,borderColor:"#6A5128",borderRadius:18,padding:20,shadowColor:"#000",shadowOpacity:.55,shadowRadius:24},smallModal:{width:"100%",maxWidth:520,backgroundColor:"#0D0E0F",borderWidth:1,borderColor:"#6A5128",borderRadius:18,padding:20},modalHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:12},modalTitle:{color:"#fff",fontSize:17,fontWeight:"800"},modalNote:{color:"#B7A98C",fontSize:10,lineHeight:15,backgroundColor:"#0A0805",padding:10,borderRadius:5,marginBottom:12},fieldLabel:{color:"#C9B995",fontSize:10,marginBottom:5,marginTop:8},modalInput:{height:42,borderWidth:1,borderColor:"#544325",borderRadius:5,backgroundColor:"#080603",color:"#fff",paddingHorizontal:10},mappingRow:{flexDirection:"row",gap:6,marginTop:10,flexWrap:"wrap"},mapChip:{color:"#CBBB9A",fontSize:9,backgroundColor:"#151617",paddingHorizontal:8,paddingVertical:6,borderRadius:4},modalActions:{flexDirection:"row",gap:7,marginTop:12,flexWrap:"wrap"},actionBtn:{height:40,paddingHorizontal:13,borderRadius:9,justifyContent:"center",borderWidth:1,borderColor:"#5B4727"},actionBtnGold:{backgroundColor:"#D7B76A",borderColor:"#E5C981"},actionBtnOutline:{backgroundColor:"#100D08",borderColor:"#8A6B32"},actionBtnDanger:{backgroundColor:"#24100F",borderColor:"#71352F"},actionBtnDark:{backgroundColor:"#17120B",borderColor:"#554224"},btnText:{color:"#fff",fontWeight:"900",fontSize:10},syncText:{color:"#A69778",fontSize:9,marginTop:11},logBox:{height:130,backgroundColor:"#080603",borderRadius:5,padding:9,marginTop:4},logText:{color:"#B9AB8E",fontSize:8,lineHeight:13},helpText:{color:"#D5C7A9",fontSize:11,lineHeight:18},
  mtScreen:{flex:1,backgroundColor:"#060504"},mtTop:{minHeight:58,paddingHorizontal:14,flexDirection:"row",alignItems:"center",justifyContent:"space-between",backgroundColor:"#0C0A07",borderBottomWidth:1,borderBottomColor:"#4A3A22"},mtTitle:{color:"#fff",fontSize:15,fontWeight:"900"},iframeWrap:{flex:1},nativeMtFallback:{flex:1,alignItems:"center",justifyContent:"center"},toast:{position:"absolute",bottom:78,left:20,right:20,backgroundColor:"#0D0A06",borderWidth:1,borderColor:"#806431",borderRadius:12,padding:11,zIndex:200,shadowColor:"#000",shadowOpacity:.45,shadowRadius:12},toastText:{color:"#fff",textAlign:"center",fontSize:10}
});
