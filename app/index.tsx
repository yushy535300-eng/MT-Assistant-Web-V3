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
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import {
  applyLiveShowWin,
  applyLiveTables,
  applyLiveWait,
  getApiTableId,
  type RoadResult,
} from "@/lib/road-live-state";
import {
  buildAskRoad,
  buildBeadGrid,
  buildBigRoad,
  buildDerivedRoad,
  buildRoadWindow,
  type AskRoadPrediction,
} from "@/lib/road-render";

type Result = RoadResult;
type BetSide = Result;
type Strategy = "平注" | "馬丁" | "達朗貝爾" | "Fibonacci" | "Paroli" | "1-3-2-6" | "Labouchere" | "Oscar's Grind";
type BetHistory = { side: BetSide; result: Result; amount: number; pnl: number; at: number };
type PendingBet = { side: BetSide; amount: number; openSignature: string };

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
  dealerPhoto?: string;
  lastUpdated?: number;
  lastResultKey?: string;
};

const baccaratTableIds = ["BAG01","BAG02","BAG03","BAG03A","BAG05","BAG06","BAG07","BAG08","BAG09","BAG10","BAG11","BAG12","BAG13","BAG13A","BAG15"];
const initialTables: TableData[] = baccaratTableIds.map((apiId) => ({
  id: apiId.replace(/^BAG0?/, ""), apiId, game: "百家樂", name: "—", players: "—",
  roomId: "—", tableBadge: "—", shoe: "—", round: 0, banker: 0, player: 0, tie: 0,
  results: [], trend: "",
}));
const lineContactUrl = "https://line.me/ti/p/HM2rMNvenj";
const resultColor = (r?: Result) => r === "莊" ? "#E9434D" : r === "閒" ? "#3275DF" : r === "和" ? "#35B477" : "#70889A";
const money = (value: number) => Math.round(value).toLocaleString("zh-TW");

function openLineContact() {
  if (typeof window !== "undefined") window.open(lineContactUrl, "_blank", "noopener,noreferrer");
  else Linking.openURL(lineContactUrl).catch(() => undefined);
}

function detectPattern(results: Result[]) {
  const seq = results.filter((r) => r !== "和");
  if (seq.length < 3) return "資料累積中";
  const tail = seq.slice(-10);
  const last = tail.at(-1)!;
  let run = 1;
  for (let i = tail.length - 2; i >= 0 && tail[i] === last; i--) run++;
  if (run >= 4) return `${last}${run}連龍趨勢`;
  if (tail.length >= 6 && tail.slice(-6).every((v, i, a) => i === 0 || v !== a[i - 1])) return "單跳趨勢";
  if (tail.length >= 6) {
    const a = tail.slice(-6);
    if (a[0] === a[1] && a[2] === a[3] && a[4] === a[5] && a[0] !== a[2] && a[2] !== a[4]) return "雙跳趨勢";
  }
  return run >= 2 ? `${last}${run}連` : "混合走勢";
}

function buildAnalysis(results: Result[]) {
  if (!results.length) return "等待即時牌路資料。";
  const seq = results.filter((r) => r !== "和");
  const latest = results.at(-1);
  const pattern = detectPattern(results);
  const recent = seq.slice(-8);
  const banker = recent.filter((r) => r === "莊").length;
  const player = recent.filter((r) => r === "閒").length;
  const bias = banker === player ? "近況莊閒均衡" : banker > player ? `近 8 手莊較多（${banker}:${player}）` : `近 8 手閒較多（${player}:${banker}）`;
  return `最新${latest ?? "—"}；${pattern}；${bias}。配注只依第二頁設定計算，不代表開獎保證。`;
}

function ResultDot({ result }: { result: Result }) {
  return <View style={[s.beadDot, { backgroundColor: resultColor(result) }]} />;
}

function RoadGrid({ table }: { table: TableData }) {
  const results = table.results;
  const beads = useMemo(() => buildBeadGrid(results), [results]);
  const big = useMemo(() => buildRoadWindow(buildBigRoad(results), 15), [results]);
  const lower = useMemo(() => [
    buildRoadWindow(buildDerivedRoad(results, 1, false), 10),
    buildRoadWindow(buildDerivedRoad(results, 2, true), 10),
    buildRoadWindow(buildDerivedRoad(results, 3, false), 10),
  ], [results]);

  return <View style={s.roadArea}>
    <View style={s.beadPane}><View style={s.beadGrid}>
      {Array.from({length:36}, (_, i) => <View key={i} style={s.beadCell}>{beads[i] ? <ResultDot result={beads[i]!}/> : null}</View>)}
    </View></View>
    <View style={s.roadStack}>
      <View style={s.bigGrid}>{Array.from({length:90}, (_, i) => {
        const row = Math.floor(i / 15), col = i % 15;
        const m = big.find(x => x.row === row && x.col === col);
        return <View key={i} style={s.bigCell}>{m ? <View style={[s.bigMark,{borderColor:resultColor(m.result)}]}>
          {m.tieCount ? <Text style={s.tieNumber}>{m.tieCount}</Text> : null}
        </View> : null}</View>;
      })}</View>
      <View style={s.lowerArea}>{lower.map((road, ri) => <View key={ri} style={s.lowerPane}>
        {Array.from({length:60}, (_, i) => {
          const row = Math.floor(i / 10), col = i % 10;
          const m = road.find(x => x.row === row && x.col === col);
          const slash = ri === 2;
          return <View key={i} style={s.lowerCell}>{m ? <View style={[
            slash ? s.slash : s.lowerMark,
            {borderColor:resultColor(m.result), backgroundColor:(m.filled || slash) ? resultColor(m.result) : "transparent"},
            slash && {transform:[{rotate:"-45deg"}]}
          ]}/> : null}</View>;
        })}
      </View>)}</View>
    </View>
  </View>;
}

function CountdownBadge({count, updatedAt}:{count?:number;updatedAt?:number}) {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[]);
  const elapsed=updatedAt?Math.floor((now-updatedAt)/1000):0;
  return <Text style={s.countdown}>{count==null?"—":Math.max(0,count-elapsed)}</Text>;
}

function TableCard({table, favorite, onFavorite, onAnalysis, onMt}:{table:TableData;favorite:boolean;onFavorite:()=>void;onAnalysis:()=>void;onMt:()=>void}) {
  return <View style={s.tableCard}>
    <View style={s.tableHead}>
      <View style={s.tableHeadLeft}>
        <Text style={s.game}>百家樂</Text><Text style={s.tableId}>{table.id}</Text>
        <MaterialIcons name="person" size={14} color="#fff"/><Text style={s.peopleText}>{table.players}</Text>
        <CountdownBadge count={table.countdown} updatedAt={table.countdownUpdatedAt}/>
      </View>
      <View style={s.tableHeadRight}>
        <Text style={[s.statMini,{color:"#F25359"}]}>莊 {table.banker}</Text>
        <Text style={[s.statMini,{color:"#3B7FE8"}]}>閒 {table.player}</Text>
        <Text style={[s.statMini,{color:"#3BC18B"}]}>和 {table.tie}</Text>
        <Pressable style={s.actionPurple} onPress={onAnalysis}><Text style={s.actionText}>分析</Text></Pressable>
        <Pressable style={s.actionGreen} onPress={onFavorite}><Text style={s.actionText}>{favorite?"已關注":"關注"}</Text></Pressable>
        <Pressable style={s.actionBlue} onPress={onMt}><Text style={s.actionText}>MT平台</Text></Pressable>
      </View>
    </View>
    <View style={s.tableBody}>
      <View style={s.dealer}>
        <View style={s.photo}>{table.dealerPhoto?<Image source={{uri:table.dealerPhoto}} style={s.photoImg} resizeMode="cover"/>:<Text style={s.crown}>♛</Text>}</View>
        <Text style={s.dealerName}>{table.name || "—"}</Text>
        <Text style={s.meta}>房間 {table.roomId || "—"}</Text>
        <Text style={s.meta}>Shoe {table.shoe} · 第 {table.round} 把</Text>
      </View>
      <RoadGrid table={table}/>
    </View>
  </View>;
}

function AskSymbols({p}:{p:AskRoadPrediction}) {
  const items=[["○",p.bigEye],["●",p.small],["╱",p.cockroach]] as const;
  return <View style={s.askSymbols}>{items.map(([x,c],i)=><Text key={i} style={{fontWeight:"900",color:resultColor(c??undefined)}}>{x}</Text>)}</View>;
}

function calcStrategyAmount(strategy: Strategy, base: number, step: number, lab: number[]) {
  const unit = Math.max(1, base || 1);
  if (strategy === "平注") return unit;
  if (strategy === "馬丁") return unit * Math.pow(2, Math.max(0, step));
  if (strategy === "達朗貝爾") return unit * (Math.max(0, step) + 1);
  if (strategy === "Fibonacci") {
    const fib = [1,1,2,3,5,8,13,21,34,55];
    return unit * fib[Math.min(step, fib.length - 1)];
  }
  if (strategy === "Paroli") return unit * Math.pow(2, Math.min(2, Math.max(0, step)));
  if (strategy === "1-3-2-6") return unit * [1,3,2,6][Math.min(3,Math.max(0,step))];
  if (strategy === "Labouchere") return unit * (lab.length <= 1 ? (lab[0] ?? 1) : lab[0] + lab[lab.length-1]);
  return unit * (Math.max(0, step) + 1);
}

function nextStrategyState(strategy: Strategy, outcome: "win"|"loss"|"push", step: number, lab: number[], currentUnits: number) {
  if (outcome === "push") return { step, lab };
  if (strategy === "平注") return { step:0, lab };
  if (strategy === "馬丁") return { step: outcome === "loss" ? Math.min(step+1,10) : 0, lab };
  if (strategy === "達朗貝爾") return { step: outcome === "loss" ? Math.min(step+1,20) : Math.max(0,step-1), lab };
  if (strategy === "Fibonacci") return { step: outcome === "loss" ? Math.min(step+1,9) : Math.max(0,step-2), lab };
  if (strategy === "Paroli") return { step: outcome === "win" ? (step >= 2 ? 0 : step+1) : 0, lab };
  if (strategy === "1-3-2-6") return { step: outcome === "win" ? (step >= 3 ? 0 : step+1) : 0, lab };
  if (strategy === "Labouchere") {
    if (outcome === "win") return { step, lab: lab.length > 2 ? lab.slice(1,-1) : [1,2,3,4] };
    return { step, lab: [...lab, Math.max(1,Math.round(currentUnits))] };
  }
  // Oscar's Grind：輸維持，贏後 +1；每 3 次贏利循環重置。
  return { step: outcome === "win" ? (step >= 2 ? 0 : step+1) : step, lab };
}

function FloatingAssistant({open,onToggle,tables,selectedId,onSelect,onSync}:{
  open:boolean;onToggle:()=>void;tables:TableData[];selectedId:string;onSelect:(id:string)=>void;onSync:()=>void;
}) {
  const {width}=useWindowDimensions();
  const panelWidth=Math.min(580, Math.max(300, width-(width<650?24:96)));
  const table=tables.find(t=>(t.apiId??`BAG${t.id}`)===selectedId)??tables[0];
  const latest=table?.results.at(-1);
  const ask=useMemo(()=>table?.results.length?buildAskRoad(table.results):null,[table?.results]);
  const [menu,setMenu]=useState(false);
  const [strategyMenu,setStrategyMenu]=useState(false);
  const [page,setPage]=useState(0);
  const pagesRef=useRef<ScrollView|null>(null);
  const [bankrollInput,setBankrollInput]=useState("100000");
  const [baseInput,setBaseInput]=useState("1000");
  const startingBankroll=Math.max(0,Number(bankrollInput.replace(/,/g,""))||0);
  const baseBet=Math.max(1,Number(baseInput.replace(/,/g,""))||1);
  const [balanceDelta,setBalanceDelta]=useState(0);
  const [strategy,setStrategy]=useState<Strategy>("平注");
  const [strategyStep,setStrategyStep]=useState(0);
  const [labSeq,setLabSeq]=useState([1,2,3,4]);
  const [pending,setPending]=useState<PendingBet|null>(null);
  const [history,setHistory]=useState<BetHistory[]>([]);
  const [peak,setPeak]=useState(startingBankroll);
  const [maxDrawdown,setMaxDrawdown]=useState(0);
  const currentBankroll=startingBankroll+balanceDelta;
  const rawNext=calcStrategyAmount(strategy,baseBet,strategyStep,labSeq);
  const nextBet=Math.max(0,Math.min(rawNext,Math.max(0,currentBankroll)));
  const tableSignature=`${table?.shoe??""}|${table?.round??0}|${table?.results.length??0}|${latest??""}`;
  const wins=history.filter(h=>h.pnl>0).length;
  const losses=history.filter(h=>h.pnl<0).length;
  const pushes=history.filter(h=>h.pnl===0).length;
  const winRate=wins+losses?wins/(wins+losses)*100:0;
  const streak=useMemo(()=>{if(!history.length)return 0; const sign=history[0].pnl>0?1:history[0].pnl<0?-1:0; if(!sign)return 0; let n=0; for(const h of history){if((h.pnl>0?1:h.pnl<0?-1:0)!==sign)break;n++;} return n*sign;},[history]);

  useEffect(()=>{
    setPeak(Math.max(startingBankroll,currentBankroll));
    setMaxDrawdown(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[startingBankroll]);

  useEffect(()=>{
    if(!pending || !latest || pending.openSignature===tableSignature) return;
    let pnl=0;
    let outcome:"win"|"loss"|"push"="loss";
    if(pending.side==="和") {
      if(latest==="和"){pnl=pending.amount*8; outcome="win";} else {pnl=-pending.amount; outcome="loss";}
    } else if(latest==="和") {
      pnl=0; outcome="push";
    } else if(pending.side===latest) {
      pnl=pending.side==="莊"?pending.amount*0.95:pending.amount;
      outcome="win";
    } else {
      pnl=-pending.amount; outcome="loss";
    }
    const nextDelta=balanceDelta+pnl;
    const nextBalance=startingBankroll+nextDelta;
    const newPeak=Math.max(peak,nextBalance);
    setPeak(newPeak);
    setMaxDrawdown(Math.max(maxDrawdown,newPeak-nextBalance));
    setBalanceDelta(nextDelta);
    setHistory(h=>[{side:pending.side,result:latest,amount:pending.amount,pnl,at:Date.now()},...h].slice(0,40));
    const state=nextStrategyState(strategy,outcome,strategyStep,labSeq,pending.amount/baseBet);
    setStrategyStep(state.step); setLabSeq(state.lab); setPending(null);
  },[tableSignature]);

  const placeBet=(side:BetSide)=>{
    if(pending || nextBet<=0) return;
    setPending({side,amount:nextBet,openSignature:tableSignature});
  };
  const resetStats=()=>{setBalanceDelta(0);setHistory([]);setStrategyStep(0);setLabSeq([1,2,3,4]);setPending(null);setPeak(startingBankroll);setMaxDrawdown(0)};
  const goPage=(p:number)=>{const x=Math.max(0,Math.min(2,p));setPage(x);(pagesRef.current as any)?.scrollTo?.({x:x*panelWidth,animated:true})};
  if(!open) return null;

  return <View style={[s.floatPanel,{width:panelWidth,right:width<650?12:72,bottom:width<650?82:18}]}>
    <View style={s.floatHeader}>
      <View style={s.floatBrand}><MaterialIcons name="casino" size={14} color="#F5C64A"/><View><Text style={s.floatTitle}>MT 懸浮輔助</Text><Text style={s.floatStatus}>{table?.live?"等待下一把開獎":"等待牌路連線"}</Text></View></View>
      <View style={s.row}><Text style={s.pageIndicator}>{page+1}/3</Text><Pressable onPress={onSync} style={s.iconBtn}><MaterialIcons name="sync" size={15} color="#fff"/></Pressable><Pressable onPress={onToggle} style={s.iconBtn}><MaterialIcons name="close" size={16} color="#fff"/></Pressable></View>
    </View>
    <View style={s.floatRoomRow}>
      <Pressable style={s.roomSelect} onPress={()=>setMenu(!menu)}><Text style={s.roomSelectText}>{selectedId}</Text><MaterialIcons name="keyboard-arrow-down" size={16} color="#B9C9D7"/></Pressable>
      <Text style={s.roomMeta}>Shoe {table?.shoe??"—"} · Round {table?.round??0}</Text>
    </View>
    {menu?<View style={s.floatDropdown}>{tables.map(t=>{const id=t.apiId??`BAG${t.id}`;return <Pressable key={id} style={s.floatDropdownItem} onPress={()=>{onSelect(id);setMenu(false)}}><Text style={s.floatDropdownText}>{id}　{t.name}</Text></Pressable>})}</View>:null}

    <ScrollView ref={pagesRef as any} horizontal pagingEnabled showsHorizontalScrollIndicator={false} scrollEventThrottle={16} onMomentumScrollEnd={(e:any)=>setPage(Math.round(e.nativeEvent.contentOffset.x/panelWidth))}>
      <View style={[s.floatPage,{width:panelWidth}]}>
        <View style={s.decisionRow}>
          <View style={s.decisionCard}><Text style={s.smallLabel}>即時決策</Text><Text style={s.decisionLabel}>最近</Text><View style={s.latestLine}><View style={[s.lightDot,{backgroundColor:latest?resultColor(latest):"#596D7B",shadowColor:latest?resultColor(latest):"#596D7B"}]}/><Text style={[s.latestText,{color:latest?resultColor(latest):"#8799A7"}]}>{latest??"—"}</Text></View></View>
          <View style={s.decisionCard}><Text style={s.smallLabel}>牌型</Text><Text style={s.patternText}>{detectPattern(table?.results??[])}</Text></View>
          <View style={s.decisionCard}><Text style={s.smallLabel}>推薦下注</Text><Text style={s.recommendText}>{pending?`${pending.side} ${money(pending.amount)}`:`下一注 ${money(nextBet)}`}</Text><Text style={s.recommendSub}>{strategy}</Text></View>
        </View>
        <View style={s.aiBox}><Text style={s.aiTag}>AI分析</Text><Text style={s.aiText}>{buildAnalysis(table?.results??[])}</Text></View>
        <View style={s.askBottom}>
          <View style={s.askMini}><Text style={[s.askTitle,{color:"#E9434D"}]}>莊問路</Text>{ask?<AskSymbols p={ask.banker}/>:<Text style={s.emptyText}>—</Text>}</View>
          <View style={s.askMini}><Text style={[s.askTitle,{color:"#3275DF"}]}>閒問路</Text>{ask?<AskSymbols p={ask.player}/>:<Text style={s.emptyText}>—</Text>}</View>
          <Pressable style={s.nextPageBtn} onPress={()=>goPage(1)}><Text style={s.nextPageText}>資金策略 ›</Text></Pressable>
        </View>
      </View>

      <View style={[s.floatPage,{width:panelWidth}]}>
        <View style={s.moneyTopRow}>
          <View style={s.inputCard}><Text style={s.smallLabel}>本金</Text><TextInput value={bankrollInput} onChangeText={setBankrollInput} keyboardType="numeric" style={s.moneyInput}/></View>
          <View style={s.inputCard}><Text style={s.smallLabel}>基本單注</Text><TextInput value={baseInput} onChangeText={setBaseInput} keyboardType="numeric" style={s.moneyInput}/></View>
          <View style={s.currentCard}><Text style={s.smallLabel}>目前本金</Text><Text style={[s.currentMoney,{color:currentBankroll>=startingBankroll?"#5DD399":"#FF767C"}]}>{money(currentBankroll)}</Text></View>
        </View>
        <View style={s.strategyBox}>
          <Text style={s.smallLabel}>配注策略</Text>
          <Pressable style={s.strategySelect} onPress={()=>setStrategyMenu(!strategyMenu)}><Text style={s.strategySelectText}>{strategy}</Text><MaterialIcons name="keyboard-arrow-down" size={17} color="#D7E4EE"/></Pressable>
          {strategyMenu?<View style={s.strategyDropdown}>{(["平注","馬丁","達朗貝爾","Fibonacci","Paroli","1-3-2-6","Labouchere","Oscar's Grind"] as Strategy[]).map(x=><Pressable key={x} style={[s.strategyChip,strategy===x&&s.strategyChipOn]} onPress={()=>{setStrategy(x);setStrategyStep(0);setLabSeq([1,2,3,4]);setStrategyMenu(false)}}><Text style={s.strategyChipText}>{x}</Text></Pressable>)}</View>:null}
          <View style={s.strategyMetrics}><View><Text style={s.metricLabel}>目前階段</Text><Text style={s.metricValue}>第 {strategyStep+1} 階</Text></View><View><Text style={s.metricLabel}>目前注額</Text><Text style={s.metricValue}>{money(pending?.amount??nextBet)}</Text></View><View><Text style={s.metricLabel}>下一注</Text><Text style={s.nextAmount}>{money(nextBet)}</Text></View></View>
          <Text style={s.progressText}>{strategy==="馬丁"?"1 → 2 → 4 → 8 → 16":strategy==="Fibonacci"?"1 → 1 → 2 → 3 → 5 → 8":strategy==="1-3-2-6"?"1 → 3 → 2 → 6":strategy==="Labouchere"?`序列 ${labSeq.join("-")}`:"依輸贏自動調整下一注"}</Text>
        </View>
        <View style={s.pageFooter}><Pressable style={s.pageNavBtn} onPress={()=>goPage(0)}><Text style={s.pageNavText}>‹ 即時輔助</Text></Pressable><Pressable style={s.pageNavBtn} onPress={()=>goPage(2)}><Text style={s.pageNavText}>輸贏統計 ›</Text></Pressable></View>
      </View>

      <View style={[s.floatPage,{width:panelWidth}]}>
        <View style={s.betRow}><View style={{flex:1}}><Text style={s.smallLabel}>本局下注（手動記錄）</Text><View style={s.betBtns}><Pressable disabled={!!pending} style={[s.betBtn,{backgroundColor:"#B8454D"}]} onPress={()=>placeBet("莊")}><Text style={s.betBtnText}>本局莊</Text></Pressable><Pressable disabled={!!pending} style={[s.betBtn,{backgroundColor:"#3269AE"}]} onPress={()=>placeBet("閒")}><Text style={s.betBtnText}>本局閒</Text></Pressable><Pressable disabled={!!pending} style={[s.betBtn,{backgroundColor:"#3E7561"}]} onPress={()=>placeBet("和")}><Text style={s.betBtnText}>和局</Text></Pressable></View></View><View style={s.pendingBox}><Text style={s.smallLabel}>本局金額</Text><Text style={s.pendingAmount}>{money(pending?.amount??nextBet)}</Text><Text style={s.pendingState}>{pending?`等待開獎 · 押${pending.side}`:"可下注"}</Text></View></View>
        <View style={s.statsGrid}>
          <View style={s.statCard}><Text style={s.metricLabel}>目前本金</Text><Text style={s.statValue}>{money(currentBankroll)}</Text></View>
          <View style={s.statCard}><Text style={s.metricLabel}>總損益</Text><Text style={[s.statValue,{color:balanceDelta>=0?"#5DD399":"#FF767C"}]}>{balanceDelta>=0?"+":""}{money(balanceDelta)}</Text></View>
          <View style={s.statCard}><Text style={s.metricLabel}>勝 / 負 / 和</Text><Text style={s.statValue}>{wins} / {losses} / {pushes}</Text></View>
          <View style={s.statCard}><Text style={s.metricLabel}>勝率</Text><Text style={s.statValue}>{winRate.toFixed(1)}%</Text></View>
        </View>
        <View style={s.historyRow}><Text style={s.smallLabel}>最近紀錄</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:5}}>{history.slice(0,6).map((h,i)=><View key={h.at+i} style={s.historyChip}><Text style={[s.historyText,{color:h.pnl>0?"#5DD399":h.pnl<0?"#FF767C":"#A9BBC8"}]}>{h.side} {h.pnl>0?"+":""}{money(h.pnl)}</Text></View>)}{!history.length?<Text style={s.emptyText}>尚無紀錄</Text>:null}</ScrollView></View>
        <View style={s.statFooter}><Text style={s.footerMetric}>{streak>0?`連勝 ${streak}`:streak<0?`連敗 ${Math.abs(streak)}`:"連勝 0"}</Text><Text style={s.footerMetric}>最大回撤 -{money(maxDrawdown)}</Text><Pressable style={s.resetBtn} onPress={resetStats}><Text style={s.resetText}>重置統計</Text></Pressable></View>
        <View style={s.pageFooter}><Pressable style={s.pageNavBtn} onPress={()=>goPage(1)}><Text style={s.pageNavText}>‹ 資金策略</Text></Pressable><Text style={s.liveHint}>LIVE 開獎後自動結算</Text></View>
      </View>
    </ScrollView>
  </View>;
}

function AccessScreen({onAuthenticated}:{onAuthenticated:()=>void}) {
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [showPassword,setShowPassword]=useState(false);
  const [error,setError]=useState("");
  const videoRef=useRef<any>(null);
  const playCount=useRef(0);
  const login=trpc.trackerAccess.login.useMutation({
    onSuccess:r=>r.success?(setError(""),onAuthenticated()):setError("帳號或密碼不正確"),
    onError:()=>setError("登入驗證暫時無法完成，請確認 Render 後端已啟動")
  });
  const submit=()=>{setError("");if(!username.trim()||!password){setError("請輸入帳號與密碼");return}login.mutate({username,password})};
  const bgVideo = Platform.OS === "web" ? createElement("video" as any, {
    ref:videoRef, src:"/poker.mp4", autoPlay:true, muted:true, playsInline:true, preload:"auto",
    onEnded:()=>{playCount.current+=1;if(playCount.current<2&&videoRef.current){videoRef.current.currentTime=0;videoRef.current.play?.();}},
    style:{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover"}
  }) : null;
  return <ScreenContainer edges={["top","left","right","bottom"]} containerClassName="bg-[#020914]" className="bg-[#020914]">
    <View style={s.loginScreen}>{bgVideo}<View style={s.videoShade}/><ScrollView contentContainerStyle={s.loginScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"><View style={s.loginPanel}>
      <View style={s.loginRail}><Text style={s.loginRailText}>MT ASSISTANT · ACCESS</Text><Text style={s.loginVerified}>● 安全驗證</Text></View>
      <View style={s.loginHero}><View style={s.loginMark}><MaterialIcons name="casino" size={28} color="#F5C64A"/></View><View><Text style={s.loginKicker}>REAL-TIME CONTROL ROOM</Text><Text style={s.loginTitle}>即時多桌牌路</Text><Text style={s.loginSub}>安全登入後進入牌路控制台</Text></View></View>
      <View style={s.loginDivider}/><Text style={s.loginInstruction}>請輸入已授權的管理帳號與密碼。</Text>
      <Text style={s.loginLabel}>帳號</Text><TextInput value={username} onChangeText={setUsername} placeholder="輸入帳號" placeholderTextColor="#657D91" style={s.loginInput} autoCapitalize="none" autoCorrect={false}/>
      <Text style={s.loginLabel}>密碼</Text><View style={s.passwordWrap}><TextInput value={password} onChangeText={setPassword} placeholder="輸入密碼" placeholderTextColor="#657D91" secureTextEntry={!showPassword} style={s.passwordInput} autoCapitalize="none" autoCorrect={false} onSubmitEditing={submit}/><Pressable style={s.eyeBtn} onPress={()=>setShowPassword(v=>!v)}><MaterialIcons name={showPassword?"visibility-off":"visibility"} size={18} color="#738DA2"/></Pressable></View>
      <Pressable style={s.loginBtn} onPress={submit} disabled={login.isPending}><MaterialIcons name="verified-user" size={17} color="#fff"/><Text style={s.loginBtnText}>{login.isPending?"驗證中…":"安全登入"}</Text></Pressable>
      {error?<Text style={s.error}>{error}</Text>:null}<Text style={s.loginSafety}>● 登入資訊只用於本次安全驗證。</Text><Pressable onPress={openLineContact}><Text style={s.loginHelp}>ⓘ 需要協助？LINE 聯絡</Text></Pressable>
    </View></ScrollView></View>
  </ScreenContainer>;
}

function ConnectionPanel({visible,onClose,wsUrl,token,setToken,mtUrl,setMtUrl,connected,events,onStart,onStop}:{visible:boolean;onClose:()=>void;wsUrl:string;token:string;setToken:(v:string)=>void;mtUrl:string;setMtUrl:(v:string)=>void;connected:boolean;events:string[];onStart:()=>void;onStop:()=>void}){
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={s.modalBackdrop}><View style={s.connectionPanel}><View style={s.connectionHeader}><Text style={s.connectionTitle}>主頁與 MT 連線設定</Text><Pressable onPress={onClose}><MaterialIcons name="close" size={23} color="#C6D4DE"/></Pressable></View>
    <Text style={s.connectionNotice}>主頁牌路與 MT 平台使用獨立工作階段。設定視窗關閉後 WebSocket 仍會在背景維持連線。</Text>
    <Text style={s.connLabel}>主頁牌路 WebSocket（固定）</Text><View style={s.maskedField}><Text style={s.maskedText}>{wsUrl.replace(/./g,"•")}</Text></View>
    <Text style={s.connLabel}>主頁牌路來源 / Token</Text><TextInput value={token} onChangeText={setToken} secureTextEntry placeholder="貼上登入後含 token 的 MT 完整網址" placeholderTextColor="#6B8192" style={s.connInput}/>
    <Text style={s.connLabel}>MT 平台獨立網址</Text><TextInput value={mtUrl} onChangeText={setMtUrl} placeholder="https://..." placeholderTextColor="#6B8192" autoCapitalize="none" style={s.connInput}/>
    <Pressable onPress={openLineContact}><Text style={s.connHelp}>連線遇到問題？LINE 聯絡</Text></Pressable>
    <View style={s.mappingRow}><Text style={s.mappingTitle}>winner 對應</Text><Text style={s.mappingPill}>winner 1：閒</Text><Text style={s.mappingPill}>winner 2：莊</Text><Text style={s.mappingPill}>winner 3：和</Text></View>
    <View style={s.connBtns}><Pressable style={[s.connBtn,{backgroundColor:"#43596B"}]} onPress={onStart}><Text style={s.connBtnText}>驗證主頁牌路</Text></Pressable><Pressable style={[s.connBtn,{backgroundColor:"#23894E"}]} onPress={onStart}><Text style={s.connBtnText}>開始連線</Text></Pressable><Pressable style={[s.connBtn,{backgroundColor:"#B83C46"}]} onPress={onStop}><Text style={s.connBtnText}>中斷</Text></Pressable><Pressable style={[s.connBtn,{backgroundColor:"#2A79E8"}]} onPress={onClose}><Text style={s.connBtnText}>完成</Text></Pressable></View>
    <Text style={s.syncLine}>同步階段：{connected?"主頁已同步 15 桌":"等待連線"}</Text><Text style={s.logTitle}>即時事件</Text><View style={s.logBox}>{events.slice(0,5).map((e,i)=><Text key={i} style={s.logText}>{e}</Text>)}<Text style={s.logText}>{wsUrl}</Text></View>
  </View></View></Modal>;
}

function eventName(payload:any){return typeof payload?.action==="string"?payload.action:payload?.action?.name??payload?.name??""}
function eventTables(payload:any):any[]|null{const c=[payload?.msg?.tables?.tables,payload?.msg?.tables,payload?.data?.tables?.tables,payload?.data?.tables,payload?.tables?.tables,payload?.tables];return c.find(Array.isArray)??null;}
function extractMtUrlToken(value:string){try{return new URL(value.trim()).searchParams.get("token")?.trim()??""}catch{return""}}

export default function HomeScreen(){
  const {width}=useWindowDimensions();
  const desktop=width>=900;
  const [accessGranted,setAccessGranted]=useState(false);
  const [connectionOpen,setConnectionOpen]=useState(false);
  const [floatingOpen,setFloatingOpen]=useState(false);
  const [assistTableId,setAssistTableId]=useState("BAG01");
  const [connected,setConnected]=useState(false);
  const [token,setToken]=useState("");
  const [mtUrl,setMtUrl]=useState("");
  const [wsUrl]=useState("wss://a1.ofalive99.net/game/ws");
  const [socket,setSocket]=useState<WebSocket|null>(null);
  const [tables,setTables]=useState<TableData[]>(initialTables);
  const [toast,setToast]=useState("");
  const [events,setEvents]=useState<string[]>(["尚未開始安全連線"]);
  const [favorites,setFavorites]=useState<string[]>([]);
  const orbPosition=useRef(new Animated.ValueXY()).current;
  const notify=(x:string)=>{setToast(x);setTimeout(()=>setToast(""),1800)};
  const appendEvent=(x:string)=>setEvents(c=>[`[${new Date().toLocaleTimeString()}] ${x}`,...c].slice(0,8));
  const orbResponder=useMemo(()=>PanResponder.create({onStartShouldSetPanResponder:()=>true,onMoveShouldSetPanResponder:()=>true,onPanResponderGrant:()=>orbPosition.extractOffset(),onPanResponderMove:Animated.event([null,{dx:orbPosition.x,dy:orbPosition.y}],{useNativeDriver:false}),onPanResponderRelease:(_,g)=>{orbPosition.flattenOffset();if(Math.abs(g.dx)<5&&Math.abs(g.dy)<5)setFloatingOpen(v=>!v)}}),[orbPosition]);

  useEffect(()=>()=>socket?.close(),[socket]);
  const startConnection=()=>{
    const authToken=extractMtUrlToken(token);
    if(!authToken){notify("請貼登入後含 token 的 MT 網址");appendEvent("缺少有效 token");return}
    socket?.close(); const ws=new WebSocket(wsUrl); setSocket(ws); let authenticated=false,subscribed=false;
    const requestTables=()=>authenticated&&ws.readyState===WebSocket.OPEN&&ws.send(JSON.stringify({method:"GET",action:{name:"/api/v1/gametype/*/game/*/room/*/tables",data:{gametype_id:3,game_id:1,room_id:1}}}));
    const requestSvg=()=>authenticated&&ws.readyState===WebSocket.OPEN&&ws.send(JSON.stringify({method:"POST",action:{name:"/api/v1/gametype/*/game/*/room/*/tablesvg"}}));
    const subscribe=()=>{if(authenticated&&ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify({method:"GET",action:{name:"/api/v1/gametype/*/game/*/room/*/mulitple_join",data:{table_id:baccaratTableIds.join(",")}}}));subscribed=true;appendEvent("已訂閱 15 桌即時事件")}};
    ws.onopen=()=>{appendEvent("WebSocket 已連線");ws.send(JSON.stringify({method:"POST",action:{name:"/api/v1/authenticate",path:"/api/v1/authenticate"},body:{type:3,token:authToken}}))};
    ws.onmessage=e=>{try{const p=JSON.parse(e.data),name=eventName(p);if(name==="/api/v1/authenticate"){if(Number(p?.err)===0){authenticated=true;setConnected(true);appendEvent("authenticate 成功");requestTables();setTimeout(requestSvg,200);setTimeout(subscribe,400)}else{setConnected(false);appendEvent(`authenticate 失敗 err=${String(p?.err??"?")}`)}return}const src=eventTables(p);if(src&&name.includes("/tables")){setTables(c=>applyLiveTables(c,src.filter(x=>baccaratTableIds.includes(getApiTableId(x)))));appendEvent(`/tables 已同步 ${src.length} 桌`);if(!subscribed)subscribe();return}if(name.includes("/show_win")){setTables(c=>applyLiveShowWin(c,p));appendEvent(`show_win ${String((p?.body??p?.data)?.table_id??"")}`);setTimeout(requestSvg,500);return}if(name.includes("/table/")&&(name.endsWith("/wait")||name.endsWith("/end"))){setTables(c=>applyLiveWait(c,p,baccaratTableIds));return}}catch{appendEvent("收到非 JSON 即時事件")}};
    ws.onerror=()=>{setConnected(false);appendEvent("WebSocket 發生錯誤")};ws.onclose=()=>{setConnected(false);appendEvent("WebSocket 已中斷")};
  };
  const stopConnection=()=>{socket?.close();setSocket(null);setConnected(false);appendEvent("已手動中斷")};
  const syncAssist=()=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({method:"POST",action:{name:"/api/v1/gametype/*/game/*/room/*/tablesvg"}}));else notify("尚未連線")};
  const openMt=(table:TableData)=>{const u=(mtUrl.trim()||token.trim());if(!u){notify("請先在連線設定填入 MT 平台網址");setConnectionOpen(true);return}try{const url=new URL(u);url.searchParams.set("table",table.apiId??`BAG${table.id}`);if(typeof window!=="undefined")window.open(url.toString(),"_blank","noopener,noreferrer");else Linking.openURL(url.toString())}catch{notify("MT 平台網址格式錯誤")}};

  if(!accessGranted)return <AccessScreen onAuthenticated={()=>setAccessGranted(true)}/>;
  return <ScreenContainer edges={["top","left","right","bottom"]} containerClassName="bg-[#080E17]" className="bg-[#080E17]">
    <View style={s.screen}>
      <View style={s.topbar}><View style={s.brandWrap}><View style={s.logoBox}><MaterialIcons name="casino" size={18} color="#F5C64A"/></View><View><Text style={s.kicker}>MT ASSISTANT · LIVE</Text><Text style={s.title}>即時多桌牌路</Text></View></View><View style={s.topActions}><Pressable style={s.liveBtn}><Text style={s.topActionText}>LIVE</Text></Pressable><Pressable style={s.topBtn} onPress={()=>notify("紅色莊、藍色閒、綠色和；下三路依大路推導")}><MaterialIcons name="help-outline" size={15} color="#D8E6F2"/><Text style={s.topActionText}>說明</Text></Pressable><Pressable style={s.topBtn} onPress={()=>setConnectionOpen(true)}><MaterialIcons name="settings" size={15} color="#D8E6F2"/><Text style={s.topActionText}>連線</Text></Pressable></View></View>
      <View style={s.onlyBaccarat}><Pressable style={s.categoryActive}><Text style={s.categoryActiveText}>百家樂</Text></Pressable></View>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.heroSection}><View><Text style={s.heroKicker}>LIVE CONTROL ROOM</Text><Text style={s.heroTitle}>主頁牌路總覽</Text><Text style={s.heroSub}>即時查看桌況、牌路與操作入口。</Text></View><View style={s.heroMetrics}><View style={s.heroMetric}><Text style={s.metricLabel}>連線狀態</Text><Text style={[s.heroMetricValue,{color:connected?"#59D397":"#FF767C"}]}>{connected?"已連線":"未連線"}</Text></View><View style={s.heroMetric}><Text style={s.metricLabel}>可用桌型</Text><Text style={s.heroMetricValue}>15 桌</Text></View></View></View>
        <View style={s.listHead}><View style={s.row}><Text style={s.listTitle}>所有房型</Text><Text style={s.listHint}>即時確認牌路</Text></View><Text style={s.listHint}>歷史牌局・即時更新・荷官同步</Text></View>
        <View style={[s.cardsGrid,desktop&&s.cardsGridDesktop]}>{tables.map(t=><View key={t.apiId} style={desktop?s.cardWrapDesktop:s.cardWrap}><TableCard table={t} favorite={favorites.includes(t.apiId??"")} onFavorite={()=>setFavorites(c=>c.includes(t.apiId??"")?c.filter(x=>x!==(t.apiId??"")):[...c,t.apiId??""])} onAnalysis={()=>notify(`${t.apiId}：${buildAnalysis(t.results)}`)} onMt={()=>openMt(t)}/></View>)}</View>
      </ScrollView>
      <FloatingAssistant open={floatingOpen} onToggle={()=>setFloatingOpen(v=>!v)} tables={tables} selectedId={assistTableId} onSelect={setAssistTableId} onSync={syncAssist}/>
      <Animated.View style={[s.orb,{transform:orbPosition.getTranslateTransform()}]} {...orbResponder.panHandlers}><MaterialIcons name="apps" size={22} color="#fff"/><View style={[s.orbStatus,{backgroundColor:connected?"#36C46B":"#788C9B"}]}/></Animated.View>
      {toast?<View style={s.toast}><Text style={s.toastText}>{toast}</Text></View>:null}
      <ConnectionPanel visible={connectionOpen} onClose={()=>setConnectionOpen(false)} wsUrl={wsUrl} token={token} setToken={setToken} mtUrl={mtUrl} setMtUrl={setMtUrl} connected={connected} events={events} onStart={startConnection} onStop={stopConnection}/>
    </View>
  </ScreenContainer>;
}

const s=StyleSheet.create({
  screen:{flex:1,backgroundColor:"#080E17"},row:{flexDirection:"row",alignItems:"center",gap:7},
  topbar:{minHeight:56,paddingHorizontal:12,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:"#1C3448"},brandWrap:{flexDirection:"row",alignItems:"center",gap:8},logoBox:{width:34,height:34,borderRadius:8,borderWidth:1,borderColor:"#856E31",backgroundColor:"#182535",alignItems:"center",justifyContent:"center"},kicker:{color:"#7890A3",fontSize:8,letterSpacing:1.1},title:{color:"#F2F6F9",fontSize:16,fontWeight:"800"},topActions:{flexDirection:"row",gap:6},topBtn:{height:34,paddingHorizontal:9,borderRadius:7,backgroundColor:"#1B3449",flexDirection:"row",gap:4,alignItems:"center",justifyContent:"center"},liveBtn:{height:34,paddingHorizontal:9,borderRadius:7,backgroundColor:"#1B8A53",alignItems:"center",justifyContent:"center"},topActionText:{color:"#E6F0F7",fontSize:10,fontWeight:"700"},onlyBaccarat:{paddingHorizontal:10,paddingVertical:7,borderBottomWidth:1,borderBottomColor:"#183047"},categoryActive:{backgroundColor:"#328EE4",borderRadius:6,height:34,alignItems:"center",justifyContent:"center"},categoryActiveText:{color:"#fff",fontWeight:"800",fontSize:12},
  content:{padding:10,paddingBottom:90},heroSection:{marginBottom:12,padding:12,borderWidth:1,borderColor:"#1E3B51",backgroundColor:"#0D1824",borderRadius:8,flexDirection:"row",alignItems:"flex-end",justifyContent:"space-between",gap:12,flexWrap:"wrap"},heroKicker:{color:"#70889A",fontSize:8,letterSpacing:1.4},heroTitle:{color:"#F4F8FB",fontSize:20,fontWeight:"900",marginTop:3},heroSub:{color:"#8197A8",fontSize:10,marginTop:3},heroMetrics:{flexDirection:"row",gap:8,minWidth:300},heroMetric:{flex:1,minWidth:130,padding:9,borderRadius:6,borderWidth:1,borderColor:"#233F54",backgroundColor:"#101E2B"},metricLabel:{color:"#8297A8",fontSize:8},heroMetricValue:{color:"#EAF1F6",fontSize:14,fontWeight:"900",marginTop:4},listHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:8},listTitle:{color:"#F2F6F9",fontSize:16,fontWeight:"800"},listHint:{color:"#73899A",fontSize:9},cardsGrid:{width:"100%"},cardsGridDesktop:{flexDirection:"row",flexWrap:"wrap",gap:10},cardWrap:{width:"100%"},cardWrapDesktop:{width:"49.6%"},
  tableCard:{backgroundColor:"#06090E",borderWidth:1,borderColor:"#1B3449",overflow:"hidden",marginBottom:10,aspectRatio:2.88,minHeight:185},tableHead:{height:32,paddingHorizontal:5,backgroundColor:"#05070A",flexDirection:"row",justifyContent:"space-between",alignItems:"center"},tableHeadLeft:{flexDirection:"row",alignItems:"center",gap:5},tableHeadRight:{flexDirection:"row",alignItems:"center",gap:4,flexShrink:1},game:{color:"#fff",fontSize:10,fontWeight:"700"},tableId:{color:"#fff",borderWidth:1,borderColor:"#AEBCC6",paddingHorizontal:8,paddingVertical:2,fontSize:10,fontWeight:"900",minWidth:40,textAlign:"center"},peopleText:{color:"#fff",fontSize:10,fontWeight:"900"},countdown:{color:"#FF5362",borderWidth:1,borderColor:"#D13646",borderRadius:3,minWidth:20,textAlign:"center",fontSize:9,fontWeight:"900"},statMini:{fontSize:9,fontWeight:"900"},actionPurple:{backgroundColor:"#7046C7",borderRadius:4,paddingHorizontal:5,paddingVertical:4},actionGreen:{backgroundColor:"#278B5D",borderRadius:4,paddingHorizontal:5,paddingVertical:4},actionBlue:{backgroundColor:"#1C78B8",borderRadius:4,paddingHorizontal:5,paddingVertical:4},actionText:{color:"#fff",fontSize:7,fontWeight:"900"},tableBody:{flex:1,flexDirection:"row",backgroundColor:"#fff"},dealer:{width:124,backgroundColor:"#F2F0EC",padding:4,justifyContent:"flex-end"},photo:{position:"absolute",top:3,left:3,right:3,height:120,backgroundColor:"#DCE2E6",alignItems:"center",justifyContent:"center",overflow:"hidden",borderRadius:3},photoImg:{width:"100%",height:"100%"},crown:{fontSize:32,color:"#C5A24C"},dealerName:{color:"#fff",backgroundColor:"#873B96",alignSelf:"flex-start",paddingHorizontal:5,paddingVertical:2,fontSize:10,fontWeight:"900"},meta:{color:"#526371",fontSize:7,marginTop:1},
  roadArea:{flex:1,flexDirection:"row",backgroundColor:"#F8FAFC",padding:2,gap:2,minWidth:0},beadPane:{width:132,borderRightWidth:1,borderColor:"#CCD6DE"},beadGrid:{flexDirection:"row",flexWrap:"wrap"},beadCell:{width:"16.666%",aspectRatio:1,borderRightWidth:1,borderBottomWidth:1,borderColor:"#E0E7EC",alignItems:"center",justifyContent:"center"},beadDot:{width:"72%",aspectRatio:1,borderRadius:99},roadStack:{flex:1,minWidth:0},bigGrid:{height:"54%",flexDirection:"row",flexWrap:"wrap",alignContent:"flex-start"},bigCell:{width:"6.666%",height:"16.666%",borderRightWidth:1,borderBottomWidth:1,borderColor:"#DDE4E9",alignItems:"center",justifyContent:"center"},bigMark:{width:"72%",aspectRatio:1,borderRadius:99,borderWidth:1.6,alignItems:"center",justifyContent:"center"},tieNumber:{color:"#28A66D",fontSize:7,fontWeight:"900"},lowerArea:{flex:1,flexDirection:"row",borderTopWidth:1,borderColor:"#CCD6DE"},lowerPane:{width:"33.333%",flexDirection:"row",flexWrap:"wrap",alignContent:"flex-start",borderRightWidth:1,borderColor:"#E0E7EC"},lowerCell:{width:"10%",height:"16.666%",alignItems:"center",justifyContent:"center"},lowerMark:{width:"58%",aspectRatio:1,borderRadius:99,borderWidth:1.2},slash:{width:"65%",height:2,borderRadius:2},
  orb:{position:"absolute",right:16,bottom:24,zIndex:90,width:50,height:50,borderRadius:25,backgroundColor:"#153B59",borderWidth:2,borderColor:"#66A9F1",alignItems:"center",justifyContent:"center",shadowColor:"#000",shadowOpacity:.45,shadowRadius:9,elevation:12},orbStatus:{position:"absolute",right:4,top:4,width:8,height:8,borderRadius:4,borderWidth:1,borderColor:"#fff"},
  floatPanel:{position:"absolute",zIndex:80,height:286,backgroundColor:"rgba(8,25,39,0.95)",borderWidth:1,borderColor:"#426883",borderRadius:7,overflow:"hidden",shadowColor:"#000",shadowOpacity:.45,shadowRadius:12,elevation:11},floatHeader:{height:35,paddingHorizontal:8,flexDirection:"row",alignItems:"center",justifyContent:"space-between",backgroundColor:"rgba(10,37,54,0.98)",borderBottomWidth:1,borderBottomColor:"#2B4E67"},floatBrand:{flexDirection:"row",alignItems:"center",gap:6},floatTitle:{color:"#F0F5F9",fontWeight:"900",fontSize:10},floatStatus:{color:"#6EC391",fontSize:7,marginTop:1},pageIndicator:{color:"#8EA7B8",fontSize:8},iconBtn:{width:24,height:24,borderRadius:4,backgroundColor:"#1C405D",alignItems:"center",justifyContent:"center"},floatRoomRow:{height:34,paddingHorizontal:7,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:"#203F55"},roomSelect:{height:24,minWidth:135,borderWidth:1,borderColor:"#405E72",borderRadius:4,backgroundColor:"#0B1A25",paddingHorizontal:8,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},roomSelectText:{color:"#F0F5F8",fontSize:9,fontWeight:"900"},roomMeta:{color:"#839AAA",fontSize:7},floatDropdown:{position:"absolute",top:68,left:7,right:7,zIndex:120,maxHeight:150,backgroundColor:"#07131C",borderWidth:1,borderColor:"#36566E",borderRadius:5},floatDropdownItem:{padding:7,borderBottomWidth:1,borderBottomColor:"#193247"},floatDropdownText:{color:"#DDE8EF",fontSize:9},floatPage:{height:215,padding:7},decisionRow:{flexDirection:"row",gap:5},decisionCard:{flex:1,minHeight:68,borderWidth:1,borderColor:"#2D5068",borderRadius:4,backgroundColor:"rgba(17,43,60,.62)",padding:7},smallLabel:{color:"#8EA3B3",fontSize:7},decisionLabel:{color:"#CFDAE2",fontSize:8,marginTop:5},latestLine:{flexDirection:"row",alignItems:"center",gap:5,marginTop:2},lightDot:{width:9,height:9,borderRadius:5,shadowOpacity:1,shadowRadius:7,elevation:8},latestText:{fontSize:15,fontWeight:"900"},patternText:{color:"#E5EDF3",fontSize:10,fontWeight:"900",marginTop:11},recommendText:{color:"#FF6469",fontSize:11,fontWeight:"900",marginTop:9},recommendSub:{color:"#8EA4B3",fontSize:7,marginTop:2},aiBox:{marginTop:5,flexDirection:"row",gap:6,borderWidth:1,borderColor:"#2C5069",borderRadius:4,padding:6,backgroundColor:"rgba(10,30,43,.72)"},aiTag:{color:"#CFE0EA",fontSize:8,fontWeight:"900"},aiText:{flex:1,color:"#A9BBC7",fontSize:7,lineHeight:11},askBottom:{flexDirection:"row",gap:5,marginTop:5},askMini:{flex:1,borderRadius:4,backgroundColor:"#102B3C",padding:5},askTitle:{fontSize:7,fontWeight:"900"},askSymbols:{flexDirection:"row",gap:6,marginTop:3},emptyText:{color:"#788E9E",fontSize:8},nextPageBtn:{minWidth:86,borderRadius:4,backgroundColor:"#1D5378",alignItems:"center",justifyContent:"center",paddingHorizontal:8},nextPageText:{color:"#fff",fontSize:8,fontWeight:"900"},
  moneyTopRow:{flexDirection:"row",gap:5},inputCard:{flex:1,backgroundColor:"#102B3C",borderWidth:1,borderColor:"#2F526A",borderRadius:4,padding:6},currentCard:{flex:1,backgroundColor:"#102B3C",borderWidth:1,borderColor:"#2F526A",borderRadius:4,padding:6},moneyInput:{height:25,marginTop:4,borderWidth:1,borderColor:"#405F73",borderRadius:3,backgroundColor:"#081923",paddingHorizontal:6,color:"#fff",fontSize:10},currentMoney:{fontSize:13,fontWeight:"900",marginTop:8},strategyBox:{marginTop:6,borderWidth:1,borderColor:"#2F526A",borderRadius:4,padding:6,backgroundColor:"rgba(14,40,56,.75)"},strategySelect:{marginTop:4,height:27,borderWidth:1,borderColor:"#426178",borderRadius:3,backgroundColor:"#081923",paddingHorizontal:7,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},strategySelectText:{color:"#E6EFF5",fontSize:9,fontWeight:"800"},strategyDropdown:{position:"absolute",left:6,right:6,top:50,zIndex:130,backgroundColor:"#07131C",borderWidth:1,borderColor:"#3C6078",borderRadius:4,flexDirection:"row",flexWrap:"wrap",padding:4,gap:3},strategyChip:{width:"32%",paddingVertical:5,alignItems:"center",backgroundColor:"#122D3F",borderRadius:3},strategyChipOn:{backgroundColor:"#285F88"},strategyChipText:{color:"#D8E5ED",fontSize:7,fontWeight:"800"},strategyMetrics:{flexDirection:"row",justifyContent:"space-between",marginTop:7},metricValue:{color:"#EDF4F8",fontSize:10,fontWeight:"900",marginTop:2},nextAmount:{color:"#5DD399",fontSize:12,fontWeight:"900",marginTop:2},progressText:{marginTop:6,color:"#93A8B6",fontSize:7,textAlign:"center"},pageFooter:{marginTop:"auto",flexDirection:"row",justifyContent:"space-between",alignItems:"center"},pageNavBtn:{paddingHorizontal:8,paddingVertical:5,borderRadius:4,backgroundColor:"#153C57"},pageNavText:{color:"#DDE9F0",fontSize:8,fontWeight:"800"},
  betRow:{flexDirection:"row",gap:6},betBtns:{flexDirection:"row",gap:4,marginTop:5},betBtn:{flex:1,paddingVertical:7,borderRadius:4,alignItems:"center"},betBtnText:{color:"#fff",fontSize:8,fontWeight:"900"},pendingBox:{width:118,borderRadius:4,borderWidth:1,borderColor:"#2D5068",backgroundColor:"#102B3C",padding:6},pendingAmount:{color:"#F3F8FB",fontSize:12,fontWeight:"900",marginTop:4},pendingState:{color:"#6ED399",fontSize:7,marginTop:3},statsGrid:{flexDirection:"row",gap:4,marginTop:6},statCard:{flex:1,borderRadius:4,backgroundColor:"#102B3C",padding:6},statValue:{color:"#EEF4F8",fontSize:10,fontWeight:"900",marginTop:3},historyRow:{marginTop:6,borderRadius:4,backgroundColor:"#0C2230",padding:5},historyChip:{paddingHorizontal:6,paddingVertical:4,backgroundColor:"#122F41",borderRadius:3},historyText:{fontSize:7,fontWeight:"900"},statFooter:{marginTop:5,flexDirection:"row",alignItems:"center",gap:6},footerMetric:{color:"#A5B7C3",fontSize:7},resetBtn:{marginLeft:"auto",backgroundColor:"#63333A",paddingHorizontal:7,paddingVertical:5,borderRadius:4},resetText:{color:"#fff",fontSize:7,fontWeight:"900"},liveHint:{color:"#5CCB92",fontSize:7},
  loginScreen:{flex:1,backgroundColor:"#020914"},videoShade:{...StyleSheet.absoluteFillObject,backgroundColor:"rgba(0,10,20,.44)"},loginScroll:{flexGrow:1,alignItems:"center",justifyContent:"center",padding:18},loginPanel:{width:"100%",maxWidth:510,backgroundColor:"rgba(5,31,44,.72)",borderWidth:1,borderColor:"rgba(72,145,178,.68)",borderRadius:16,padding:20,shadowColor:"#000",shadowOpacity:.48,shadowRadius:22,elevation:14},loginRail:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},loginRailText:{color:"#B7C6D1",fontSize:9,fontWeight:"800",letterSpacing:1.5},loginVerified:{color:"#42D2A0",fontSize:9,fontWeight:"800"},loginHero:{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:15,marginTop:32,marginBottom:26},loginMark:{width:48,height:48,borderWidth:1,borderColor:"#B28C25",borderRadius:10,backgroundColor:"rgba(25,43,54,.75)",alignItems:"center",justifyContent:"center"},loginKicker:{color:"#9DB0BE",fontSize:9,letterSpacing:1.4,fontWeight:"700"},loginTitle:{color:"#F5F8FA",fontSize:25,fontWeight:"900",marginTop:6},loginSub:{color:"#9FB1BE",fontSize:11,marginTop:4},loginDivider:{height:1,backgroundColor:"rgba(70,111,137,.55)",marginBottom:22},loginInstruction:{color:"#A9BAC6",fontSize:11,marginBottom:20},loginLabel:{color:"#C1CED7",fontSize:11,marginBottom:6},loginInput:{height:48,backgroundColor:"rgba(5,22,32,.72)",borderRadius:7,borderWidth:1,borderColor:"#46697D",color:"#fff",paddingHorizontal:13,fontSize:13,marginBottom:15},passwordWrap:{height:48,backgroundColor:"rgba(5,22,32,.72)",borderRadius:7,borderWidth:1,borderColor:"#46697D",flexDirection:"row",alignItems:"center",marginBottom:16},passwordInput:{flex:1,height:"100%",color:"#fff",paddingHorizontal:13,fontSize:13},eyeBtn:{width:42,height:"100%",alignItems:"center",justifyContent:"center"},loginBtn:{height:48,backgroundColor:"#188CF0",borderRadius:7,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:7,shadowColor:"#1688EE",shadowOpacity:.42,shadowRadius:10},loginBtnText:{color:"#fff",fontSize:13,fontWeight:"900"},error:{color:"#FF959C",fontSize:10,textAlign:"center",marginTop:9},loginSafety:{color:"#7F96A6",fontSize:8,textAlign:"center",marginTop:18},loginHelp:{color:"#53BDF1",fontSize:9,fontWeight:"800",textAlign:"center",marginTop:10},
  modalBackdrop:{flex:1,backgroundColor:"rgba(0,0,0,.64)",justifyContent:"center",padding:14},connectionPanel:{width:"100%",maxWidth:590,alignSelf:"center",backgroundColor:"#141E2C",borderWidth:1,borderColor:"#35536B",padding:18,maxHeight:"94%"},connectionHeader:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},connectionTitle:{color:"#F0F5F8",fontSize:18,fontWeight:"500"},connectionNotice:{marginTop:14,backgroundColor:"#0A131D",borderRadius:6,padding:10,color:"#BAC7D0",fontSize:10,lineHeight:15},connLabel:{color:"#CBD5DC",fontSize:10,marginTop:12,marginBottom:5},maskedField:{height:42,borderWidth:1,borderColor:"#38556A",borderRadius:6,backgroundColor:"#08131C",justifyContent:"center",paddingHorizontal:11},maskedText:{color:"#fff",fontSize:12,letterSpacing:1},connInput:{height:42,borderWidth:1,borderColor:"#38556A",borderRadius:6,backgroundColor:"#08131C",color:"#fff",paddingHorizontal:11,fontSize:11},connHelp:{color:"#63BCE8",fontSize:9,fontWeight:"800",marginTop:10},mappingRow:{flexDirection:"row",gap:5,alignItems:"center",flexWrap:"wrap",marginTop:12},mappingTitle:{color:"#D8E1E7",fontSize:9,fontWeight:"900"},mappingPill:{backgroundColor:"#263B4C",borderRadius:4,paddingHorizontal:7,paddingVertical:6,color:"#CBD8E1",fontSize:8},connBtns:{flexDirection:"row",gap:6,flexWrap:"wrap",marginTop:14},connBtn:{borderRadius:5,paddingHorizontal:10,paddingVertical:9},connBtnText:{color:"#fff",fontSize:9,fontWeight:"900"},syncLine:{color:"#A9BAC6",fontSize:9,marginTop:8},logTitle:{color:"#EFF5F8",fontSize:13,fontWeight:"800",marginTop:14,marginBottom:6},logBox:{backgroundColor:"#08131C",borderRadius:5,padding:9,minHeight:100},logText:{color:"#94A9B7",fontSize:8,lineHeight:13},
  toast:{position:"absolute",bottom:78,left:20,right:20,backgroundColor:"#203A4E",borderRadius:8,padding:9,zIndex:100},toastText:{color:"#fff",textAlign:"center",fontSize:10}
});
