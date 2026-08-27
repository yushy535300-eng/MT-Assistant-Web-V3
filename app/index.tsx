import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
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
import { useVideoPlayer, VideoView } from "expo-video";
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
type TableData = {
  id: string; apiId?: string; game: string; name: string; players: string;
  countdown?: number; countdownUpdatedAt?: number; roomId?: string; tableBadge?: string;
  shoe: string; round: number; banker: number; player: number; tie: number;
  results: Result[]; trend: string; live?: boolean; dealerPhoto?: string;
  lastUpdated?: number; lastResultKey?: string;
};

const baccaratTableIds = ["BAG01","BAG02","BAG03","BAG03A","BAG05","BAG06","BAG07","BAG08","BAG09","BAG10","BAG11","BAG12","BAG13","BAG13A","BAG15"];
const initialTables: TableData[] = baccaratTableIds.map((apiId) => ({
  id: apiId.replace(/^BAG0?/, ""), apiId, game: "百家樂", name: "—", players: "—",
  roomId: "—", tableBadge: "—", shoe: "—", round: 0, banker: 0, player: 0, tie: 0,
  results: [], trend: "",
}));
const lineContactUrl = "https://line.me/ti/p/HM2rMNvenj";
const resultColor = (r?: Result) => r === "莊" ? "#E9434D" : r === "閒" ? "#3275DF" : r === "和" ? "#35B477" : "#70889A";

function openLineContact() {
  if (typeof window !== "undefined") window.open(lineContactUrl, "_blank", "noopener,noreferrer");
  else Linking.openURL(lineContactUrl).catch(() => undefined);
}

function detectPattern(results: Result[]) {
  const seq = results.filter((r) => r !== "和");
  if (seq.length < 3) return "資料累積中";
  const tail = seq.slice(-8);
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

function TableCard({table}:{table:TableData}) {
  return <View style={s.tableCard}>
    <View style={s.tableHead}>
      <View style={s.row}><Text style={s.game}>百家樂</Text><Text style={s.tableId}>{table.id}</Text>
        <MaterialIcons name="person" size={13} color="#fff"/><Text style={s.headText}>{table.players}</Text>
        <CountdownBadge count={table.countdown} updatedAt={table.countdownUpdatedAt}/>
      </View>
      <Text style={s.headText}><Text style={{color:"#F06A6F"}}>莊 {table.banker}</Text>　<Text style={{color:"#5A99EE"}}>閒 {table.player}</Text>　<Text style={{color:"#58C993"}}>和 {table.tie}</Text></Text>
    </View>
    <View style={s.tableBody}>
      <View style={s.dealer}>
        <View style={s.photo}>{table.dealerPhoto?<Image source={{uri:table.dealerPhoto}} style={{width:"100%",height:"100%"}}/>:<Text style={s.crown}>♛</Text>}</View>
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

function FloatingAssistant({open,onToggle,tables,selectedId,onSelect,onSync}:{
  open:boolean;onToggle:()=>void;tables:TableData[];selectedId:string;onSelect:(id:string)=>void;onSync:()=>void;
}) {
  const table=tables.find(t=>(t.apiId??`BAG${t.id}`)===selectedId)??tables[0];
  const latest=table?.results.at(-1);
  const ask=useMemo(()=>table?.results.length?buildAskRoad(table.results):null,[table?.results]);
  const [menu,setMenu]=useState(false);
  if(!open) return null;
  return <View style={s.floatPanel}>
    <View style={s.floatHeader}>
      <View><Text style={s.floatTitle}>MT 懸浮輔助</Text><Text style={s.floatStatus}>{table?.live?"● 即時同步":"○ 等待資料"}</Text></View>
      <View style={s.row}><Pressable onPress={onSync} style={s.iconBtn}><MaterialIcons name="sync" size={16} color="#fff"/></Pressable>
      <Pressable onPress={onToggle} style={s.iconBtn}><MaterialIcons name="close" size={16} color="#fff"/></Pressable></View>
    </View>

    <Pressable style={s.selector} onPress={()=>setMenu(!menu)}>
      <View><Text style={s.selectorLabel}>選擇房間</Text><Text style={s.selectorValue}>{selectedId}　{table?.name ?? "—"}</Text></View>
      <MaterialIcons name={menu?"keyboard-arrow-up":"keyboard-arrow-down"} size={21} color="#DCE8F2"/>
    </Pressable>
    {menu?<ScrollView style={s.menu}>{tables.map(t=>{const id=t.apiId??`BAG${t.id}`;return <Pressable key={id} style={s.menuItem} onPress={()=>{onSelect(id);setMenu(false)}}><Text style={s.menuText}>{id}　{t.name}</Text></Pressable>})}</ScrollView>:null}

    <View style={s.floatContent}>
      <View style={s.latestBox}>
        <View style={[s.bulbGlow,{backgroundColor:latest?resultColor(latest):"#526676",shadowColor:latest?resultColor(latest):"#526676"}]}>
          <MaterialIcons name="lightbulb" size={22} color="#fff"/>
        </View>
        <View><Text style={s.smallLabel}>最近</Text><Text style={[s.latestText,{color:latest?resultColor(latest):"#8799A7"}]}>{latest??"—"}</Text></View>
      </View>
      <View style={s.detectBox}><Text style={s.smallLabel}>牌型偵測</Text><Text style={s.detectText}>{detectPattern(table?.results??[])}</Text></View>
      <View style={s.infoBox}><Text style={s.smallLabel}>荷官</Text><Text style={s.infoText}>{table?.name??"—"}</Text><Text style={s.meta}>Shoe {table?.shoe??"—"} · Round {table?.round??0}</Text></View>
    </View>

    {ask?<View style={s.askArea}>
      <View style={s.askBox}><Text style={[s.askTitle,{color:"#E9434D"}]}>莊問路</Text><AskSymbols p={ask.banker}/></View>
      <View style={s.askBox}><Text style={[s.askTitle,{color:"#3275DF"}]}>閒問路</Text><AskSymbols p={ask.player}/></View>
    </View>:null}
  </View>;
}

function AccessScreen({onAuthenticated}:{onAuthenticated:()=>void}) {
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [showPassword,setShowPassword]=useState(false);
  const [error,setError]=useState("");
  const playCount=useRef(0);
  const player=useVideoPlayer(require("../assets/videos/login-bg.mp4"), p=>{
    p.loop=false;
    p.muted=true;
    p.play();
  });

  useEffect(()=>{
    const sub=player.addListener("playToEnd",()=>{
      playCount.current+=1;
      if(playCount.current<2){
        player.currentTime=0;
        player.play();
      }else{
        player.pause();
      }
    });
    return()=>sub.remove();
  },[player]);

  const login=trpc.trackerAccess.login.useMutation({
    onSuccess:r=>r.success?(setError(""),onAuthenticated()):setError("帳號或密碼不正確"),
    onError:()=>setError("登入驗證暫時無法完成")
  });
  const submit=()=>{
    if(!username.trim()||!password){setError("請輸入帳號與密碼");return}
    login.mutate({username:username.trim(),password});
  };

  return <ScreenContainer edges={["top","left","right","bottom"]} containerClassName="bg-[#020A12]" className="bg-[#020A12]">
    <View style={s.loginScreen}>
      <VideoView player={player} style={s.loginVideo} contentFit="cover" nativeControls={false}/>
      <View style={s.loginShade}/>
      <View style={s.loginPanel}>
        <View style={s.loginTopline}>
          <Text style={s.loginTopText}>MT ASSISTANT · ACCESS</Text>
          <Text style={s.loginSafe}>● 安全驗證</Text>
        </View>
        <View style={s.loginBrand}>
          <View style={s.loginIcon}><MaterialIcons name="casino" size={26} color="#F5C64A"/></View>
          <View><Text style={s.loginKicker}>REAL-TIME CONTROL ROOM</Text><Text style={s.loginTitle}>即時多桌牌路</Text><Text style={s.loginSub}>安全登入後進入牌路控制台</Text></View>
        </View>
        <View style={s.loginDivider}/>
        <Text style={s.loginHint}>請輸入管理帳號與密碼。</Text>
        <Text style={s.loginLabel}>帳號</Text>
        <TextInput value={username} onChangeText={setUsername} style={s.loginInput} autoCapitalize="none" autoCorrect={false} placeholder="輸入帳號" placeholderTextColor="#6F8292"/>
        <Text style={s.loginLabel}>密碼</Text>
        <View style={s.passwordWrap}>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry={!showPassword} style={s.passwordInput} placeholder="輸入密碼" placeholderTextColor="#6F8292" onSubmitEditing={submit}/>
          <Pressable onPress={()=>setShowPassword(v=>!v)} style={s.eyeBtn}><MaterialIcons name={showPassword?"visibility-off":"visibility"} size={19} color="#6E8DA5"/></Pressable>
        </View>
        <Pressable style={[s.loginBtn,login.isPending&&{opacity:.65}]} onPress={submit} disabled={login.isPending}>
          <MaterialIcons name="verified-user" size={17} color="#fff"/><Text style={s.loginBtnText}>{login.isPending?"驗證中…":"安全登入"}</Text>
        </Pressable>
        {error?<Text style={s.error}>{error}</Text>:null}
        <Text style={s.loginFoot}>● 密碼僅用於本站登入驗證</Text>
        <Pressable onPress={openLineContact}><Text style={s.loginHelp}>需要協助？LINE 聯絡</Text></Pressable>
      </View>
    </View>
  </ScreenContainer>;
}

function eventName(payload:any){return typeof payload?.action==="string"?payload.action:payload?.action?.name??payload?.name??""}
function eventTables(payload:any):any[]|null{
  const c=[payload?.msg?.tables?.tables,payload?.msg?.tables,payload?.data?.tables?.tables,payload?.data?.tables,payload?.tables?.tables,payload?.tables];
  return c.find(Array.isArray)??null;
}
function extractMtUrlToken(value:string){try{return new URL(value.trim()).searchParams.get("token")?.trim()??""}catch{return""}}

export default function HomeScreen(){
  const {width}=useWindowDimensions();
  const desktop=width>=1000;
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
  const orbPosition=useRef(new Animated.ValueXY()).current;
  const notify=(x:string)=>{setToast(x);setTimeout(()=>setToast(""),1800)};
  const orbResponder=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:()=>true,onMoveShouldSetPanResponder:()=>true,
    onPanResponderGrant:()=>orbPosition.extractOffset(),
    onPanResponderMove:Animated.event([null,{dx:orbPosition.x,dy:orbPosition.y}],{useNativeDriver:false}),
    onPanResponderRelease:(_,g)=>{orbPosition.flattenOffset();if(Math.abs(g.dx)<5&&Math.abs(g.dy)<5)setFloatingOpen(v=>!v)}
  }),[orbPosition]);

  useEffect(()=>()=>socket?.close(),[socket]);

  const startConnection=()=>{
    const authToken=extractMtUrlToken(token);
    if(!authToken){notify("請貼登入後含 token 的 MT 網址");return}
    socket?.close();
    const ws=new WebSocket(wsUrl);setSocket(ws);
    let authenticated=false,subscribed=false;
    const requestTables=()=>authenticated&&ws.readyState===WebSocket.OPEN&&ws.send(JSON.stringify({method:"GET",action:{name:"/api/v1/gametype/*/game/*/room/*/tables",data:{gametype_id:3,game_id:1,room_id:1}}}));
    const requestSvg=()=>authenticated&&ws.readyState===WebSocket.OPEN&&ws.send(JSON.stringify({method:"POST",action:{name:"/api/v1/gametype/*/game/*/room/*/tablesvg"}}));
    const subscribe=()=>{if(authenticated&&ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify({method:"GET",action:{name:"/api/v1/gametype/*/game/*/room/*/mulitple_join",data:{table_id:baccaratTableIds.join(",")}}}));subscribed=true}};
    ws.onopen=()=>ws.send(JSON.stringify({method:"POST",action:{name:"/api/v1/authenticate",path:"/api/v1/authenticate"},body:{type:3,token:authToken}}));
    ws.onmessage=e=>{try{
      const p=JSON.parse(e.data),name=eventName(p);
      if(name==="/api/v1/authenticate"){if(Number(p?.err)===0){authenticated=true;setConnected(true);requestTables();setTimeout(requestSvg,200);setTimeout(subscribe,400)}else setConnected(false);return}
      const src=eventTables(p);
      if(src&&name.includes("/tables")){setTables(c=>applyLiveTables(c,src.filter(x=>baccaratTableIds.includes(getApiTableId(x)))));if(!subscribed)subscribe();return}
      if(name.includes("/show_win")){setTables(c=>applyLiveShowWin(c,p));setTimeout(requestSvg,500);return}
      if(name.includes("/table/")&&(name.endsWith("/wait")||name.endsWith("/end"))){setTables(c=>applyLiveWait(c,p,baccaratTableIds));return}
    }catch{}};
    ws.onerror=()=>setConnected(false);ws.onclose=()=>setConnected(false);
  };
  const stopConnection=()=>{socket?.close();setSocket(null);setConnected(false)};
  const syncAssist=()=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({method:"POST",action:{name:"/api/v1/gametype/*/game/*/room/*/tablesvg"}}));else notify("尚未連線")};

  if(!accessGranted)return <AccessScreen onAuthenticated={()=>setAccessGranted(true)}/>;

  return <ScreenContainer edges={["top","left","right","bottom"]} containerClassName="bg-[#080E17]" className="bg-[#080E17]">
    <View style={s.screen}>
      <View style={s.topbar}><View style={s.row}><MaterialIcons name="casino" size={22} color="#F5C64A"/><View><Text style={s.kicker}>MT ASSISTANT · LIVE</Text><Text style={s.title}>即時多桌牌路</Text></View></View>
        <View style={s.row}><Text style={{color:connected?"#55D797":"#7D91A1",fontSize:11}}>{connected?"● 已連線":"○ 未連線"}</Text><Pressable style={s.topBtn} onPress={()=>setConnectionOpen(v=>!v)}><MaterialIcons name="settings" size={17} color="#fff"/></Pressable></View>
      </View>

      {connectionOpen?<View style={s.connectionBar}>
        <TextInput value={token} onChangeText={setToken} secureTextEntry placeholder="貼上登入後 MT 完整網址" placeholderTextColor="#63798B" style={s.connectionInput}/>
        <TextInput value={mtUrl} onChangeText={setMtUrl} placeholder="MT 平台網址（選填）" placeholderTextColor="#63798B" style={s.connectionInput}/>
        <Pressable style={s.connectBtn} onPress={startConnection}><Text style={s.btnText}>連線</Text></Pressable>
        <Pressable style={s.stopBtn} onPress={stopConnection}><Text style={s.btnText}>中斷</Text></Pressable>
      </View>:null}

      <ScrollView contentContainerStyle={s.content}>
        <View style={s.listHead}><Text style={s.listTitle}>百家樂 · 15 桌</Text><Text style={s.listHint}>歷史牌局 + 即時更新 · 荷官同步</Text></View>
        <View style={[s.cardsGrid,desktop&&s.cardsGridDesktop]}>
          {tables.map(t=><View key={t.apiId} style={desktop?s.cardWrapDesktop:s.cardWrap}><TableCard table={t}/></View>)}
        </View>
      </ScrollView>

      <FloatingAssistant open={floatingOpen} onToggle={()=>setFloatingOpen(v=>!v)} tables={tables} selectedId={assistTableId} onSelect={setAssistTableId} onSync={syncAssist}/>
      <Animated.View style={[s.orb,{transform:orbPosition.getTranslateTransform()}]} {...orbResponder.panHandlers}>
        <MaterialIcons name="apps" size={22} color="#fff"/><View style={[s.orbStatus,{backgroundColor:connected?"#36C46B":"#788C9B"}]}/>
      </Animated.View>
      {toast?<View style={s.toast}><Text style={s.toastText}>{toast}</Text></View>:null}
    </View>
  </ScreenContainer>;
}

const s=StyleSheet.create({
  screen:{flex:1,backgroundColor:"#080E17"},row:{flexDirection:"row",alignItems:"center",gap:7},
  topbar:{minHeight:54,paddingHorizontal:14,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:"#1C3448"},
  kicker:{color:"#7890A3",fontSize:8,letterSpacing:1.1},title:{color:"#F2F6F9",fontSize:16,fontWeight:"800"},
  topBtn:{width:34,height:34,borderRadius:8,backgroundColor:"#1B3449",alignItems:"center",justifyContent:"center"},
  connectionBar:{padding:8,flexDirection:"row",gap:6,backgroundColor:"#101D29",borderBottomWidth:1,borderBottomColor:"#244158",flexWrap:"wrap"},
  connectionInput:{height:36,minWidth:210,flex:1,backgroundColor:"#08131D",borderWidth:1,borderColor:"#355169",borderRadius:6,paddingHorizontal:10,color:"#fff",fontSize:11},
  connectBtn:{height:36,paddingHorizontal:13,backgroundColor:"#238F58",borderRadius:6,justifyContent:"center"},stopBtn:{height:36,paddingHorizontal:13,backgroundColor:"#A63E48",borderRadius:6,justifyContent:"center"},btnText:{color:"#fff",fontWeight:"800",fontSize:11},
  content:{padding:10,paddingBottom:90},listHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:8},listTitle:{color:"#F2F6F9",fontSize:16,fontWeight:"800"},listHint:{color:"#73899A",fontSize:10},
  cardsGrid:{width:"100%"},cardsGridDesktop:{flexDirection:"row",flexWrap:"wrap",gap:10},cardWrap:{width:"100%"},cardWrapDesktop:{width:"49%"},
  tableCard:{backgroundColor:"#06090E",borderWidth:1,borderColor:"#1B3449",overflow:"hidden",marginBottom:10},
  tableHead:{minHeight:30,paddingHorizontal:6,backgroundColor:"#05070A",flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  game:{color:"#fff",fontSize:10,fontWeight:"700"},tableId:{color:"#fff",borderWidth:1,borderColor:"#AEBCC6",paddingHorizontal:6,paddingVertical:2,fontSize:10,fontWeight:"900"},headText:{color:"#fff",fontSize:9,fontWeight:"800"},
  countdown:{color:"#FF5362",borderWidth:1,borderColor:"#D13646",borderRadius:3,minWidth:20,textAlign:"center",fontSize:10,fontWeight:"900"},
  tableBody:{flexDirection:"row",height:128,backgroundColor:"#fff"},dealer:{width:88,backgroundColor:"#F2F0EC",padding:4,justifyContent:"flex-end"},
  photo:{position:"absolute",top:3,left:3,right:3,height:88,backgroundColor:"#DCE2E6",alignItems:"center",justifyContent:"center"},crown:{fontSize:30,color:"#C5A24C"},
  dealerName:{color:"#fff",backgroundColor:"#873B96",alignSelf:"flex-start",paddingHorizontal:4,paddingVertical:1,fontSize:9,fontWeight:"800"},meta:{color:"#526371",fontSize:7,marginTop:1},
  roadArea:{flex:1,flexDirection:"row",backgroundColor:"#F8FAFC",padding:2,gap:2,minWidth:0},beadPane:{width:92,borderRightWidth:1,borderColor:"#CCD6DE"},beadGrid:{flexDirection:"row",flexWrap:"wrap"},
  beadCell:{width:"16.666%",height:20,borderRightWidth:1,borderBottomWidth:1,borderColor:"#E0E7EC",alignItems:"center",justifyContent:"center"},beadDot:{width:12,height:12,borderRadius:6},
  roadStack:{flex:1,minWidth:0},bigGrid:{height:72,flexDirection:"row",flexWrap:"wrap",alignContent:"flex-start"},bigCell:{width:"6.666%",height:12,borderRightWidth:1,borderBottomWidth:1,borderColor:"#DDE4E9",alignItems:"center",justifyContent:"center"},
  bigMark:{width:10,height:10,borderRadius:6,borderWidth:1.5,alignItems:"center",justifyContent:"center"},tieNumber:{color:"#28A66D",fontSize:6,fontWeight:"900"},
  lowerArea:{height:52,flexDirection:"row",borderTopWidth:1,borderColor:"#CCD6DE"},lowerPane:{width:"33.333%",flexDirection:"row",flexWrap:"wrap",alignContent:"flex-start",borderRightWidth:1,borderColor:"#E0E7EC"},
  lowerCell:{width:"10%",height:8.4,alignItems:"center",justifyContent:"center"},lowerMark:{width:6,height:6,borderRadius:4,borderWidth:1.5},slash:{width:7,height:2,borderRadius:2},
  orb:{position:"absolute",right:16,bottom:24,zIndex:90,width:50,height:50,borderRadius:25,backgroundColor:"#153B59",borderWidth:2,borderColor:"#66A9F1",alignItems:"center",justifyContent:"center",shadowColor:"#000",shadowOpacity:.45,shadowRadius:9,elevation:12},
  orbStatus:{position:"absolute",right:4,top:4,width:8,height:8,borderRadius:4,borderWidth:1,borderColor:"#fff"},
  floatPanel:{position:"absolute",right:74,bottom:20,zIndex:80,width:520,maxWidth:"78%",backgroundColor:"#0D1A27",borderWidth:1,borderColor:"#385975",borderRadius:10,overflow:"hidden",shadowColor:"#000",shadowOpacity:.4,shadowRadius:12,elevation:11},
  floatHeader:{height:42,paddingHorizontal:10,flexDirection:"row",alignItems:"center",justifyContent:"space-between",backgroundColor:"#14283B"},floatTitle:{color:"#F0F5F9",fontWeight:"900",fontSize:12},floatStatus:{color:"#65CB94",fontSize:8,marginTop:2},
  iconBtn:{width:28,height:28,borderRadius:5,backgroundColor:"#214A70",alignItems:"center",justifyContent:"center"},
  selector:{margin:7,marginBottom:4,paddingHorizontal:9,height:42,borderWidth:1,borderColor:"#31516B",borderRadius:6,backgroundColor:"#09151F",flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  selectorLabel:{color:"#7890A2",fontSize:8},selectorValue:{color:"#F0F5F8",fontSize:11,fontWeight:"800",marginTop:2},menu:{maxHeight:130,marginHorizontal:7,backgroundColor:"#08131D",borderWidth:1,borderColor:"#31516B",borderRadius:6},menuItem:{padding:9,borderBottomWidth:1,borderBottomColor:"#183247"},menuText:{color:"#D9E5ED",fontSize:10},
  floatContent:{flexDirection:"row",gap:6,padding:7},latestBox:{flex:1,backgroundColor:"#102335",borderRadius:6,padding:8,flexDirection:"row",alignItems:"center",gap:8},bulbGlow:{width:34,height:34,borderRadius:17,alignItems:"center",justifyContent:"center",shadowOpacity:.9,shadowRadius:12,elevation:10},
  smallLabel:{color:"#8EA3B3",fontSize:8},latestText:{fontSize:18,fontWeight:"900",marginTop:1},detectBox:{flex:1.35,backgroundColor:"#102335",borderRadius:6,padding:8},detectText:{color:"#F1F6F9",fontSize:12,fontWeight:"900",marginTop:5},
  infoBox:{flex:1.2,backgroundColor:"#102335",borderRadius:6,padding:8},infoText:{color:"#F1F6F9",fontSize:11,fontWeight:"800",marginTop:4},
  askArea:{flexDirection:"row",gap:6,paddingHorizontal:7,paddingBottom:7},askBox:{flex:1,backgroundColor:"#102335",borderRadius:6,padding:7},askTitle:{fontSize:9,fontWeight:"900"},askSymbols:{flexDirection:"row",gap:8,marginTop:4},
  loginScreen:{flex:1,backgroundColor:"#020A12",alignItems:"center",justifyContent:"center",padding:18,overflow:"hidden"},loginVideo:{...StyleSheet.absoluteFillObject},loginShade:{...StyleSheet.absoluteFillObject,backgroundColor:"rgba(2,10,18,0.42)"},
  loginPanel:{width:"100%",maxWidth:480,backgroundColor:"rgba(7,31,44,0.76)",borderWidth:1,borderColor:"rgba(82,151,177,0.62)",borderRadius:18,padding:22,shadowColor:"#000",shadowOpacity:.4,shadowRadius:20,elevation:14},
  loginTopline:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:26},loginTopText:{color:"#A9BED0",fontSize:9,letterSpacing:1.8,fontWeight:"700"},loginSafe:{color:"#39E0B0",fontSize:9,fontWeight:"800"},
  loginBrand:{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:13,marginBottom:22},loginIcon:{width:46,height:46,borderRadius:12,borderWidth:1,borderColor:"#D5A82F",alignItems:"center",justifyContent:"center",backgroundColor:"rgba(245,198,74,.08)"},loginKicker:{color:"#8DB4CE",fontSize:8,letterSpacing:1.5,fontWeight:"700"},loginTitle:{color:"#F5F8FA",fontSize:24,fontWeight:"900",marginTop:4},loginSub:{color:"#91A7B8",fontSize:10,marginTop:3},
  loginDivider:{height:1,backgroundColor:"rgba(109,157,184,.32)",marginBottom:20},loginHint:{color:"#A7B8C5",fontSize:11,marginBottom:18},loginLabel:{color:"#B9C8D3",fontSize:11,fontWeight:"700",marginBottom:6},
  loginInput:{height:48,backgroundColor:"rgba(2,17,28,.68)",borderRadius:8,borderWidth:1,borderColor:"#385B70",color:"#fff",paddingHorizontal:14,fontSize:14,marginBottom:14},passwordWrap:{height:48,backgroundColor:"rgba(2,17,28,.68)",borderRadius:8,borderWidth:1,borderColor:"#385B70",flexDirection:"row",alignItems:"center",marginBottom:16},passwordInput:{flex:1,height:"100%",color:"#fff",paddingHorizontal:14,fontSize:14},eyeBtn:{width:46,height:"100%",alignItems:"center",justifyContent:"center"},
  loginBtn:{height:50,backgroundColor:"#168CEB",borderRadius:8,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:8,shadowColor:"#168CEB",shadowOpacity:.28,shadowRadius:10,elevation:5},loginBtnText:{color:"#fff",fontSize:14,fontWeight:"900"},error:{color:"#FF959C",fontSize:11,textAlign:"center",marginTop:10},loginFoot:{color:"#71899A",fontSize:9,textAlign:"center",marginTop:18},loginHelp:{color:"#42B9F5",fontSize:10,fontWeight:"800",textAlign:"center",marginTop:10},
  toast:{position:"absolute",bottom:78,left:20,right:20,backgroundColor:"#203A4E",borderRadius:8,padding:9,zIndex:100},toastText:{color:"#fff",textAlign:"center",fontSize:10}
});
