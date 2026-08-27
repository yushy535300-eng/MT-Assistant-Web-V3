import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  Modal,
  PanResponder,
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
import { buildAskRoad, buildBeadGrid, buildBigRoad, buildDerivedRoad, buildRoadWindow, type AskRoadPrediction, type RoadMark } from "@/lib/road-render";

type Result = RoadResult;
type Category = "全部" | "百家樂" | "骰寶" | "龍虎" | "牛牛";

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

const categories: Category[] = ["全部", "百家樂", "骰寶", "龍虎", "牛牛"];
const lineContactUrl = "https://line.me/ti/p/HM2rMNvenj";
function openLineContact() {
  if (typeof window !== "undefined") {
    window.open(lineContactUrl, "_blank", "noopener,noreferrer");
    return;
  }
  Linking.openURL(lineContactUrl).catch(() => undefined);
}
const baccaratTableIds = ["BAG01", "BAG02", "BAG03", "BAG03A", "BAG05", "BAG06", "BAG07", "BAG08", "BAG09", "BAG10", "BAG11", "BAG12", "BAG13", "BAG13A", "BAG15"];
const initialTables: TableData[] = baccaratTableIds.map((apiId) => ({
  id: apiId.replace(/^BAG0?/, ""), apiId, game: "百家樂", name: "—", players: "—", roomId: "—", tableBadge: "—", shoe: "—", round: 0,
  banker: 0, player: 0, tie: 0, results: [], trend: "",
}));

const roadLayout = StyleSheet.create({
  body: { minHeight: 138 },
  area: { flex: 1, flexDirection: "row", backgroundColor: "#F8FAFC", padding: 3, gap: 3, minWidth: 0 },
  beadRoad: { width: 126, borderRightWidth: 1, borderColor: "#D2DBE2", padding: 2 },
  beadRoadCompact: { width: 92 },
  beadGrid: { flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start" },
  beadCell: { width: "16.66%", height: 22, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#E0E7EC", alignItems: "center", justifyContent: "center" },
  stack: { flex: 1, minWidth: 0 },
  bigRoad: { flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", height: 82 },
  bigCell: { width: "5.555%", height: 13.66, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#DDE4E9", alignItems: "center", justifyContent: "center" },
  derivedArea: { height: 52, flexDirection: "row", borderTopWidth: 1, borderColor: "#D2DBE2" },
  derivedColumn: { width: "33.33%", height: "100%", flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", borderRightWidth: 1, borderColor: "#E0E7EC" },
  derivedCell: { width: "11.11%", height: 8.5, alignItems: "center", justifyContent: "center" },
  cockroachMark: { width: 9, height: 3, borderRadius: 2 },
  bigMark: { width: 13, height: 13, borderRadius: 7, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  bigMarkText: { fontSize: 7, lineHeight: 8, fontWeight: "900" },
  tieCount: { color: "#35B477", fontSize: 7, fontWeight: "900", textAlign: "center", lineHeight: 10 },
  crown: { color: "#C5A24C", fontSize: 38, lineHeight: 42 },
});

const cardStyles = StyleSheet.create({
  card: { backgroundColor: "#06090E", borderRadius: 2, borderWidth: 1, borderColor: "#1B3449", overflow: "hidden", marginBottom: 12, width: "100%", maxWidth: 900, alignSelf: "center" },
  header: { minHeight: 32, paddingHorizontal: 7, backgroundColor: "#05070A", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  identity: { flexDirection: "row", alignItems: "center", gap: 6 },
  game: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  id: { color: "#FFFFFF", backgroundColor: "#000000", borderWidth: 1, borderColor: "#BBC7D0", minWidth: 50, textAlign: "center", paddingVertical: 3, fontSize: 12, fontWeight: "800" },
  stats: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  body: { flexDirection: "row", minHeight: 154, backgroundColor: "#FFFFFF" },
  dealer: { width: 112, backgroundColor: "#F4F2EE", padding: 5, justifyContent: "flex-end" },
  dealerCompact: { width: 104 },
  portrait: { position: "absolute", top: 4, left: 4, right: 4, height: 112, borderWidth: 1, borderColor: "#B3BEC7", backgroundColor: "#DCE2E6", alignItems: "center", justifyContent: "center" },
  dealerName: { color: "#FFFFFF", backgroundColor: "#8D3D9B", alignSelf: "flex-start", paddingHorizontal: 5, paddingVertical: 2, fontSize: 12, fontWeight: "800" },
  dealerMeta: { color: "#30353A", fontSize: 8, marginTop: 2 },
});

const connectionStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(3,9,17,0.78)", justifyContent: "center" },
  panel: { backgroundColor: "#152232", borderWidth: 1, borderColor: "#36516A", paddingHorizontal: 18, paddingTop: 20, paddingBottom: 10, maxHeight: "94%" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 9 },
  title: { color: "#F1F5F8", fontSize: 20, fontWeight: "500" },
  notice: { backgroundColor: "#0B131D", borderRadius: 7, color: "#C5D0D9", fontSize: 11, lineHeight: 15, padding: 8, marginBottom: 5 },
  label: { color: "#C9D4DD", fontSize: 13, marginTop: 6, marginBottom: 4 },
  fixedField: { backgroundColor: "#0A121B", borderWidth: 1, borderColor: "#385167", borderRadius: 7, height: 40, paddingHorizontal: 12, justifyContent: "center" },
  fixedText: { color: "#E4ECF2", fontSize: 11, letterSpacing: 1 },
  input: { backgroundColor: "#0A121B", borderWidth: 1, borderColor: "#385167", borderRadius: 7, minHeight: 40, paddingHorizontal: 12, color: "#EDF3F7", fontSize: 13 },
  helper: { backgroundColor: "#101B27", color: "#A7B7C4", fontSize: 11, lineHeight: 14, padding: 8, borderRadius: 5, marginTop: 6 },
  lineHelp: { color: "#66C9F1", fontSize: 12, fontWeight: "600", marginTop: 7 },
  winnerRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8, flexWrap: "wrap" },
  winnerLabel: { color: "#D8E1E8", fontSize: 12, fontWeight: "700", marginRight: 1 },
  winnerPill: { backgroundColor: "#263A4D", color: "#CFDBE5", borderRadius: 5, paddingHorizontal: 7, paddingVertical: 6, fontSize: 11 },
  buttonRow: { flexDirection: "row", gap: 6, marginTop: 9, flexWrap: "wrap" },
  button: { borderRadius: 6, paddingHorizontal: 9, paddingVertical: 8 },
  verify: { backgroundColor: "#4A6174" }, start: { backgroundColor: "#219452" }, stop: { backgroundColor: "#B93F46" }, done: { backgroundColor: "#367DE0" },
  buttonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  sync: { color: "#CBD7E0", fontSize: 12, marginTop: 5 },
  eventTitle: { color: "#F0F5F8", fontSize: 15, fontWeight: "600", marginTop: 9, marginBottom: 5 },
  eventBox: { backgroundColor: "#0A121B", borderRadius: 6, padding: 8, gap: 3 },
  eventText: { color: "#B7C5D0", fontSize: 10, lineHeight: 13 },
});

function ResultDot({ result, large = false, compact = false }: { result: Result; large?: boolean; compact?: boolean }) {
  const color = result === "莊" ? "#E9434D" : result === "閒" ? "#3275DF" : "#35B477";
  return (
    <View style={[styles.resultDot, large && styles.resultDotLarge, compact && styles.resultDotCompact, { borderColor: color, backgroundColor: result === "和" ? color : "#F7FAFC" }]}>
      <Text style={[styles.resultDotText, { color: result === "和" ? "#FFFFFF" : color }]}>{result}</Text>
    </View>
  );
}

function RoadGrid({ table }: { table: TableData }) {
  const { width: viewportWidth } = useWindowDimensions();
  const compact = viewportWidth < 600;
  const liveResults = table.live ? table.results : [];
  const beadCells = useMemo(() => buildBeadGrid(liveResults), [liveResults]);
  const bigRoad = useMemo(() => buildBigRoad(liveResults), [liveResults]);
  const derivedRoads = useMemo(() => [buildDerivedRoad(liveResults, 1, false), buildDerivedRoad(liveResults, 2, true), buildDerivedRoad(liveResults, 3, false)], [liveResults]);
  const visibleBigRoad = buildRoadWindow(bigRoad, 18);
  const visibleDerivedRoads = derivedRoads.map((road) => buildRoadWindow(road, 9));
  const markColor = (result: Result) => result === "莊" ? "#E9434D" : result === "閒" ? "#3275DF" : "#35B477";
  return (
    <View style={roadLayout.area}>
      <View style={[roadLayout.beadRoad, compact && roadLayout.beadRoadCompact]}><View style={roadLayout.beadGrid}>{Array.from({ length: 36 }, (_, index) => { const result = beadCells[index]; return <View key={`${table.id}-bead-${index}`} style={roadLayout.beadCell}>{result ? <ResultDot result={result} compact={compact} /> : null}</View>; })}</View></View>
      <View style={roadLayout.stack}>
        <View style={roadLayout.bigRoad}>{Array.from({ length: 108 }, (_, index) => { const mark = visibleBigRoad.find((item) => item.row * 18 + item.col === index); return <View key={`${table.id}-big-${index}`} style={roadLayout.bigCell}>{mark ? <View style={[roadLayout.bigMark, { borderColor: markColor(mark.result) }]}><Text style={[roadLayout.bigMarkText, { color: markColor(mark.result) }]}>{mark.result}</Text>{mark.tieCount ? <Text style={roadLayout.tieCount}>{mark.tieCount}</Text> : null}</View> : null}</View>; })}</View>
        <View style={roadLayout.derivedArea}>{visibleDerivedRoads.map((road, roadIndex) => <View key={`${table.id}-derived-${roadIndex}`} style={roadLayout.derivedColumn}>{Array.from({ length: 54 }, (_, index) => { const mark = road.find((item) => item.row * 9 + item.col === index); const slash = roadIndex === 2; return <View key={`${table.id}-lower-${roadIndex}-${index}`} style={roadLayout.derivedCell}>{mark ? <View style={[slash ? roadLayout.cockroachMark : styles.lowerMark, { borderColor: markColor(mark.result), backgroundColor: mark.filled || slash ? markColor(mark.result) : "transparent" }, slash && { transform: [{ rotate: "-45deg" }] }]} /> : null}</View>; })}</View>)}</View>
      </View>
    </View>
  );
}

function CountdownBadge({ count, updatedAt }: { count?: number; updatedAt?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (count === undefined || count === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [count, updatedAt]);
  const elapsed = updatedAt ? Math.floor((now - updatedAt) / 1000) : 0;
  const remaining = count === undefined || count === null ? "—" : String(Math.max(0, count - elapsed));
  return <Text style={{ color: "#FF5362", borderWidth: 1, borderColor: "#D13646", borderRadius: 4, minWidth: 22, paddingVertical: 2, textAlign: "center", fontSize: 12, fontWeight: "800" }}>{remaining}</Text>;
}

function eventName(payload: any) { return typeof payload?.action === "string" ? payload.action : payload?.action?.name ?? payload?.name ?? ""; }
function eventTables(payload: any): any[] | null {
  const candidates = [payload?.msg?.tables?.tables, payload?.msg?.tables, payload?.data?.tables?.tables, payload?.data?.tables, payload?.tables?.tables, payload?.tables];
  return candidates.find((candidate) => Array.isArray(candidate)) ?? null;
}
function extractMtUrlToken(value: string) {
  try {
    const url = new URL(value.trim());
    return url.searchParams.get("token")?.trim() ?? "";
  } catch {
    return "";
  }
}
function apiTableId(source: any) { return getApiTableId(source); }
function applyTables(current: TableData[], sources: any[]): TableData[] { return applyLiveTables(current, sources); }
function applyShowWin(current: TableData[], payload: any): TableData[] { return applyLiveShowWin(current, payload); }
function applyWait(current: TableData[], payload: any): TableData[] { return applyLiveWait(current, payload, baccaratTableIds); }

function TableCard({ table }: { table: TableData }) {
  const { width: viewportWidth } = useWindowDimensions();
  const compact = viewportWidth < 600;
  return (
    <View style={cardStyles.card}>
      <View style={cardStyles.header}>
        <View style={cardStyles.identity}><Text style={cardStyles.game}>{table.game}</Text><Text style={cardStyles.id}>{table.id}</Text><View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}><MaterialIcons name="person" size={16} color="#FFFFFF" /><Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "800" }}>{table.players}</Text></View><CountdownBadge count={table.countdown} updatedAt={table.countdownUpdatedAt} /></View>
        <Text style={cardStyles.stats}>{table.live ? <><Text style={styles.bankerText}>莊 {table.banker}</Text> <Text style={styles.playerText}> 閒 {table.player}</Text> <Text style={styles.tieText}> 和 {table.tie}</Text></> : <Text style={styles.tieText}>莊 0 閒 0 和 0</Text>}</Text>
      </View>
      <View style={[cardStyles.body, roadLayout.body]}>
        <View style={[cardStyles.dealer, compact && cardStyles.dealerCompact]}><View style={cardStyles.portrait}>{table.live && table.dealerPhoto ? <Image source={{ uri: table.dealerPhoto }} style={styles.dealerImage} resizeMode="cover" /> : <Text style={roadLayout.crown}>♛</Text>}</View><Text style={cardStyles.dealerName}>{table.name}</Text><Text style={cardStyles.dealerMeta}>房間 {table.roomId ?? "—"}</Text><Text style={cardStyles.dealerMeta}>{table.live ? `Shoe ${table.shoe} · 第 ${table.round} 把` : "Shoe — · 第 — 把"}</Text></View>
        <RoadGrid table={table} />
      </View>
    </View>
  );
}

function LegacyConnectionPanel({ visible, onClose, wsUrl, token, setToken, mtUrl, setMtUrl, connected, events, onVerify, onStart, onStop }: { visible: boolean; onClose: () => void; wsUrl: string; token: string; setToken: (value: string) => void; mtUrl: string; setMtUrl: (value: string) => void; connected: boolean; events: string[]; onVerify: () => void; onStart: () => void; onStop: () => void; }) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={connectionStyles.backdrop}><ScrollView style={connectionStyles.panel} contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}><View style={connectionStyles.header}><Text style={connectionStyles.title}>主頁與 MT 連線設定</Text><Pressable onPress={onClose}><MaterialIcons name="close" size={27} color="#C1CED8" /></Pressable></View><Text style={connectionStyles.notice}>主頁牌路與 MT 平台必須使用兩個獨立工作階段。主頁牌路 WebSocket 與來源 Token 會均已固定預設，不可查看與不可編輯；MT iframe 只載入下方獨立平台網址。</Text><Text style={connectionStyles.label}>主頁牌路 WebSocket（固定）</Text><View style={connectionStyles.fixedField}><Text style={connectionStyles.fixedText}>{wsUrl.replace(/./g, "•")}</Text></View><Text style={connectionStyles.label}>主頁牌路來源 / Token（固定）</Text><TextInput value={token} onChangeText={setToken} secureTextEntry placeholder="" placeholderTextColor="#687E90" style={connectionStyles.input} /><Text style={connectionStyles.label}>MT 平台獨立網址</Text><TextInput value={mtUrl} onChangeText={setMtUrl} placeholder="" placeholderTextColor="#687E90" autoCapitalize="none" autoCorrect={false} style={connectionStyles.input} /><Text style={connectionStyles.helper}>主頁兩個欄位只供背景連線使用，不會顯示完整內容，也不能修改。MT 平台網址必須是另一個獨立網站與工作階段，且只保留於目前瀏覽器工作階段。</Text><Text style={connectionStyles.lineHelp}>連線遇到問題？LINE 聯絡</Text><View style={connectionStyles.winnerRow}><Text style={connectionStyles.winnerLabel}>winner 對應</Text><Text style={connectionStyles.winnerPill}>winner 1：閒</Text><Text style={connectionStyles.winnerPill}>winner 2：莊</Text><Text style={connectionStyles.winnerPill}>winner 3：和</Text></View><View style={connectionStyles.buttonRow}><Pressable style={[connectionStyles.button, connectionStyles.verify]} onPress={onVerify}><Text style={connectionStyles.buttonText}>驗證主頁牌路</Text></Pressable><Pressable style={[connectionStyles.button, connectionStyles.start]} onPress={onStart}><Text style={connectionStyles.buttonText}>開始連線</Text></Pressable><Pressable style={[connectionStyles.button, connectionStyles.stop]} onPress={onStop}><Text style={connectionStyles.buttonText}>中斷</Text></Pressable><Pressable style={[connectionStyles.button, connectionStyles.done]} onPress={onClose}><Text style={connectionStyles.buttonText}>完成</Text></Pressable></View><Text style={connectionStyles.sync}>同步階段：主頁已同步 {connected ? "15 桌" : "等待連線"}</Text><Text style={connectionStyles.eventTitle}>即時事件</Text><View style={connectionStyles.eventBox}>{events.slice(0, 4).map((event, index) => <Text key={`${event}-${index}`} style={connectionStyles.eventText}>{event}</Text>)}<Text style={connectionStyles.eventText}>{wsUrl}</Text></View></ScrollView></View></Modal>;
}

function ConnectionPanel(props: { visible: boolean; onClose: () => void; wsUrl: string; token: string; setToken: (value: string) => void; mtUrl: string; setMtUrl: (value: string) => void; connected: boolean; events: string[]; onVerify: () => void; onStart: () => void; onStop: () => void; }) {
  const { visible, onClose, wsUrl, token, setToken, mtUrl, setMtUrl, connected, events, onStart, onStop } = props;
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={connectionStyles.backdrop}><ScrollView style={connectionStyles.panel} contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}><View style={connectionStyles.header}><Text style={connectionStyles.title}>主頁與 MT 連線設定</Text><Pressable onPress={onClose}><MaterialIcons name="close" size={27} color="#C1CED8" /></Pressable></View><Text style={connectionStyles.notice}>先登入 MT 平台，再貼上登入後、網址含 token 參數的完整平台網址。主頁從這個網址取得牌路授權，開始後即時訂閱 15 桌。</Text><Text style={connectionStyles.label}>主頁牌路 WebSocket（固定）</Text><View style={connectionStyles.fixedField}><Text style={connectionStyles.fixedText}>{wsUrl.replace(/./g, "•")}</Text></View><Text style={connectionStyles.label}>主頁牌路來源（登入後 MT 平台網址）</Text><TextInput value={token} onChangeText={setToken} secureTextEntry placeholder="貼上登入後 MT 平台完整網址" placeholderTextColor="#687E90" autoCapitalize="none" autoCorrect={false} style={connectionStyles.input} /><Text style={connectionStyles.label}>MT 平台獨立網址</Text><TextInput value={mtUrl} onChangeText={setMtUrl} placeholder="可留空；需要另一個 MT 平台時填入" placeholderTextColor="#687E90" autoCapitalize="none" autoCorrect={false} style={connectionStyles.input} /><Text style={connectionStyles.helper}>網址中的 token 只在本次瀏覽器工作階段用於 `/authenticate`，不顯示於牌路、事件或懸浮輔助。MT 平台獨立網址留空時，MT 平台按鈕會開啟上方登入後網址。</Text><Text style={connectionStyles.lineHelp}>連線遇到問題？LINE 聯絡</Text><View style={connectionStyles.winnerRow}><Text style={connectionStyles.winnerLabel}>winner 對應</Text><Text style={connectionStyles.winnerPill}>winner 1：閒</Text><Text style={connectionStyles.winnerPill}>winner 2：莊</Text><Text style={connectionStyles.winnerPill}>winner 3：和</Text></View><View style={connectionStyles.buttonRow}><Pressable style={[connectionStyles.button, connectionStyles.verify]} onPress={onStart}><Text style={connectionStyles.buttonText}>驗證主頁牌路</Text></Pressable><Pressable style={[connectionStyles.button, connectionStyles.start]} onPress={onStart}><Text style={connectionStyles.buttonText}>開始連線</Text></Pressable><Pressable style={[connectionStyles.button, connectionStyles.stop]} onPress={onStop}><Text style={connectionStyles.buttonText}>中斷</Text></Pressable><Pressable style={[connectionStyles.button, connectionStyles.done]} onPress={onClose}><Text style={connectionStyles.buttonText}>完成</Text></Pressable></View><Text style={connectionStyles.sync}>同步階段：{connected ? "已授權並訂閱 15 桌" : "等待登入後 MT 平台網址"}</Text><Text style={connectionStyles.eventTitle}>即時事件</Text><View style={connectionStyles.eventBox}>{events.slice(0, 4).map((event, index) => <Text key={`${event}-${index}`} style={connectionStyles.eventText}>{event}</Text>)}<Text style={connectionStyles.eventText}>{wsUrl}</Text></View></ScrollView></View></Modal>;
}

const helperStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(2,8,14,0.44)", justifyContent: "center", padding: 14 }, panel: { backgroundColor: "#0D1A27", borderWidth: 1, borderColor: "#385975", borderRadius: 12, overflow: "hidden" }, header: { minHeight: 48, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#14283B" }, headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 }, grip: { color: "#B8C9D7", fontSize: 19 }, title: { color: "#F0F5F9", fontWeight: "800", fontSize: 13 }, status: { color: "#6FCB96", fontSize: 10 }, sync: { backgroundColor: "#214A70", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 7, flexDirection: "row", gap: 3, alignItems: "center" }, syncText: { color: "#EAF5FF", fontSize: 10, fontWeight: "700" }, tabs: { padding: 6, flexDirection: "row", gap: 5 }, tab: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: "#334D65" }, tabActive: { backgroundColor: "#2B5E91", borderColor: "#5D9FD5" }, tabText: { color: "#9FB3C3", fontSize: 11, fontWeight: "700" }, tabTextActive: { color: "#FFFFFF" }, tableStrip: { backgroundColor: "#08131D", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#1D3448", paddingVertical: 7, paddingHorizontal: 10 }, tableChip: { borderWidth: 1, borderColor: "#314D65", borderRadius: 5, paddingHorizontal: 8, paddingVertical: 5, marginRight: 6 }, tableChipActive: { backgroundColor: "#23496B", borderColor: "#69A5D7" }, tableChipText: { color: "#B8C7D4", fontSize: 10, fontWeight: "700" }, tableChipTextActive: { color: "#FFFFFF" }, meta: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 }, metaText: { color: "#91A6B6", fontSize: 10 }, box: { margin: 10, marginTop: 2, borderWidth: 1, borderColor: "#31516B", borderRadius: 8, padding: 10 }, label: { color: "#94A9B9", fontSize: 10 }, next: { color: "#F3F7FB", fontSize: 15, fontWeight: "800", marginTop: 4 }, cards: { flexDirection: "row", gap: 7, marginTop: 9 }, card: { flex: 1, minHeight: 57, backgroundColor: "#122536", borderRadius: 6, padding: 7 }, cardValue: { color: "#EAF1F6", fontSize: 13, fontWeight: "800", marginTop: 4 }, cardBlue: { color: "#66A9F1", fontSize: 17, fontWeight: "900", marginTop: 1 }, buttonRow: { flexDirection: "row", gap: 5, marginTop: 9 }, recordBanker: { flex: 1, backgroundColor: "#B74B52", borderRadius: 5, paddingVertical: 8, alignItems: "center" }, recordPlayer: { flex: 1, backgroundColor: "#3B70AB", borderRadius: 5, paddingVertical: 8, alignItems: "center" }, recordTie: { flex: 0.65, backgroundColor: "#4B6172", borderRadius: 5, paddingVertical: 8, alignItems: "center" }, buttonText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" }, autoBox: { margin: 10, marginTop: 2, padding: 11, borderWidth: 1, borderColor: "#31516B", borderRadius: 8 }, autoTitle: { color: "#EFF6FA", fontSize: 14, fontWeight: "800" }, autoCopy: { color: "#9CAFBC", fontSize: 11, lineHeight: 16, marginTop: 5 }, monitor: { marginTop: 11, backgroundColor: "#236B4D", borderRadius: 6, paddingVertical: 9, alignItems: "center" }, confirm: { marginTop: 7, backgroundColor: "#7650D8", borderRadius: 6, paddingVertical: 9, alignItems: "center" }
});


const askRoadStyles = StyleSheet.create({
  block: { marginTop: 10, borderTopWidth: 1, borderTopColor: "#26455D", paddingTop: 8 },
  title: { color: "#C8D7E3", fontSize: 10, fontWeight: "800", marginBottom: 5 },
  rows: { flexDirection: "row", gap: 6 },
  row: { flex: 1, backgroundColor: "#102335", borderRadius: 6, padding: 7 },
  label: { color: "#F0F5F9", fontSize: 11, fontWeight: "900" },
  marks: { flexDirection: "row", gap: 6, marginTop: 5 },
  mark: { fontSize: 13, fontWeight: "900" },
  empty: { color: "#6B8294", fontSize: 11, marginTop: 4 },
});

function AskRoadSymbols({ prediction }: { prediction: AskRoadPrediction }) {
  const values = [
    { symbol: "○", color: prediction.bigEye },
    { symbol: "●", color: prediction.small },
    { symbol: "╱", color: prediction.cockroach },
  ];
  if (values.every((item) => item.color === null)) return <Text style={askRoadStyles.empty}>尚未起算</Text>;
  return <View style={askRoadStyles.marks}>{values.map((item, index) => <Text key={`${item.symbol}-${index}`} style={[askRoadStyles.mark, { color: item.color === "莊" ? "#E9434D" : item.color === "閒" ? "#3275DF" : "#667F92" }]}>{item.symbol}</Text>)}</View>;
}

function FloatingAssistant({ visible, onClose, tables, selectedId, onSelect, onSync, onRecord, notify, autoMonitor, setAutoMonitor }: { visible: boolean; onClose: () => void; tables: TableData[]; selectedId: string; onSelect: (value: string) => void; onSync: () => void; onRecord: (result: Result) => void; notify: (text: string) => void; autoMonitor: boolean; setAutoMonitor: (value: boolean) => void; }) {
  const [tab, setTab] = useState<"即時輔助" | "自動監看">("即時輔助");
  const table = tables.find((item) => (item.apiId ?? `BAG${item.id}`) === selectedId) ?? tables[0];
  const hasLive = Boolean(table?.live && table.results.length);
  const latest = hasLive ? table?.results.at(-1) ?? "—" : "—";
  const ask = useMemo(() => hasLive && table ? buildAskRoad(table.results) : null, [hasLive, table]);
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={helperStyles.backdrop}><View style={helperStyles.panel}><View style={helperStyles.header}><View style={helperStyles.headerLeft}><Text style={helperStyles.grip}>⠿</Text><View><Text style={helperStyles.title}>MT 懸浮輔助</Text><Text style={helperStyles.status}>{hasLive ? "已同步真實牌路" : "等待牌路資料"}</Text></View></View><View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}><Pressable style={helperStyles.sync} onPress={onSync}><MaterialIcons name="sync" size={15} color="#FFFFFF" /><Text style={helperStyles.syncText}>同步牌路</Text></Pressable><Pressable onPress={onClose}><MaterialIcons name="close" size={21} color="#DCE7F2" /></Pressable></View></View><View style={helperStyles.tabs}>{(["即時輔助", "自動監看"] as const).map((item) => <Pressable key={item} onPress={() => setTab(item)} style={[helperStyles.tab, tab === item && helperStyles.tabActive]}><Text style={[helperStyles.tabText, tab === item && helperStyles.tabTextActive]}>{item}</Text></Pressable>)}</View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={helperStyles.tableStrip}>{tables.slice(0, 15).map((item) => { const id = item.apiId ?? `BAG${item.id}`; return <Pressable key={id} onPress={() => onSelect(id)} style={[helperStyles.tableChip, id === selectedId && helperStyles.tableChipActive]}><Text style={[helperStyles.tableChipText, id === selectedId && helperStyles.tableChipTextActive]}>{id}</Text></Pressable>; })}</ScrollView><View style={helperStyles.meta}><Text style={helperStyles.metaText}>{hasLive ? table?.apiId ?? `BAG${table?.id ?? "—"}` : "等待桌台資料"}</Text><Text style={helperStyles.metaText}>{hasLive ? `Shoe ${table?.shoe} · Round ${table?.round}` : "尚未收到 /tables"}</Text></View>{tab === "即時輔助" ? <View style={helperStyles.box}><Text style={helperStyles.label}>真實牌路</Text><Text style={helperStyles.next}>最近：{latest}</Text>{ask ? <View style={askRoadStyles.block}><Text style={askRoadStyles.title}>莊問路／閒問路</Text><View style={askRoadStyles.rows}><View style={askRoadStyles.row}><Text style={[askRoadStyles.label, { color: "#E9434D" }]}>莊</Text><AskRoadSymbols prediction={ask.banker} /></View><View style={askRoadStyles.row}><Text style={[askRoadStyles.label, { color: "#3275DF" }]}>閒</Text><AskRoadSymbols prediction={ask.player} /></View></View></View> : <Text style={askRoadStyles.empty}>收到足夠的共用大路資料後才會起算</Text>}<View style={helperStyles.buttonRow}><Pressable style={helperStyles.recordBanker} onPress={() => onRecord("莊")}><Text style={helperStyles.buttonText}>記錄莊</Text></Pressable><Pressable style={helperStyles.recordPlayer} onPress={() => onRecord("閒")}><Text style={helperStyles.buttonText}>記錄閒</Text></Pressable><Pressable style={helperStyles.recordTie} onPress={() => onRecord("和")}><Text style={helperStyles.buttonText}>和</Text></Pressable></View></View> : <View style={helperStyles.autoBox}><Text style={helperStyles.autoTitle}>自動監看</Text><Text style={helperStyles.autoCopy}>{hasLive ? "只依此桌的真實串流更新監看狀態，不會自行下注或發送外部操作。" : "尚未收到此桌即時牌路，無法啟用監看。"}</Text><Pressable style={helperStyles.monitor} onPress={() => hasLive ? setAutoMonitor(!autoMonitor) : notify("請先完成此桌即時牌路同步")}><Text style={helperStyles.buttonText}>{hasLive ? (autoMonitor ? "停止自動監看" : "啟用自動監看") : "等待即時資料"}</Text></Pressable></View>}</View></View></Modal>;
}

const accessStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#08111C", justifyContent: "center", paddingHorizontal: 20 },
  panel: { backgroundColor: "#13202E", borderWidth: 1, borderColor: "#2A4054", borderRadius: 12, padding: 28, shadowColor: "#000", shadowOpacity: 0.42, shadowRadius: 24, elevation: 12 },
  rail: { backgroundColor: "#0E1925", paddingHorizontal: 15, paddingVertical: 11, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  railTitle: { color: "#AAB8C6", fontSize: 9, fontWeight: "800", letterSpacing: 1.4 },
  verified: { color: "#68D6A6", fontSize: 10, fontWeight: "700" },
  hero: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 42 },
  heroCopy: { alignItems: "flex-start" },
  mark: { width: 58, height: 58, borderWidth: 1, borderColor: "#A38132", borderRadius: 13, backgroundColor: "#1B2734", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  kicker: { color: "#8FA9BA", fontSize: 10, letterSpacing: 1.5, fontWeight: "700" },
  title: { color: "#F1F5F8", fontSize: 26, fontWeight: "800", marginTop: 8 },
  subtitle: { color: "#9FB0BE", fontSize: 13, marginTop: 5 },
  accent: { height: 1, backgroundColor: "#315D75", marginTop: 24, width: 62, alignSelf: "flex-start" },
  divider: { height: 1, backgroundColor: "#243646", marginTop: -1 },
  instruction: { color: "#9CADBA", fontSize: 13, lineHeight: 21, textAlign: "center", marginTop: 22, marginBottom: 27 },
  label: { color: "#B2C0CB", fontSize: 12, marginBottom: 7 },
  input: { minHeight: 55, backgroundColor: "#0E1823", borderRadius: 8, borderWidth: 1, borderColor: "#4B687A", color: "#F3F7FA", paddingHorizontal: 14, fontSize: 17, marginBottom: 21 },
  login: { height: 58, backgroundColor: "#2879EC", borderRadius: 8, justifyContent: "center", alignItems: "center", marginTop: 7, shadowColor: "#1D6DD6", shadowOpacity: 0.4, shadowRadius: 14 },
  loginText: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  error: { color: "#FF959C", textAlign: "center", fontSize: 12, marginTop: 12 },
  safety: { color: "#7E95A7", fontSize: 10, textAlign: "center", marginTop: 42 },
  help: { color: "#85CFEF", fontSize: 11, fontWeight: "700", textAlign: "center", marginTop: 17 },
});

function AccessScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [username, setUsername] = useState("Dino0209");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const login = trpc.trackerAccess.login.useMutation({
    onSuccess: (result) => {
      if (result.success) { setError(""); onAuthenticated(); }
      else setError("帳號或密碼不正確");
    },
    onError: () => setError("登入驗證暫時無法完成"),
  });
  const submit = () => {
    setError("");
    if (!username.trim() || !password) { setError("請輸入帳號與密碼"); return; }
    login.mutate({ username, password });
  };
  return <ScreenContainer edges={["top", "left", "right", "bottom"]} containerClassName="bg-[#08111C]" className="bg-[#08111C]"><View style={accessStyles.screen}><View style={accessStyles.panel}><View style={accessStyles.rail}><Text style={accessStyles.railTitle}>MT ASSISTANT · ACCESS</Text><Text style={accessStyles.verified}>● 安全驗證</Text></View><View style={accessStyles.hero}><View style={accessStyles.mark}><MaterialIcons name="casino" size={31} color="#F5C64A" /></View><View style={accessStyles.heroCopy}><Text style={accessStyles.kicker}>REAL-TIME CONTROL ROOM</Text><Text style={accessStyles.title}>即時多桌牌路</Text><Text style={accessStyles.subtitle}>安全登入後進入牌路控制台</Text></View></View><View style={accessStyles.accent} /><View style={accessStyles.divider} /><Text style={accessStyles.instruction}>請輸入已授權的登入資訊以開啟即時牌路與操作面板。</Text><Text style={accessStyles.label}>帳號</Text><TextInput value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} style={accessStyles.input} returnKeyType="next" /><Text style={accessStyles.label}>密碼</Text><TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="輸入密碼" placeholderTextColor="#627789" style={accessStyles.input} returnKeyType="done" onSubmitEditing={submit} /><Pressable style={accessStyles.login} onPress={submit} disabled={login.isPending}><Text style={accessStyles.loginText}>{login.isPending ? "登入驗證中" : "安全登入"}</Text></Pressable>{error ? <Text style={accessStyles.error}>{error}</Text> : null}<Text style={accessStyles.safety}>● 登入資訊僅用於本次安全驗證。</Text><Pressable onPress={openLineContact}><Text style={accessStyles.help}>需要協助？LINE 聯絡</Text></Pressable></View></View></ScreenContainer>;
}

export default function HomeScreen() {
  const [category, setCategory] = useState<Category>("全部");
  const [mode, setMode] = useState<"一般" | "好路">("一般");
  const [accessGranted, setAccessGranted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [floatingOpen, setFloatingOpen] = useState(false);
  const [floatTab, setFloatTab] = useState<"即時輔助" | "自動下注">("即時輔助");
  const [assistTableId, setAssistTableId] = useState("BAG01");
  const [autoMonitor, setAutoMonitor] = useState(false);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState("");
  const [token, setToken] = useState("");
  const [mtToken, setMtToken] = useState("");
  const [mtUrl, setMtUrl] = useState("");
  const [wsUrl, setWsUrl] = useState("wss://a1.ofalive99.net/game/ws");
  const [events, setEvents] = useState<string[]>(["[展示] 尚未開始安全連線"]);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [analysisTable, setAnalysisTable] = useState<TableData | null>(null);
  const [tables, setTables] = useState<TableData[]>(initialTables);
  const filtered = category === "全部" ? tables : tables.filter((table) => table.game === category);
  const assistTable = tables.find((table) => (table.apiId ?? `BAG${table.id}`) === assistTableId) ?? tables[1] ?? tables[0];
  const orbPosition = useRef(new Animated.ValueXY()).current;
  const orbResponder = useMemo(() => PanResponder.create({ onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true, onPanResponderGrant: () => orbPosition.extractOffset(), onPanResponderMove: Animated.event([null, { dx: orbPosition.x, dy: orbPosition.y }], { useNativeDriver: false }), onPanResponderRelease: (_, gesture) => { orbPosition.flattenOffset(); if (Math.abs(gesture.dx) < 5 && Math.abs(gesture.dy) < 5) setFloatingOpen(true); } }), [orbPosition]);

  const notify = (text: string) => { setToast(text); setTimeout(() => setToast(""), 2200); };
  const appendEvent = (text: string) => setEvents((current) => [`[${new Date().toLocaleTimeString()}] ${text}`, ...current].slice(0, 8));
  useEffect(() => () => { socket?.close(); }, [socket]);
  const startConnection = () => {
    if (!wsUrl.trim()) { appendEvent("請輸入 WebSocket 網址"); notify("尚未輸入 WebSocket 網址"); return; }
    if (!(wsUrl.trim().startsWith("ws://") || wsUrl.trim().startsWith("wss://"))) { appendEvent("WebSocket 網址格式錯誤"); notify("網址必須以 ws:// 或 wss:// 開頭"); return; }
    const mtUrlToken = extractMtUrlToken(token);
    if (!mtUrlToken) { appendEvent("請貼登入後且含 token 參數的 MT 平台網址"); notify("請貼登入後 MT 平台完整網址"); return; }
    try {
      socket?.close();
      const next = new WebSocket(wsUrl.trim());
      setSocket(next);
      appendEvent("建立 WebSocket 連線");
      let authenticated = false;
      let subscribed = false;
      const subscribeAllTables = (renewal = false) => {
        if (!authenticated || next.readyState !== WebSocket.OPEN) return;
        next.send(JSON.stringify({ method: "GET", action: { name: "/api/v1/gametype/*/game/*/room/*/mulitple_join", data: { table_id: baccaratTableIds.join(",") } } }));
        subscribed = true;
        appendEvent(renewal ? "已續訂完整15桌 mulitple_join" : "已送出完整15桌 mulitple_join");
      };
      const requestTables = (isKeepAlive = false) => {
        if (authenticated && next.readyState === WebSocket.OPEN) {
          next.send(JSON.stringify({ method: "POST", action: { name: "/api/v1/gametype/*/game/*/room/*/tablesvg" } }));
          if (!isKeepAlive) appendEvent("已請求 /tablesvg 真實牌桌資料");
        }
      };
      const requestInitialHistory = () => {
        if (authenticated && next.readyState === WebSocket.OPEN) {
          next.send(JSON.stringify({ method: "GET", action: { name: "/api/v1/gametype/*/game/*/room/*/tables", data: { gametype_id: 3, game_id: 1, room_id: 1 } } }));
          appendEvent("已請求完整15桌歷史、人數與荷官資料");
        }
      };
      next.onopen = () => { appendEvent("WebSocket 已連線，使用登入後 MT 網址授權驗證"); next.send(JSON.stringify({ method: "POST", action: { name: "/api/v1/authenticate", path: "/api/v1/authenticate" }, body: { type: 3, token: mtUrlToken } })); appendEvent("已送出 /authenticate"); };
      next.onmessage = (message) => {
        try {
          const payload = JSON.parse(message.data);
          const name = eventName(payload);
          if (name === "/api/v1/authenticate") {
            if (Number(payload?.err) === 0) {
              authenticated = true;
              setConnected(true); appendEvent("authenticate 成功，開始載入15桌"); requestInitialHistory(); setTimeout(requestTables, 250);
            } else {
              authenticated = false;
              const errorCode = String(payload?.err ?? "unknown");
              setConnected(false);
              setTables((current) => current.map((table) => ({ ...table, live: false, dealerPhoto: undefined, results: [], banker: 0, player: 0, tie: 0 })));
              appendEvent(errorCode === "21" ? "登入後 MT 網址的牌路授權被拒絕（err=21）" : `authenticate 失敗 err=${errorCode}`);
              notify(errorCode === "21" ? "MT 平台網址授權被拒絕（err=21）" : "MT 平台網址授權驗證失敗");
            }
            return;
          }
          const sourceTables = eventTables(payload);
          if (sourceTables && String(name).includes("/tables")) {
            const baccarat = sourceTables.filter((item) => baccaratTableIds.includes(apiTableId(item)));
            setTables((current) => applyTables(current, baccarat));
            if (!subscribed) {
              subscribeAllTables();
              appendEvent(`/tablesvg 已同步 ${baccarat.length} 桌`);
            } else {
              appendEvent(`/tablesvg 已同步 ${baccarat.length} 桌，維持既有訂閱`);
            }
            return;
          }
          if (String(name).includes("/show_win")) {
            const body = payload?.body ?? payload?.msg ?? payload?.data ?? {};
            setTables((current) => applyShowWin(current, payload));
            appendEvent(`show_win：${String(body?.table_id ?? "未知桌台")} winner ${String(body?.winner ?? "?")} 已更新牌路`);
            setTimeout(requestTables, 650);
            return;
          }
          if (String(name).includes("/mulitple_join") || String(name).includes("/multiple_join")) { appendEvent("mulitple_join 成功，開始接收15桌事件"); return; }
          if (String(name).includes("/table/") && String(name).endsWith("/wait")) { const body = payload?.body ?? payload?.msg ?? payload?.data ?? {}; const tableId = String(body?.table_id ?? ""); if (baccaratTableIds.includes(tableId)) { setTables((current) => applyWait(current, payload)); appendEvent(`桌台 ${tableId} 等待下注／開獎（${String(body?.count ?? "—")}）`); } return; }
          if (String(name).includes("/table/") && String(name).endsWith("/end")) { const body = payload?.body ?? payload?.msg ?? payload?.data ?? {}; const tableId = String(body?.table_id ?? ""); if (baccaratTableIds.includes(tableId)) { setTables((current) => applyWait(current, payload)); appendEvent(`桌台 ${tableId} 本局結束，等待開獎結果`); } return; }
          if (String(name).includes("/member/logout")) { authenticated = false; setConnected(false); appendEvent("伺服器已登出本次牌路工作階段"); return; }
          appendEvent(`收到未處理事件：${name || "unknown"}`);
        } catch { appendEvent("收到非 JSON 即時事件"); }
      };
      next.onerror = () => { authenticated = false; setConnected(false); setTables((current) => current.map((table) => ({ ...table, live: false, dealerPhoto: undefined }))); appendEvent("WebSocket 發生錯誤"); notify("WebSocket 連線錯誤"); };
      next.onclose = () => { authenticated = false; setConnected(false); appendEvent("WebSocket 已中斷"); };
      const heartbeat = setInterval(() => requestTables(true), 5000);
      const subscriptionRenewal = setInterval(() => subscribeAllTables(true), 10000);
      next.addEventListener("close", () => { clearInterval(heartbeat); clearInterval(subscriptionRenewal); });
    } catch { setConnected(false); appendEvent("無法建立 WebSocket"); }
  };
  const stopConnection = () => { socket?.close(); setSocket(null); setConnected(false); setTables((current) => current.map((table) => ({ ...table, live: false, dealerPhoto: undefined }))); appendEvent("已手動中斷"); };
  const openMtPlatform = async () => {
    const platformUrl = mtUrl.trim() || token.trim();
    if (!platformUrl) { notify("請先貼入登入後 MT 平台網址"); setConnectionOpen(true); return; }
    try {
      if (typeof window !== "undefined") {
        window.open(platformUrl, "_blank", "noopener,noreferrer");
        appendEvent("已於新分頁開啟 MT 平台；主頁與懸浮輔助持續保留");
        return;
      }
      await Linking.openURL(platformUrl);
      appendEvent("已開啟 MT 平台工作階段");
    } catch { notify("MT 平台網址格式錯誤"); }
  };
  const syncAssist = () => { if (socket?.readyState === WebSocket.OPEN && connected) { socket.send(JSON.stringify({ method: "POST", action: { name: "/api/v1/gametype/*/game/*/room/*/tablesvg" } })); appendEvent("懸浮輔助已請求同步牌路"); } else notify("尚未取得即時牌路連線"); };
  const recordAssistResult = (result: Result) => { if (!assistTable?.live) { notify("請先取得此桌即時牌路資料"); return; } const selected = assistTable.apiId ?? `BAG${assistTable.id}`; setTables((current) => current.map((table) => { if ((table.apiId ?? `BAG${table.id}`) !== selected) return table; const results = [...table.results, result]; return { ...table, results, banker: results.filter((value) => value === "莊").length, player: results.filter((value) => value === "閒").length, tie: results.filter((value) => value === "和").length, round: table.round + 1, lastUpdated: Date.now() }; })); appendEvent(`懸浮輔助：${selected} 手動記錄${result}`); };
  const action = (kind: string, table: TableData) => {
    if (kind === "MT平台") { openMtPlatform(); return; }
    if (kind === "分析") { setAnalysisTable(table); return; }
    notify(`${table.game} ${table.id}：配注模式目前只做手動記錄，不會自動送單`);
  };

  if (!accessGranted) return <AccessScreen onAuthenticated={() => setAccessGranted(true)} />;

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]} containerClassName="bg-[#080E17]" className="bg-[#080E17]">
      <View style={styles.screen}>
          <View style={styles.topBar}>
          <View style={styles.brandRow}><View style={styles.logo}><MaterialIcons name="casino" size={20} color="#F8C84A" /></View><View><Text style={styles.eyebrow}>MT ASSISTANT · LIVE</Text><Text style={styles.title}>即時多桌牌路</Text></View></View>
          <View style={styles.topActions}><Pressable style={[styles.topButton, styles.connectedButton]} onPress={openLineContact}><Text style={styles.topButtonText}>LINE</Text></Pressable><Pressable style={styles.topButton} onPress={() => notify("牌路說明：紅色莊、藍色閒、綠色和")}><MaterialIcons name="help-outline" size={18} color="#D8E6F2" /><Text style={styles.topButtonText}>說明</Text></Pressable><Pressable style={styles.topButton} onPress={() => setConnectionOpen(true)}><MaterialIcons name="settings" size={18} color="#D8E6F2" /><Text style={styles.topButtonText}>連線</Text></Pressable></View>
        </View>
        <View style={[styles.categoryBar, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>{categories.map((item) => <Pressable key={item} onPress={() => setCategory(item)} style={[styles.categoryButton, { flex: 1, paddingHorizontal: 0, alignItems: "center" }, category === item && styles.categoryActive]}><Text style={[styles.categoryText, category === item && styles.categoryTextActive]}>{item}</Text></Pressable>)}</View>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.listHeader}><View style={styles.brandRow}><Text style={styles.listTitle}>所有房型</Text><Text style={styles.listHint}>即時確認牌路</Text></View><Text style={styles.listHint}>牌路顯示依目前來源更新</Text></View>
          {filtered.map((table) => <TableCard key={table.id} table={table} />)}
        </ScrollView>
        {toast ? <View style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View> : null}
        <Animated.View style={[{ position: "absolute", right: 18, bottom: 28, zIndex: 60 }, { transform: orbPosition.getTranslateTransform() }]} {...orbResponder.panHandlers}><View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: "#153B59", borderWidth: 2, borderColor: "#66A9F1", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 10, elevation: 12 }}><MaterialIcons name="apps" size={23} color="#E8F2FA" /><View style={{ position: "absolute", right: 5, top: 5, width: 9, height: 9, borderRadius: 5, backgroundColor: "#36C46B", borderWidth: 1, borderColor: "#E8F2FA" }} /></View></Animated.View>
      </View>

      <Modal visible={Boolean(analysisTable)} transparent animationType="slide" onRequestClose={() => setAnalysisTable(null)}><View style={styles.modalBackdrop}><View style={styles.settingsPanel}><View style={styles.modalHeader}><View><Text style={styles.modalKicker}>TABLE ANALYSIS</Text><Text style={styles.modalTitle}>{analysisTable?.game} {analysisTable?.id} 完整分析</Text></View><Pressable onPress={() => setAnalysisTable(null)}><MaterialIcons name="close" size={24} color="#DCE7F2" /></Pressable></View>{analysisTable ? <><View style={styles.analysisSummary}><Text style={styles.metricValue}>房間 {analysisTable.id} · {analysisTable.name}</Text><Text style={styles.logText}>Shoe {analysisTable.shoe} · 第 {analysisTable.round} 把 · 莊 {analysisTable.banker} / 閒 {analysisTable.player} / 和 {analysisTable.tie}</Text></View><RoadGrid table={analysisTable} /><Text style={styles.notice}>大路先依莊／閒結果落柱；和局保留於珠盤並不改變大路。下三路依大路的欄高與走勢差異推導，未接收即時資料時不代表預測。</Text></> : null}<Pressable style={styles.doneButton} onPress={() => setAnalysisTable(null)}><Text style={styles.doneText}>返回牌路</Text></Pressable></View></View></Modal>


      <ConnectionPanel visible={connectionOpen} onClose={() => setConnectionOpen(false)} wsUrl={wsUrl} token={token} setToken={setToken} mtUrl={mtUrl} setMtUrl={setMtUrl} connected={connected} events={events} onVerify={() => { appendEvent(token.trim() ? "牌路 Token 格式已提交，等待伺服器驗證" : "未輸入牌路 Token，略過驗證"); notify(token.trim() ? "已送出牌路驗證" : "請輸入牌路 Token"); }} onStart={startConnection} onStop={stopConnection} />
      <FloatingAssistant visible={floatingOpen} onClose={() => setFloatingOpen(false)} tables={tables} selectedId={assistTable?.apiId ?? "BAG2"} onSelect={setAssistTableId} onSync={syncAssist} onRecord={recordAssistResult} notify={notify} autoMonitor={autoMonitor} setAutoMonitor={setAutoMonitor} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#080E17" }, topBar: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#1C3448" }, brandRow: { flexDirection: "row", alignItems: "center", gap: 9 }, logo: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: "#836D32", backgroundColor: "#182535", alignItems: "center", justifyContent: "center" }, miniLogo: { width: 26, height: 26, borderRadius: 8, backgroundColor: "#182535", alignItems: "center", justifyContent: "center" }, eyebrow: { color: "#7F97AB", fontSize: 9, letterSpacing: 1.2 }, title: { color: "#F3F7FB", fontSize: 17, fontWeight: "700", marginTop: 2 }, topActions: { flexDirection: "row", gap: 6 }, topButton: { paddingHorizontal: 8, height: 34, borderRadius: 8, backgroundColor: "#1D354A", flexDirection: "row", alignItems: "center", gap: 4 }, connectedButton: { backgroundColor: "#207A53" }, topButtonText: { color: "#E4EDF5", fontSize: 11, fontWeight: "600" }, categoryBar: { paddingHorizontal: 12, paddingVertical: 8, gap: 7, borderBottomWidth: 1, borderBottomColor: "#183047" }, categoryButton: { paddingHorizontal: 15, paddingVertical: 10, borderRadius: 8, backgroundColor: "#142335" }, categoryActive: { backgroundColor: "#2F8DE4" }, categoryText: { color: "#AABCCC", fontSize: 13, fontWeight: "600" }, categoryTextActive: { color: "#FFFFFF" }, content: { padding: 14, paddingBottom: 30 }, heroRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14 }, sectionKicker: { color: "#71899D", fontSize: 10, letterSpacing: 1.4 }, sectionTitle: { color: "#F3F7FB", fontSize: 23, fontWeight: "800", marginTop: 4 }, sectionSub: { color: "#8499AA", fontSize: 12, marginTop: 3 }, syncButton: { backgroundColor: "#2F8DE4", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 4 }, syncSmall: { backgroundColor: "#2F8DE4", borderRadius: 7, paddingHorizontal: 8, paddingVertical: 7, flexDirection: "row", alignItems: "center", gap: 3 }, syncText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" }, metrics: { flexDirection: "row", gap: 8, marginBottom: 18 }, metricCard: { flex: 1, borderRadius: 10, padding: 11, backgroundColor: "#101D2A", borderWidth: 1, borderColor: "#234056" }, metricLabel: { color: "#7790A4", fontSize: 10 }, metricValue: { color: "#F3F7FB", fontSize: 16, fontWeight: "800", marginTop: 5 }, listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }, listTitle: { color: "#F3F7FB", fontSize: 18, fontWeight: "800" }, listHint: { color: "#7C92A5", fontSize: 11, marginTop: 2 }, modeSwitch: { flexDirection: "row", backgroundColor: "#142335", borderRadius: 18, padding: 3 }, modeButton: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 15 }, modeActive: { backgroundColor: "#F5F0DF" }, modeText: { color: "#9EB1C0", fontSize: 11, fontWeight: "700" }, modeTextActive: { color: "#172637" }, tableCard: { backgroundColor: "#0F1D2A", borderRadius: 10, borderWidth: 1, borderColor: "#23465B", overflow: "hidden", marginBottom: 12 }, tableHeader: { backgroundColor: "#132638", paddingHorizontal: 8, paddingVertical: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, tableIdentity: { flexDirection: "row", alignItems: "center", gap: 6 }, gameTag: { color: "#DDE8F1", borderWidth: 1, borderColor: "#8198A8", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 4, fontSize: 11 }, tableId: { color: "#F4C84A", fontWeight: "800", fontSize: 14 }, playerCount: { color: "#C8D7E3", fontSize: 10 }, tableActions: { flexDirection: "row", alignItems: "center", gap: 4 }, statText: { fontSize: 10, marginRight: 2 }, bankerText: { color: "#F06A6F" }, playerText: { color: "#5A99EE" }, tieText: { color: "#58C993" }, actionPurple: { backgroundColor: "#7650D8", borderRadius: 5, paddingHorizontal: 7, paddingVertical: 5 }, actionGreen: { backgroundColor: "#269A6A", borderRadius: 5, paddingHorizontal: 7, paddingVertical: 5 }, actionBlue: { backgroundColor: "#2376C9", borderRadius: 5, paddingHorizontal: 7, paddingVertical: 5 }, actionText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" }, tableBody: { flexDirection: "row", minHeight: 148 }, dealerPanel: { width: 106, backgroundColor: "#F1F4F6", padding: 7, justifyContent: "flex-end" }, dealerPanelCompact: { width: 88 }, dealerPortrait: { position: "absolute", top: 6, left: 8, right: 8, height: 78, backgroundColor: "#D6DEE5", alignItems: "center", justifyContent: "center" }, dealerImage: { width: "100%", height: "100%" }, dealerInitial: { fontSize: 24, color: "#8395A2", fontWeight: "300" }, dealerName: { color: "#FFFFFF", backgroundColor: "#7D328D", alignSelf: "flex-start", paddingHorizontal: 5, paddingVertical: 3, fontSize: 11, fontWeight: "700" }, dealerMeta: { color: "#526371", fontSize: 8, marginTop: 3 }, roadArea: { flex: 1, backgroundColor: "#F8FAFC", flexDirection: "row", padding: 3, gap: 3 }, beadRoad: { width: 126, borderRightWidth: 1, borderColor: "#D2DBE2", padding: 2 }, beadRoadCompact: { width: 92 }, beadGrid: { flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start" }, beadCell: { width: "16.66%", height: 21, alignItems: "center", justifyContent: "center", borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#E0E7EC" }, roadStack: { flex: 1, minWidth: 0 }, resultDot: { width: 17, height: 17, margin: 1, borderRadius: 9, borderWidth: 2, alignItems: "center", justifyContent: "center" }, resultDotLarge: { width: 24, height: 24 }, resultDotCompact: { width: 13, height: 13, borderWidth: 1.5, margin: 0 }, resultDotText: { fontSize: 7, fontWeight: "900" }, bigRoad: { flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", height: 126 }, bigRoadCompact: { height: 126 }, bigCell: { width: "8.33%", height: 21, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#DDE4E9", alignItems: "center", justifyContent: "center" }, hollowMark: { width: 12, height: 12, borderRadius: 8, borderWidth: 2 }, lowerRoadStack: { flexDirection: "column", borderTopWidth: 1, borderColor: "#D2DBE2" }, lowerGrid: { flexDirection: "row", flexWrap: "nowrap", height: 22 }, lowerCell: { width: "2.77%", height: 22, alignItems: "center", justifyContent: "center" }, lowerMark: { width: 8, height: 8, borderRadius: 5, borderWidth: 2, margin: 2 }, floatingLaunch: { marginTop: 4, borderRadius: 9, borderWidth: 1, borderColor: "#2B76AE", backgroundColor: "#12304A", padding: 12, flexDirection: "row", justifyContent: "center", gap: 7 }, floatingLaunchText: { color: "#DCEBF7", fontWeight: "700", fontSize: 12 }, disclaimer: { color: "#617688", fontSize: 10, textAlign: "center", lineHeight: 16, marginTop: 14 }, toast: { position: "absolute", bottom: 18, left: 20, right: 20, backgroundColor: "#203A4E", borderWidth: 1, borderColor: "#3B6C8E", borderRadius: 10, padding: 12 }, toastText: { color: "#ECF5FC", textAlign: "center", fontSize: 12 }, modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.62)", justifyContent: "flex-end" }, settingsPanel: { backgroundColor: "#111C2A", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: "92%" }, modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }, modalKicker: { color: "#7690A5", letterSpacing: 1.4, fontSize: 10 }, modalTitle: { color: "#F5F8FB", fontSize: 22, fontWeight: "800", marginTop: 4 }, notice: { color: "#9BAEBE", backgroundColor: "#0A111A", borderRadius: 8, padding: 12, fontSize: 11, lineHeight: 18, marginBottom: 14 }, inputLabel: { color: "#B7C7D4", fontSize: 12, marginBottom: 6, marginTop: 8 }, readonlyInput: { backgroundColor: "#0A121B", borderWidth: 1, borderColor: "#2A4357", borderRadius: 7, padding: 12 }, inputText: { color: "#DCE6ED", fontSize: 12 }, textInput: { backgroundColor: "#0A121B", borderWidth: 1, borderColor: "#2A4357", borderRadius: 7, padding: 12, color: "#FFFFFF", fontSize: 12 }, connectionButtons: { flexDirection: "row", gap: 7, marginTop: 16 }, verifyButton: { backgroundColor: "#334C60", borderRadius: 7, paddingHorizontal: 9, paddingVertical: 10 }, startButton: { backgroundColor: "#2C9A5C", borderRadius: 7, paddingHorizontal: 9, paddingVertical: 10 }, stopButton: { backgroundColor: "#B63D46", borderRadius: 7, paddingHorizontal: 12, paddingVertical: 10 }, analysisSummary: { backgroundColor: "#0A121B", borderRadius: 8, padding: 12, marginBottom: 10, gap: 5 }, eventTitle: { color: "#E7F0F6", fontSize: 15, fontWeight: "700", marginTop: 18, marginBottom: 7 }, eventLog: { backgroundColor: "#080E17", borderRadius: 8, padding: 12, gap: 7 }, logText: { color: "#8EA6B7", fontSize: 10 }, doneButton: { backgroundColor: "#2F8DE4", borderRadius: 8, padding: 12, alignItems: "center", marginTop: 14 }, doneText: { color: "#FFFFFF", fontWeight: "800" }, floatingBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.48)", justifyContent: "center", padding: 14 }, floatingPanel: { backgroundColor: "#0D1A27", borderWidth: 1, borderColor: "#35546B", borderRadius: 12, padding: 12, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 18, elevation: 10 }, floatingHeader: { flexDirection: "row", alignItems: "center", gap: 7 }, floatingTitle: { color: "#EDF5FA", fontWeight: "800", fontSize: 13 }, livePill: { color: "#73C99D", backgroundColor: "#17372E", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 4, fontSize: 9, marginLeft: 2 }, floatTabs: { flexDirection: "row", gap: 5, marginTop: 12 }, floatTabActive: { flex: 1, textAlign: "center", color: "#F4F8FB", backgroundColor: "#285C8D", borderRadius: 6, padding: 9, fontSize: 11, fontWeight: "700" }, floatTab: { flex: 1, textAlign: "center", color: "#9AAFC0", backgroundColor: "#162939", borderRadius: 6, padding: 9, fontSize: 11 }, roomLine: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#09121C", marginTop: 8, padding: 9, borderRadius: 6 }, roomName: { color: "#E7F0F7", fontSize: 12, fontWeight: "700" }, roomMeta: { color: "#8BA1B2", fontSize: 10 }, decisionBox: { borderWidth: 1, borderColor: "#35546B", borderRadius: 9, padding: 11, marginTop: 8 }, decisionKicker: { color: "#8AA0B2", fontSize: 10 }, nextBet: { color: "#FFFFFF", fontSize: 14, fontWeight: "800", marginTop: 4 }, decisionCards: { flexDirection: "row", gap: 7, marginTop: 9 }, decisionCard: { flex: 1, backgroundColor: "#132536", borderRadius: 7, padding: 9 }, cardLabel: { color: "#7F97A9", fontSize: 9 }, cardValue: { color: "#E2EAF0", fontSize: 13, fontWeight: "800", marginTop: 5 }, cardValueBlue: { color: "#66A9F1", fontSize: 17, fontWeight: "900", marginTop: 3 }, cardHint: { color: "#6C8395", fontSize: 8, marginTop: 2 }, floatButtons: { flexDirection: "row", gap: 5, marginTop: 11, flexWrap: "wrap" }, recordRed: { backgroundColor: "#B54950", borderRadius: 6, padding: 9, flex: 1, minWidth: "28%" }, recordBlue: { backgroundColor: "#376DA9", borderRadius: 6, padding: 9, flex: 1, minWidth: "28%" }, resultRed: { backgroundColor: "#D6424D", borderRadius: 6, padding: 9, flex: 1 }, resultBlue: { backgroundColor: "#2F6DD2", borderRadius: 6, padding: 9, flex: 1 }, resultGreen: { backgroundColor: "#36A975", borderRadius: 6, padding: 9, flex: 1 }
});
