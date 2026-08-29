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
} from "@/lib/road-render";

type Result = RoadResult;
type TableData = {
  id: string; apiId?: string; game: string; name: string; players: string;
  countdown?: number; countdownUpdatedAt?: number; roomId?: string; tableBadge?: string;
  shoe: string; round: number; banker: number; player: number; tie: number;
  results: Result[]; trend: string; live?: boolean; dealerPhoto?: string;
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
const lineContactUrl = "https://line.me/ti/p/HM2rMNvenj";
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

function getPatternInfo(results: Result[]): PatternInfo {
  const seq = results.filter((r): r is "莊" | "閒" => r === "莊" || r === "閒");
  const n = seq.length;
  if (n < 3) return { type: "資料累積中", label: "資料累積中" };
  const last = seq[n - 1];
  let run = 1;
  for (let i = n - 2; i >= 0 && seq[i] === last; i--) run++;
  if (run >= 4) return { type: "連龍", label: `${last}連龍${run}顆`, side: last, run };
  const last3 = seq.slice(-3);
  if (last3[0] === last3[2] && last3[0] !== last3[1]) return { type: "單跳", label: "單跳趨勢", side: last };
  if (n >= 5) {
    const x = seq.slice(-5);
    if (x[0] === x[1] && x[2] === x[3] && x[0] !== x[2] && x[4] === x[0]) return { type: "雙跳", label: "雙跳趨勢", side: x[4] };
  }
  if (last3[0] === "莊" && last3[1] === "閒" && last3[2] === "閒") return { type: "一房兩廳", label: "一莊兩閒｜一房兩廳", side: "閒" };
  if (last3[0] === "閒" && last3[1] === "莊" && last3[2] === "莊") return { type: "一房兩廳", label: "兩莊一閒｜一房兩廳", side: "莊" };
  if (run >= 2) return { type: "一般連", label: `${last}連${run}顆`, side: last, run };
  return { type: "混合", label: "混合走勢", side: last };
}

function detectPattern(results: Result[]) { return getPatternInfo(results).label; }

function recommendSide(results: Result[]): "莊" | "閒" {
  const seq = results.filter((r): r is "莊" | "閒" => r === "莊" || r === "閒");
  if (!seq.length) return "莊";
  const info = getPatternInfo(results), last = seq[seq.length - 1];
  if (info.type === "連龍" || info.type === "一般連" || info.type === "雙跳") return last;
  if (info.type === "單跳") return last === "莊" ? "閒" : "莊";
  if (info.type === "一房兩廳") return info.side ?? last;
  const tail = seq.slice(-8), b = tail.filter(x => x === "莊").length;
  return b >= tail.length - b ? "莊" : "閒";
}

function analysisText(table?: TableData) {
  if (!table) return "等待牌局資料。";
  const seq = table.results.filter((r): r is "莊" | "閒" => r === "莊" || r === "閒");
  if (seq.length < 3) return "目前資料累積中，第三顆開始判斷牌型。";
  const info = getPatternInfo(table.results), side = recommendSide(table.results);
  if (info.type === "連龍") return `目前${info.label}，已連續開出${info.run}顆${info.side}。目前輔助方向：${side}。`;
  if (info.type === "單跳") return `目前形成單跳趨勢，第三顆已符合交替節奏。目前輔助方向：${side}。`;
  if (info.type === "雙跳") return `目前形成雙跳趨勢，第三段第一顆已出現。目前輔助方向：${side}。`;
  if (info.type === "一房兩廳") return `目前形成${info.label}，第三顆已符合牌型條件。目前輔助方向：${side}。`;
  if (info.type === "一般連") return `目前${info.label}，尚未達到四顆連龍條件。目前輔助方向：${side}。`;
  return `目前尚未形成明確牌型，最近牌路暫時偏向${side}側。`;
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
function RoadGrid({ table, desktop }: { table: TableData; desktop: boolean }) {
  const beads = useMemo(() => buildSlidingBeadGrid(table.results), [table.results]);
  const big = useMemo(() => buildRoadWindow(buildBigRoad(table.results), 15), [table.results]);
  const lower = useMemo(() => [
    buildRoadWindow(buildDerivedRoad(table.results, 1, false), 10),
    buildRoadWindow(buildDerivedRoad(table.results, 2, true), 10),
    buildRoadWindow(buildDerivedRoad(table.results, 3, false), 10),
  ], [table.results]);
  return <View style={[s.roadArea, desktop && s.roadAreaDesktop]}>
    <View style={[s.beadPane, desktop && s.beadPaneDesktop]}><View style={s.beadGrid}>{Array.from({length:36},(_,i)=><View key={i} style={[s.beadCell,desktop&&s.beadCellDesktop]}>{beads[i]?<ResultDot result={beads[i]!} desktop={desktop}/>:null}</View>)}</View></View>
    <View style={s.roadStack}>
      <View style={[s.bigGrid,desktop&&s.bigGridDesktop]}>{Array.from({length:90},(_,i)=>{ const row=Math.floor(i/15),col=i%15,m=big.find(x=>x.row===row&&x.col===col); return <View key={i} style={[s.bigCell,desktop&&s.bigCellDesktop]}>{m?<View style={[s.bigMark,desktop&&s.bigMarkDesktop,{borderColor:m.result==="莊"?ROAD_SPEC.colors.hollowRed:m.result==="閒"?ROAD_SPEC.colors.hollowBlue:ROAD_SPEC.colors.tie}]}>{m.tieCount?<Text style={[s.tieNumber,desktop&&s.tieNumberDesktop]}>{m.tieCount}</Text>:null}</View>:null}</View> })}</View>
      <View style={[s.lowerArea,desktop&&s.lowerAreaDesktop]}>{lower.map((road,ri)=><View key={ri} style={s.lowerPane}>{Array.from({length:60},(_,i)=>{ const row=Math.floor(i/10),col=i%10,m=road.find(x=>x.row===row&&x.col===col); if(!m)return <View key={i} style={[s.lowerCell,desktop&&s.lowerCellDesktop]}/>; const color=derivedColor(ri,m.result); return <View key={i} style={[s.lowerCell,desktop&&s.lowerCellDesktop]}>{ri===0?<View style={[s.lowerHollow,{borderColor:color}]}/>:ri===1?<View style={[s.lowerSolid,{backgroundColor:color}]}/>:<View style={[s.lowerSlash,{backgroundColor:color}]}/>}</View> })}</View>)}</View>
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
      <View style={s.row}><Text style={s.game}>百家樂</Text><Text style={s.tableId}>{table.id}</Text><MaterialIcons name="person" size={12} color="#fff"/><Text style={s.headText}>{table.players}</Text><CountdownBadge count={table.countdown} updatedAt={table.countdownUpdatedAt}/></View>
      <View style={s.row}><Text style={[s.statText,{color:"#F35762"}]}>莊 {table.banker}</Text><Text style={[s.statText,{color:"#4D96F3"}]}>閒 {table.player}</Text><Text style={[s.statText,{color:"#45C98A"}]}>和 {table.tie}</Text>
        <Pressable style={[s.miniBtn,{backgroundColor:"#7043C9"}]} onPress={()=>onAction("分析",table)}><Text style={s.miniBtnText}>分析</Text></Pressable>
        <Pressable style={[s.miniBtn,{backgroundColor:"#208C55"}]} onPress={()=>onAction("關注",table)}><Text style={s.miniBtnText}>關注</Text></Pressable>
        <Pressable style={[s.miniBtn,{backgroundColor:"#1681C7"}]} onPress={()=>onAction("MT平台",table)}><Text style={s.miniBtnText}>MT平台</Text></Pressable>
      </View>
    </View>
    <View style={[s.tableBody,desktop?s.tableBodyDesktop:s.tableBodyMobile]}>
      <View style={[s.dealer,desktop?s.dealerDesktop:s.dealerMobile]}>
        <View style={[s.photo,desktop?s.photoDesktop:s.photoMobile]}>{table.dealerPhoto?<Image source={{uri:table.dealerPhoto}} style={s.photoImage}/>:<Text style={s.crown}>♛</Text>}</View>
        <Text style={s.dealerName}>{table.name||"—"}</Text><Text style={s.meta}>房間 {table.roomId||table.id}</Text><Text style={s.meta}>Shoe {table.shoe} · 第 {table.round} 把</Text>
      </View>
      <RoadGrid table={table} desktop={desktop}/>
    </View>
  </View>;
}

// Keep unchanged table cards out of the high-frequency WebSocket render path.
// The connection still receives every packet; only cards whose TableData reference
// actually changed are reconciled again.
const MemoTableCard = memo(TableCard);

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
  return <ScreenContainer edges={["top","left","right","bottom"]} containerClassName="bg-[#020A12]" className="bg-[#020A12]">
    <View style={s.loginScreen}>{Platform.OS==="web"?createElement("video" as any,{ref:(node:any)=>{webVideoRef.current=node},src:"/poker.mp4",autoPlay:true,muted:true,defaultMuted:true,playsInline:true,preload:"auto",controls:false,disablePictureInPicture:true,style:{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",pointerEvents:"none"},onLoadedData:(e:any)=>{const v=e.currentTarget;v.muted=true;v.defaultMuted=true;void v.play?.().catch?.(()=>undefined)},onCanPlay:(e:any)=>{const v=e.currentTarget;v.muted=true;void v.play?.().catch?.(()=>undefined)},onEnded:(e:any)=>{const v=e.currentTarget;playCount.current+=1;if(playCount.current<2){v.currentTime=0;void v.play?.().catch?.(()=>undefined)}else{v.pause();try{v.currentTime=Math.max(0,(v.duration||0)-0.05)}catch{}}}}):<VideoView player={player} style={s.loginVideo} contentFit="cover" nativeControls={false}/>}<View style={s.loginShade}/><View style={s.loginPanel}>
      <View style={s.loginTopline}><Text style={s.loginTopText}>MT ASSISTANT · ACCESS</Text><Text style={s.loginSafe}>● 安全驗證</Text></View>
      <View style={s.loginBrand}><View style={s.loginIcon}><MaterialIcons name="casino" size={26} color="#F5C64A"/></View><View><Text style={s.loginKicker}>REAL-TIME CONTROL ROOM</Text><Text style={s.loginTitle}>即時多桌牌路</Text><Text style={s.loginSub}>安全登入後進入牌路控制台</Text></View></View>
      <View style={s.loginDivider}/><Text style={s.loginHint}>請輸入已授權的管理帳號與密碼。</Text>
      <Text style={s.loginLabel}>帳號</Text><TextInput value={username} onChangeText={setUsername} placeholder="輸入帳號" placeholderTextColor="#63798B" autoCapitalize="none" autoCorrect={false} style={s.loginInput}/>
      <Text style={s.loginLabel}>密碼</Text><View style={s.passwordWrap}><TextInput value={password} onChangeText={setPassword} placeholder="輸入密碼" placeholderTextColor="#63798B" secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} style={s.passwordInput} onSubmitEditing={submit}/><Pressable style={s.eyeBtn} onPress={()=>setShowPassword(v=>!v)}><MaterialIcons name={showPassword?"visibility-off":"visibility"} size={19} color="#6F8CA1"/></Pressable></View>
      <Pressable style={s.loginBtn} onPress={submit}><MaterialIcons name="verified-user" size={18} color="#fff"/><Text style={s.loginBtnText}>{login.isPending?"驗證中":"安全登入"}</Text></Pressable>{error?<Text style={s.error}>{error}</Text>:null}
      <Text style={s.loginFoot}>● 密碼只會用於本次登入驗證</Text><Pressable onPress={openLineContact}><Text style={s.loginHelp}>需要協助？LINE 聯絡</Text></Pressable>
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
  const [accessGranted,setAccessGranted]=useState(false);
  const [connectionOpen,setConnectionOpen]=useState(false);
  const [helpOpen,setHelpOpen]=useState(false);
  const [analysisTable,setAnalysisTable]=useState<TableData|null>(null);
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
  const recommendation=recommendSide(assistTable?.results??[]);

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
    const baseLeft=Math.max(0,width-74-visualWidth);
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
  }),[panelPosition,width,height,desktop,assistScale,panelBaseWidth]);
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

  const FloatingAssistant=({insideMt=false}:{insideMt?:boolean})=>{
    const glow=latest?resultColor(latest):"#5A6B78";
    const page1=<View {...pageSwipe.panHandlers} style={s.assistPage}>
      <View style={s.decisionRow}><View style={s.decisionBox}><Text style={s.smallLabel}>最近</Text><View style={s.latestLine}><View style={[s.glowDot,{backgroundColor:glow,shadowColor:glow}]}/><Text style={[s.latestText,{color:glow}]}>{latest??"—"}</Text></View></View><View style={s.decisionBox}><Text style={s.smallLabel}>牌型</Text><Text style={s.detectText}>{detectPattern(assistTable?.results??[])}</Text></View><View style={s.decisionBox}><Text style={s.smallLabel}>推薦下注</Text><Text style={[s.recommendText,{color:resultColor(recommendation)}]}>{recommendation} {nextAmount.toLocaleString()}</Text><Text style={s.microText}>搭配 {strategy}</Text></View></View>
      <View style={s.aiBox}><Text style={s.aiTitle}>AI分析</Text><Text style={s.aiText}>{analysisText(assistTable)}</Text></View>
    </View>;
    const page2=<View {...pageSwipe.panHandlers} style={s.assistPage}><View style={s.moneyGrid}><View style={s.fieldBox}><Text style={s.smallLabel}>目前本金</Text><TextInput keyboardType="numeric" value={String(bankroll)} onChangeText={v=>{const n=Math.max(0,Number(v)||0);setBankroll(n)}} style={s.moneyInput}/></View><View style={s.fieldBox}><Text style={s.smallLabel}>基本單注</Text><TextInput keyboardType="numeric" value={String(baseBet)} onChangeText={v=>setBaseBet(Math.max(0,Number(v)||0))} style={s.moneyInput}/></View><View style={s.fieldBox}><Text style={s.smallLabel}>下一注</Text><Text style={s.nextAmount}>{nextAmount.toLocaleString()}</Text></View></View><ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.strategyScroll} contentContainerStyle={s.strategyRow}>{strategies.map(x=><Pressable key={x} style={[s.strategyChip,strategy===x&&s.strategyChipActive]} onPress={()=>{setStrategy(x);setStrategyLevel(0)}}><Text style={[s.strategyChipText,strategy===x&&{color:"#fff"}]}>{x}</Text></Pressable>)}</ScrollView><View style={s.progressBox}><Text style={s.smallLabel}>策略進度</Text><Text style={s.progressText}>{strategy} · 第 {strategyLevel+1} 階　→　下一注 {nextAmount.toLocaleString()}</Text></View></View>;
    const page3=<View {...pageSwipe.panHandlers} style={s.assistPage}><View style={s.betButtons}><Pressable style={[s.betBtn,{backgroundColor:"#B8323B"}]} onPress={()=>placeManualBet("莊")}><Text style={s.betBtnText}>本局莊</Text></Pressable><Pressable style={[s.betBtn,{backgroundColor:"#1764C0"}]} onPress={()=>placeManualBet("閒")}><Text style={s.betBtnText}>本局閒</Text></Pressable><Pressable style={[s.betBtn,{backgroundColor:"#238A4B"}]} onPress={()=>placeManualBet("和")}><Text style={s.betBtnText}>和局</Text></Pressable></View><View style={s.statsGrid}><View><Text style={s.smallLabel}>目前本金</Text><Text style={s.statsValue}>{bankroll.toLocaleString()}</Text></View><View><Text style={s.smallLabel}>總損益</Text><Text style={[s.statsValue,{color:bankroll-initialBankroll>=0?"#4ED58B":"#FF6973"}]}>{(bankroll-initialBankroll>=0?"+":"")+(bankroll-initialBankroll).toLocaleString()}</Text></View><View><Text style={s.smallLabel}>勝 / 負</Text><Text style={s.statsValue}>{wins} / {losses}</Text></View><View><Text style={s.smallLabel}>勝率</Text><Text style={s.statsValue}>{decisions?((wins/decisions)*100).toFixed(1):"0.0"}%</Text></View></View><View style={s.recordBar}><Text style={s.microText}>{pendingBet?`等待開獎：${pendingBet.side} ${pendingBet.amount.toLocaleString()}`:`連${records[0]?.pnl>0?"勝":records[0]?.pnl<0?"敗":"續"} ${streak}　最大回撤 -${maxDrawdown.toLocaleString()}`}</Text><Pressable onPress={resetStats}><Text style={s.resetText}>重置統計</Text></Pressable></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.historyRow}>{records.slice(0,8).map((r,i)=><View key={i} style={s.historyChip}><Text style={{color:r.pnl>=0?"#53D990":"#FF7079",fontSize:9,fontWeight:"800"}}>{r.side} {r.pnl>=0?"+":""}{r.pnl.toLocaleString()}</Text></View>)}</ScrollView></View>;
    if(!floatingOpen)return null;
    return <Animated.View onLayout={(e:any)=>{const l=e.nativeEvent?.layout;if(l?.width&&l?.height){panelSizeRef.current={width:l.width,height:l.height}}}} style={[s.floatPanel,{width:panelBaseWidth,maxWidth:width-20},insideMt?s.floatPanelMt:null,desktop&&Platform.OS==="web"?({zoom:assistScale} as any):null,{transform:panelPosition.getTranslateTransform()}]}>
      <View style={s.floatHeader} {...panelDrag.panHandlers}><View style={s.floatHeadLeft}><Text style={s.floatTitle}>MT 懸浮輔助</Text><Text style={s.floatStatus}>{connected?"等待下一把開獎":"等待連線"}</Text></View><View style={s.row}><Pressable onPress={syncAssist} style={s.iconTextBtn}><MaterialIcons name="sync" size={15} color="#fff"/><Text style={s.iconText}>同步</Text></Pressable><Pressable onPress={()=>setFloatingOpen(false)} style={s.iconBtn}><MaterialIcons name="close" size={18} color="#fff"/></Pressable></View></View>
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

  const FloatOrb=({insideMt=false}:{insideMt?:boolean})=><Animated.View style={[s.orb,{width:orbSize,height:orbSize,borderRadius:orbSize/2},insideMt&&s.orbMt,{transform:orbPosition.getTranslateTransform()}]} {...orbResponder.panHandlers}><MaterialIcons name="apps" size={orbIconSize} color="#fff"/><View pointerEvents="none" style={[s.orbStatus,{width:Math.max(8,orbSize*.16),height:Math.max(8,orbSize*.16),borderRadius:orbSize*.08,right:orbSize*.08,top:orbSize*.08,backgroundColor:connected?"#36C46B":"#788C9B"}]}/></Animated.View>;

  if(!accessGranted)return <AccessScreen onAuthenticated={()=>setAccessGranted(true)}/>;

  return <ScreenContainer edges={["top","left","right","bottom"]} containerClassName="bg-[#080E17]" className="bg-[#080E17]">
    <View style={s.screen}>
      <View style={s.topbar}><View style={s.brandRow}><View style={s.brandIcon}><MaterialIcons name="casino" size={20} color="#F5C64A"/></View><View><Text style={s.kicker}>MT ASSISTANT · LIVE</Text><Text style={s.title}>即時多桌牌路</Text></View></View><View style={s.row}><Pressable style={s.lineBtn} onPress={openLineContact}><View style={s.lineLogo}><Text style={s.lineLogoText}>LINE</Text></View><Text style={s.lineText}>LINE</Text></Pressable><Pressable style={s.headerBtn} onPress={()=>setHelpOpen(true)}><MaterialIcons name="help-outline" size={16} color="#fff"/><Text style={s.headerBtnText}>說明</Text></Pressable><Pressable style={s.headerBtn} onPress={()=>setConnectionOpen(true)}><MaterialIcons name="settings" size={16} color="#fff"/><Text style={s.headerBtnText}>連線</Text></Pressable></View></View>
      <ScrollView contentContainerStyle={s.content}><View style={[s.overview,!desktop&&s.overviewMobile]}><View style={!desktop?s.overviewTextMobile:undefined}><Text style={s.overKicker}>LIVE CONTROL ROOM</Text><Text style={s.overTitle}>主頁牌路總覽</Text><Text style={s.overSub}>即時查看桌況、牌路與操作入口。</Text></View><View style={[s.overStats,!desktop&&s.overStatsMobile]}><View style={[s.overStat,!desktop&&s.overStatMobile]}><Text style={s.smallLabel}>連線狀態</Text><Text style={[s.overValue,{color:connected?"#4BD693":"#FF6973"}]}>{connected?"已連線":"未連線"}</Text></View><View style={[s.overStat,!desktop&&s.overStatMobile]}><Text style={s.smallLabel}>可用桌型</Text><Text style={s.overValue}>15 桌</Text></View></View></View><View style={s.listHead}><Text style={s.listTitle}>所有房型</Text><Text style={s.listHint}>歷史牌局 · 即時更新 · 荷官同步</Text></View><View style={[s.cardsGrid,desktop&&s.cardsGridDesktop,desktop&&s.cardsGridDesktopCentered]}>{tables.map(t=><View key={t.apiId} style={desktop?s.cardWrapDesktop:s.cardWrap}><MemoTableCard table={t} desktop={desktop} onAction={stableTableAction}/></View>)}</View></ScrollView>
      {FloatingAssistant({})}<FloatOrb/>
      {toast?<View style={s.toast}><Text style={s.toastText}>{toast}</Text></View>:null}

      <Modal visible={connectionOpen} transparent animationType="fade" onRequestClose={()=>setConnectionOpen(false)}><View style={s.modalShade}><View style={s.connectionModal}><View style={s.modalHead}><Text style={s.modalTitle}>主頁與 MT 連線設定</Text><Pressable onPress={()=>setConnectionOpen(false)}><MaterialIcons name="close" size={22} color="#DDE8F0"/></Pressable></View><Text style={s.modalNote}>主頁牌路 WebSocket 與 MT 平台使用獨立工作階段。關閉此視窗不會中斷已建立的連線。</Text><Text style={s.fieldLabel}>主頁牌路 WebSocket（固定）</Text><TextInput value={wsUrl} editable={false} secureTextEntry style={s.modalInput}/><Text style={s.fieldLabel}>主頁牌路來源 / Token</Text><TextInput value={token} onChangeText={setToken} secureTextEntry placeholder="貼入含 token 的登入網址" placeholderTextColor="#63798B" style={s.modalInput}/><Text style={s.fieldLabel}>MT 平台獨立網址</Text><TextInput value={mtUrl} onChangeText={setMtUrl} placeholder="https://.../?token=..." placeholderTextColor="#63798B" style={s.modalInput}/><View style={s.mappingRow}><Text style={s.mapChip}>winner 1：閒</Text><Text style={s.mapChip}>winner 2：莊</Text><Text style={s.mapChip}>winner 3：和</Text></View><View style={s.modalActions}><Pressable style={[s.actionBtn,{backgroundColor:"#1F6F9D"}]} onPress={syncAssist}><Text style={s.btnText}>驗證主頁牌路</Text></Pressable><Pressable style={[s.actionBtn,{backgroundColor:"#238F58"}]} onPress={()=>startConnection()}><Text style={s.btnText}>開始連線</Text></Pressable><Pressable style={[s.actionBtn,{backgroundColor:"#A63E48"}]} onPress={stopConnection}><Text style={s.btnText}>中斷</Text></Pressable><Pressable style={[s.actionBtn,{backgroundColor:"#2E7CEB"}]} onPress={()=>setConnectionOpen(false)}><Text style={s.btnText}>完成</Text></Pressable></View><Text style={s.syncText}>同步階段：主頁已同步 {tables.filter(t=>t.live).length} 桌</Text><Text style={s.fieldLabel}>即時事件</Text><ScrollView style={s.logBox}>{events.map((x,i)=><Text key={i} style={s.logText}>{x}</Text>)}</ScrollView></View></View></Modal>
      <Modal visible={helpOpen} transparent animationType="fade" onRequestClose={()=>setHelpOpen(false)}><View style={s.modalShade}><View style={s.smallModal}><View style={s.modalHead}><Text style={s.modalTitle}>說明</Text><Pressable onPress={()=>setHelpOpen(false)}><MaterialIcons name="close" size={22} color="#fff"/></Pressable></View><Text style={s.helpText}>主頁顯示 15 桌即時牌路。MT 懸浮輔助可左右滑動 3 頁：即時輔助、資金策略、輸贏統計。</Text></View></View></Modal>
      <Modal visible={!!analysisTable} transparent animationType="fade" onRequestClose={()=>setAnalysisTable(null)}><View style={s.modalShade}><View style={s.smallModal}><View style={s.modalHead}><Text style={s.modalTitle}>百家樂 {analysisTable?.id} 分析</Text><Pressable onPress={()=>setAnalysisTable(null)}><MaterialIcons name="close" size={22} color="#fff"/></Pressable></View><Text style={s.helpText}>{analysisText(analysisTable??undefined)}</Text></View></View></Modal>
      <Modal visible={mtOpen} animationType="slide" onRequestClose={()=>setMtOpen(false)}><View style={s.mtScreen}><View style={s.mtTop}><View style={s.brandRow}><View style={s.brandIcon}><MaterialIcons name="casino" size={20} color="#F5C64A"/></View><View><Text style={s.kicker}>MT ASSISTANT · LIVE</Text><Text style={s.title}>即時多桌牌路</Text></View></View><View style={s.row}><Pressable style={s.lineBtn} onPress={openLineContact}><View style={s.lineLogo}><Text style={s.lineLogoText}>LINE</Text></View><Text style={s.lineText}>LINE</Text></Pressable><Pressable style={s.headerBtn} onPress={()=>setHelpOpen(true)}><MaterialIcons name="help-outline" size={16} color="#fff"/><Text style={s.headerBtnText}>說明</Text></Pressable><Pressable style={s.headerBtn} onPress={()=>setMtOpen(false)}><MaterialIcons name="arrow-back" size={16} color="#fff"/><Text style={s.headerBtnText}>回牌路</Text></Pressable></View></View><View style={s.iframeWrap}>{Platform.OS==="web"?createElement("iframe" as any,{src:mtUrl.trim()||token.trim(),style:{width:"100%",height:"100%",border:"0",background:"#000"},allow:"clipboard-read; clipboard-write; fullscreen"}):<View style={s.nativeMtFallback}><Text style={s.helpText}>目前原生模式請使用外部瀏覽器開啟 MT 平台。</Text></View>}</View>{FloatingAssistant({insideMt:true})}<FloatOrb insideMt/></View></Modal>
    </View>
  </ScreenContainer>;
}

const s=StyleSheet.create({
  screen:{flex:1,backgroundColor:"#080E17"},row:{flexDirection:"row",alignItems:"center",gap:6},brandRow:{flexDirection:"row",alignItems:"center",gap:8},
  topbar:{minHeight:58,paddingHorizontal:14,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:"#1C3448"},brandIcon:{width:34,height:34,borderRadius:8,borderWidth:1,borderColor:"#8C7425",alignItems:"center",justifyContent:"center"},kicker:{color:"#7890A3",fontSize:8,letterSpacing:1.1},title:{color:"#F2F6F9",fontSize:16,fontWeight:"800"},
  lineBtn:{height:34,paddingHorizontal:9,borderRadius:7,backgroundColor:"#0C9B43",flexDirection:"row",alignItems:"center",gap:5},lineLogo:{width:23,height:23,borderRadius:11.5,backgroundColor:"#fff",alignItems:"center",justifyContent:"center"},lineLogoText:{fontSize:5.5,fontWeight:"900",color:"#0C9B43"},lineText:{color:"#fff",fontSize:10,fontWeight:"900"},headerBtn:{height:34,paddingHorizontal:9,borderRadius:7,backgroundColor:"#18344C",flexDirection:"row",alignItems:"center",gap:5,borderWidth:1,borderColor:"#2A4A63"},headerBtnText:{color:"#fff",fontSize:10,fontWeight:"800"},
  content:{padding:10,paddingBottom:90},overview:{borderWidth:1,borderColor:"#244158",borderRadius:8,padding:12,flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:10,backgroundColor:"#0E1B28",overflow:"hidden"},overviewMobile:{flexDirection:"column",alignItems:"stretch",gap:10},overviewTextMobile:{width:"100%"},overKicker:{color:"#6E99B9",fontSize:7,letterSpacing:1.4},overTitle:{color:"#fff",fontSize:18,fontWeight:"900",marginTop:2},overSub:{color:"#7E92A2",fontSize:9,marginTop:3},overStats:{flexDirection:"row",gap:8},overStatsMobile:{width:"100%",gap:6},overStat:{minWidth:112,borderWidth:1,borderColor:"#28475D",borderRadius:6,padding:9},overStatMobile:{flex:1,minWidth:0,padding:8},overValue:{color:"#fff",fontSize:13,fontWeight:"900",marginTop:4},listHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:7},listTitle:{color:"#F2F6F9",fontSize:15,fontWeight:"900"},listHint:{color:"#73899A",fontSize:8},
  cardsGrid:{width:"100%",alignSelf:"center"},cardsGridDesktop:{flexDirection:"row",flexWrap:"wrap",gap:10},cardsGridDesktopCentered:{maxWidth:1280},cardWrap:{width:"100%"},cardWrapDesktop:{width:"calc(50% - 5px)" as any,maxWidth:635},tableCard:{backgroundColor:"#06090E",borderWidth:1,borderColor:"#1B3449",overflow:"hidden",marginBottom:10},tableCardDesktop:{},tableHead:{height:28,paddingHorizontal:5,backgroundColor:"#05070A",flexDirection:"row",justifyContent:"space-between",alignItems:"center"},game:{color:"#fff",fontSize:9,fontWeight:"700"},tableId:{color:"#fff",borderWidth:1,borderColor:"#AEBCC6",paddingHorizontal:6,paddingVertical:1,fontSize:9,fontWeight:"900"},headText:{color:"#fff",fontSize:8,fontWeight:"800"},statText:{fontSize:8,fontWeight:"900"},countWrap:{height:20,minWidth:28,borderWidth:1,borderColor:"#8D2030",borderRadius:4,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:2,paddingHorizontal:3},countdown:{color:"#FF5362",fontSize:8,fontWeight:"900"},miniBtn:{height:20,paddingHorizontal:6,borderRadius:4,alignItems:"center",justifyContent:"center"},miniBtnText:{color:"#fff",fontSize:7,fontWeight:"900"},
  tableBody:{flexDirection:"row",height:176,backgroundColor:"#fff",overflow:"hidden"},tableBodyDesktop:{height:190},tableBodyMobile:{height:164},dealer:{width:112,backgroundColor:"#F2F0EC",padding:4,justifyContent:"flex-end"},dealerDesktop:{width:"21.88%"},dealerMobile:{width:"21.88%",minWidth:76},photo:{position:"absolute",top:3,left:3,right:3,height:112,backgroundColor:"#DCE2E6",alignItems:"center",justifyContent:"center",overflow:"hidden"},photoDesktop:{height:"82%"},photoMobile:{height:"80%"},photoImage:{width:"100%",height:"100%",resizeMode:"cover"},crown:{fontSize:30,color:"#C5A24C"},dealerName:{color:"#fff",backgroundColor:"#873B96",alignSelf:"flex-start",paddingHorizontal:5,paddingVertical:2,fontSize:11,fontWeight:"900",lineHeight:14},meta:{color:"#526371",fontSize:8.5,fontWeight:"700",lineHeight:11,marginTop:1},
  roadArea:{flex:1,flexDirection:"row",backgroundColor:"#fff",minWidth:0,overflow:"hidden"},roadAreaDesktop:{},beadPane:{width:"32%",height:"100%",flexShrink:0,borderRightWidth:1,borderColor:"#C9D2D9",overflow:"hidden",backgroundColor:"#FFFFFF"},beadPaneDesktop:{width:"32%"},beadGrid:{width:"100%",height:"100%",flexDirection:"row",flexWrap:"wrap",alignContent:"stretch",backgroundColor:"#FFFFFF"},beadCell:{width:"16.6666667%",height:"16.6666667%",flexGrow:0,flexShrink:0,borderRightWidth:1,borderBottomWidth:1,borderColor:"#D9DEE3",alignItems:"center",justifyContent:"center",backgroundColor:"#FFFFFF"},beadCellDesktop:{},beadDot:{width:"72%",aspectRatio:1,borderRadius:999,borderWidth:1,alignItems:"center",justifyContent:"center",shadowColor:"#000",shadowOpacity:.10,shadowRadius:1,elevation:1},beadDotDesktop:{width:"70%"},beadDotText:{color:"#FFFFFF",fontSize:8,fontWeight:"900",lineHeight:10,textAlign:"center"},beadDotTextDesktop:{fontSize:9,lineHeight:11},roadStack:{flex:1,minWidth:0,height:"100%"},bigGrid:{width:"100%",height:"62%",flexDirection:"row",flexWrap:"wrap",alignContent:"stretch"},bigGridDesktop:{},bigCell:{width:"6.6666667%",height:"16.6666667%",borderRightWidth:1,borderBottomWidth:1,borderColor:"#DDE4E9",alignItems:"center",justifyContent:"center",overflow:"hidden"},bigCellDesktop:{},bigMark:{width:"72%",maxWidth:"78%",aspectRatio:1,borderRadius:999,borderWidth:1.35,backgroundColor:"transparent",alignItems:"center",justifyContent:"center"},bigMarkDesktop:{width:"70%",borderWidth:1.2},tieNumber:{color:"#20B66B",fontSize:7,fontWeight:"900",lineHeight:8},tieNumberDesktop:{fontSize:7,lineHeight:8},lowerArea:{width:"100%",height:"38%",flexDirection:"row",borderTopWidth:1,borderTopColor:"#CCD6DE"},lowerAreaDesktop:{},lowerPane:{width:"33.333333%",height:"100%",flexDirection:"row",flexWrap:"wrap",alignContent:"stretch",borderRightWidth:1,borderRightColor:"#DDE4E9"},lowerCell:{width:"10%",height:"16.6666667%",alignItems:"center",justifyContent:"center",borderRightWidth:.5,borderBottomWidth:.5,borderColor:"#E4E8EB",overflow:"hidden"},lowerCellDesktop:{},lowerHollow:{width:"55%",aspectRatio:1,borderRadius:999,borderWidth:1.4,backgroundColor:"transparent"},lowerSolid:{width:"52%",aspectRatio:1,borderRadius:999},lowerSlash:{width:"58%",height:2,borderRadius:2,transform:[{rotate:"-45deg"}]},
  orb:{position:"absolute",right:16,bottom:24,zIndex:90,width:50,height:50,borderRadius:25,backgroundColor:"#153B59",borderWidth:2,borderColor:"#66A9F1",alignItems:"center",justifyContent:"center",shadowColor:"#000",shadowOpacity:.45,shadowRadius:9,elevation:12,touchAction:"none" as any,userSelect:"none" as any,cursor:"grab" as any},orbMt:{bottom:34},orbStatus:{position:"absolute",right:4,top:4,width:8,height:8,borderRadius:4,borderWidth:1,borderColor:"#fff"},
  floatPanel:{position:"absolute",right:74,bottom:22,zIndex:100,backgroundColor:"rgba(13,26,39,.96)",borderWidth:1,borderColor:"#385975",borderRadius:9,overflow:"hidden",shadowColor:"#000",shadowOpacity:.45,shadowRadius:14,elevation:15},floatPanelMt:{zIndex:9999},floatHeader:{height:38,paddingHorizontal:9,flexDirection:"row",alignItems:"center",justifyContent:"space-between",backgroundColor:"#14283B",touchAction:"none" as any,userSelect:"none" as any,cursor:"grab" as any},floatHeadLeft:{flexDirection:"row",alignItems:"center",gap:8},floatTitle:{color:"#F0F5F9",fontWeight:"900",fontSize:12},floatStatus:{color:"#56D48C",fontSize:8},iconBtn:{width:27,height:27,borderRadius:5,backgroundColor:"#214A70",alignItems:"center",justifyContent:"center"},iconTextBtn:{height:27,paddingHorizontal:7,borderRadius:5,backgroundColor:"#214A70",flexDirection:"row",gap:3,alignItems:"center"},iconText:{color:"#fff",fontSize:8,fontWeight:"800"},selectorWrap:{marginHorizontal:6,marginTop:6,position:"relative",zIndex:130},selector:{height:38,paddingHorizontal:9,borderWidth:1,borderColor:"#31516B",borderRadius:5,backgroundColor:"#09151F",flexDirection:"row",alignItems:"center",justifyContent:"space-between"},selectorLeft:{flexDirection:"row",alignItems:"center",gap:4},selectorValue:{color:"#F0F5F8",fontSize:11,fontWeight:"900"},selectorMeta:{color:"#B6C5D0",fontSize:9},roomDropdown:{position:"absolute",left:0,right:0,top:42,maxHeight:205,backgroundColor:"#0A1722",borderWidth:1,borderColor:"#345A76",borderRadius:6,zIndex:160,elevation:30,overflow:"hidden",shadowColor:"#000",shadowOpacity:.45,shadowRadius:10},roomDropdownScroll:{height:205,maxHeight:205,overflow:"scroll"},roomDropdownContent:{paddingBottom:2},roomDropdownItem:{minHeight:42,paddingHorizontal:10,paddingVertical:5,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:"#183044"},roomDropdownItemActive:{backgroundColor:"#1B5B88"},roomDropdownLeft:{flex:1,minWidth:0,paddingRight:8},roomDropdownText:{color:"#EDF5FA",fontSize:10,fontWeight:"900"},roomDropdownDealer:{color:"#AFC1CD",fontSize:8,marginTop:2},roomDropdownMeta:{color:"#8EA7B9",fontSize:8,fontWeight:"800"},assistPage:{padding:6,minHeight:150},decisionRow:{flexDirection:"row",gap:5},decisionBox:{flex:1,minHeight:68,backgroundColor:"#102335",borderWidth:1,borderColor:"#294B64",borderRadius:5,padding:7},smallLabel:{color:"#8EA3B3",fontSize:7.5},latestLine:{flexDirection:"row",alignItems:"center",gap:7,marginTop:7},glowDot:{width:17,height:17,borderRadius:8.5,shadowOpacity:1,shadowRadius:10,elevation:8},latestText:{fontSize:16,fontWeight:"900"},detectText:{color:"#F1F6F9",fontSize:11,fontWeight:"900",marginTop:7},recommendText:{fontSize:14,fontWeight:"900",marginTop:7},microText:{color:"#8FA2B0",fontSize:7,marginTop:2},aiBox:{marginTop:5,backgroundColor:"#0B1925",borderRadius:5,padding:7},aiTitle:{color:"#B7D3E6",fontSize:11,fontWeight:"900"},aiText:{color:"#C6D2DB",fontSize:11,lineHeight:17,marginTop:5},moneyGrid:{flexDirection:"row",gap:5},fieldBox:{flex:1,backgroundColor:"#102335",borderRadius:5,padding:7,minHeight:58},moneyInput:{color:"#fff",fontSize:13,fontWeight:"900",padding:0,marginTop:5},nextAmount:{color:"#54D79A",fontSize:15,fontWeight:"900",marginTop:6},strategyScroll:{marginTop:6,maxHeight:30},strategyRow:{gap:4},strategyChip:{height:25,paddingHorizontal:8,borderRadius:4,backgroundColor:"#172B3B",justifyContent:"center"},strategyChipActive:{backgroundColor:"#2B78B5"},strategyChipText:{color:"#AABCC8",fontSize:7.5,fontWeight:"800"},progressBox:{marginTop:6,backgroundColor:"#0B1925",borderRadius:5,padding:7},progressText:{color:"#DDE9F0",fontSize:9,fontWeight:"800",marginTop:4},betButtons:{flexDirection:"row",gap:5},betBtn:{flex:1,height:38,borderRadius:5,alignItems:"center",justifyContent:"center"},betBtnText:{color:"#fff",fontSize:12,fontWeight:"900"},statsGrid:{marginTop:6,backgroundColor:"#102335",borderRadius:5,padding:7,flexDirection:"row",justifyContent:"space-between"},statsValue:{color:"#fff",fontSize:11,fontWeight:"900",marginTop:3},recordBar:{marginTop:5,flexDirection:"row",justifyContent:"space-between",alignItems:"center"},resetText:{color:"#51BDF1",fontSize:8,fontWeight:"900"},historyRow:{gap:4,marginTop:5},historyChip:{backgroundColor:"#142A3B",borderRadius:4,paddingHorizontal:6,paddingVertical:4},pageDots:{height:19,flexDirection:"row",gap:7,alignItems:"center",justifyContent:"center"},pageDot:{width:6,height:6,borderRadius:3,backgroundColor:"#526574"},pageDotActive:{backgroundColor:"#fff"},resizeHandle:{position:"absolute",right:0,bottom:0,width:34,height:34,borderTopLeftRadius:9,backgroundColor:"#153A55",borderLeftWidth:1,borderTopWidth:1,borderColor:"#4C7896",alignItems:"center",justifyContent:"center",zIndex:190,cursor:"nwse-resize" as any},resizeText:{color:"#9CC5E4",fontSize:7,fontWeight:"900"},
  loginScreen:{flex:1,backgroundColor:"#020A12",alignItems:"center",justifyContent:"center",padding:18,overflow:"hidden"},loginVideo:{...StyleSheet.absoluteFillObject},loginShade:{...StyleSheet.absoluteFillObject,backgroundColor:"rgba(2,10,18,.46)"},loginPanel:{width:"100%",maxWidth:480,backgroundColor:"rgba(7,31,44,.76)",borderWidth:1,borderColor:"rgba(82,151,177,.62)",borderRadius:18,padding:22,shadowColor:"#000",shadowOpacity:.4,shadowRadius:20,elevation:14},loginTopline:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:26},loginTopText:{color:"#A9BED0",fontSize:9,letterSpacing:1.8,fontWeight:"700"},loginSafe:{color:"#39E0B0",fontSize:9,fontWeight:"800"},loginBrand:{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:13,marginBottom:22},loginIcon:{width:46,height:46,borderRadius:12,borderWidth:1,borderColor:"#D5A82F",alignItems:"center",justifyContent:"center",backgroundColor:"rgba(245,198,74,.08)"},loginKicker:{color:"#8DB4CE",fontSize:8,letterSpacing:1.5,fontWeight:"700"},loginTitle:{color:"#F5F8FA",fontSize:24,fontWeight:"900",marginTop:4},loginSub:{color:"#91A7B8",fontSize:10,marginTop:3},loginDivider:{height:1,backgroundColor:"rgba(109,157,184,.32)",marginBottom:20},loginHint:{color:"#A7B8C5",fontSize:11,marginBottom:18},loginLabel:{color:"#B9C8D3",fontSize:11,fontWeight:"700",marginBottom:6},loginInput:{height:48,backgroundColor:"rgba(2,17,28,.68)",borderRadius:8,borderWidth:1,borderColor:"#385B70",color:"#fff",paddingHorizontal:14,fontSize:14,marginBottom:14},passwordWrap:{height:48,backgroundColor:"rgba(2,17,28,.68)",borderRadius:8,borderWidth:1,borderColor:"#385B70",flexDirection:"row",alignItems:"center",marginBottom:16},passwordInput:{flex:1,height:"100%",color:"#fff",paddingHorizontal:14,fontSize:14},eyeBtn:{width:46,height:"100%",alignItems:"center",justifyContent:"center"},loginBtn:{height:50,backgroundColor:"#168CEB",borderRadius:8,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:8},loginBtnText:{color:"#fff",fontSize:14,fontWeight:"900"},error:{color:"#FF959C",fontSize:11,textAlign:"center",marginTop:10},loginFoot:{color:"#71899A",fontSize:9,textAlign:"center",marginTop:18},loginHelp:{color:"#42B9F5",fontSize:10,fontWeight:"800",textAlign:"center",marginTop:10},
  modalShade:{flex:1,backgroundColor:"rgba(0,0,0,.72)",alignItems:"center",justifyContent:"center",padding:16},connectionModal:{width:"100%",maxWidth:760,maxHeight:"92%",backgroundColor:"#162231",borderWidth:1,borderColor:"#31506A",borderRadius:8,padding:18},smallModal:{width:"100%",maxWidth:520,backgroundColor:"#162231",borderWidth:1,borderColor:"#31506A",borderRadius:8,padding:18},modalHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:12},modalTitle:{color:"#fff",fontSize:17,fontWeight:"800"},modalNote:{color:"#BAC7D0",fontSize:10,lineHeight:15,backgroundColor:"#0C1721",padding:10,borderRadius:5,marginBottom:12},fieldLabel:{color:"#C6D3DC",fontSize:10,marginBottom:5,marginTop:8},modalInput:{height:42,borderWidth:1,borderColor:"#36536A",borderRadius:5,backgroundColor:"#08131D",color:"#fff",paddingHorizontal:10},mappingRow:{flexDirection:"row",gap:6,marginTop:10,flexWrap:"wrap"},mapChip:{color:"#C8D4DD",fontSize:9,backgroundColor:"#263A4C",paddingHorizontal:8,paddingVertical:6,borderRadius:4},modalActions:{flexDirection:"row",gap:7,marginTop:12,flexWrap:"wrap"},actionBtn:{height:38,paddingHorizontal:12,borderRadius:5,justifyContent:"center"},btnText:{color:"#fff",fontWeight:"900",fontSize:10},syncText:{color:"#AFC0CB",fontSize:9,marginTop:11},logBox:{height:130,backgroundColor:"#08131D",borderRadius:5,padding:9,marginTop:4},logText:{color:"#B8C8D2",fontSize:8,lineHeight:13},helpText:{color:"#D2DDE4",fontSize:11,lineHeight:18},
  mtScreen:{flex:1,backgroundColor:"#05090E"},mtTop:{minHeight:58,paddingHorizontal:14,flexDirection:"row",alignItems:"center",justifyContent:"space-between",backgroundColor:"#10202D",borderBottomWidth:1,borderBottomColor:"#28465A"},mtTitle:{color:"#fff",fontSize:15,fontWeight:"900"},iframeWrap:{flex:1},nativeMtFallback:{flex:1,alignItems:"center",justifyContent:"center"},toast:{position:"absolute",bottom:78,left:20,right:20,backgroundColor:"#203A4E",borderRadius:8,padding:9,zIndex:200},toastText:{color:"#fff",textAlign:"center",fontSize:10}
});

