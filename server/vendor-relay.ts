import type { Response } from "express";
import { startVendorBrowserTransport, type VendorBrowserTransport } from "./vendor-chromium";

export type VendorKind = "AB" | "DB";
type Road = "莊" | "閒" | "和";
export type VendorTable = {
  id:string; apiId:string; game:"百家樂"; name:string; players:string;
  countdown?:number; countdownUpdatedAt?:number; roomId?:string; tableBadge?:string;
  shoe:string; round:number; banker:number; player:number; tie:number; results:Road[];
  trend:string; live:boolean; dealerPhoto?:string; streamUrl?:string; lastUpdated:number;
  lastResultKey?:string; poker?:string; category:string;
};
type Sink=Pick<Response,"write">;

const relays=new Map<string,VendorRelay>();
const n=(v:any)=>{const x=Number(v);return Number.isFinite(x)?x:0};
const text=(...v:any[])=>String(v.find(x=>x!==undefined&&x!==null&&String(x).trim())??"").trim();
const count=(results:Road[])=>results.reduce((a,r)=>(a[r]++,a),{"莊":0,"閒":0,"和":0} as Record<Road,number>);

export function abRoad(code:any):Road|null{
  const s=String(code??"");
  if(!/^\d{3}/.test(s))return null;
  const banker=n(s[1]),player=n(s[2]);
  return banker===player?"和":banker>player?"莊":"閒";
}
export function abRank(card:any){
  const s=String(card??""); if(!/^\d{3}$/.test(s))return 0;
  const rank=n(s.slice(1)); return rank>=10?10:rank;
}
export function abPoker(raw:any){
  if(!Array.isArray(raw)||raw.length<2)return undefined;
  const side=(x:any)=>Array.isArray(x)?x.map(abRank).filter(Boolean).slice(0,3).join("-"):"";
  const player=side(raw[0]),banker=side(raw[1]);
  return player||banker?JSON.stringify({player,banker}):undefined;
}
export function abCategory(code:any){
  return ({101:"一般",103:"快速",104:"免佣",110:"保險",111:"VIP"} as any)[n(code)]||"其他";
}
export function abHands(raw:any){
  if(!Array.isArray(raw)||raw.length<2)return null;
  const side=(x:any)=>Array.isArray(x)?x.map(abRank).filter((v)=>v>0).slice(0,3):[];
  const player=side(raw[0]),banker=side(raw[1]);
  if(player.length<2||banker.length<2)return null;
  const point=(cards:number[])=>cards.reduce((s,v)=>s+(v>=10?0:v),0)%10;
  return {player,banker,playerPoint:point(player),bankerPoint:point(banker)};
}
export function abRoadFromCards(raw:any):Road|null{
  const hands=abHands(raw);if(!hands)return null;
  const {player,banker,playerPoint,bankerPoint}=hands;
  if(playerPoint>=8||bankerPoint>=8)return playerPoint===bankerPoint?"和":playerPoint>bankerPoint?"閒":"莊";
  const playerDraw=playerPoint<=5;
  if(playerDraw&&player.length<3)return null;
  const third=playerDraw?(player[2]>=10?0:player[2]):-1;
  let bankerDraw=false;
  if(!playerDraw)bankerDraw=bankerPoint<=5;
  else if(bankerPoint<=2)bankerDraw=true;
  else if(bankerPoint===3)bankerDraw=third!==8;
  else if(bankerPoint===4)bankerDraw=third>=2&&third<=7;
  else if(bankerPoint===5)bankerDraw=third>=4&&third<=7;
  else if(bankerPoint===6)bankerDraw=third===6||third===7;
  if(bankerDraw&&banker.length<3)return null;
  return playerPoint===bankerPoint?"和":playerPoint>bankerPoint?"閒":"莊";
}
export function dbCategory(value:any){const s=String(value??"");if(/終極|ultimate/i.test(s))return"終極";if(/完美|perfect/i.test(s))return"完美";if(/共贏|cowin|co-win/i.test(s))return"共贏";if(/包桌|private/i.test(s))return"包桌";if(/電投|electronic/i.test(s))return"電投";return"一般"}
const DB_BACCARAT_CATEGORIES:Record<number,string>={2002:"極速",2001:"經典",2003:"完美",2004:"共享",2005:"包桌",2038:"電投"};
export function dbBaccaratCategory(gameTypeId:any){return DB_BACCARAT_CATEGORIES[n(gameTypeId)]||""}
export function dbDecodeBeatPlate(encoded:any):Road[]{
  if(typeof encoded!=="string"||!encoded)return[];
  try{
    const bytes=Buffer.from(encoded,"base64");
    const bits=[...bytes].map(v=>v.toString(2).padStart(8,"0")).join("");
    let pointer=0;const take=(size:number)=>{const value=parseInt(bits.slice(pointer,pointer+size),2);pointer+=size;return value};
    take(8);const rows=take(8),columns=take(8),total=rows*columns;
    if(!rows||!columns||total>5000)return[];
    const roads:Road[]=[];
    for(let index=0;index<total&&pointer+5<=bits.length;index++){
      const occupied=take(1);
      if(!occupied){take(4);continue}
      const result=take(2);take(2); // pair bits are not needed by the main-page road.
      if(result===0)roads.push("閒");
      else if(result===1||result===3)roads.push("莊"); // result 3 is banker-six.
      else if(result===2)roads.push("和");
    }
    return roads;
  }catch{return[]}
}

class VendorRelay{
  private clients=new Set<Sink>(); private map=new Map<string,VendorTable>();
  private dbRaw=new Map<string,any>();
  private transport:VendorBrowserTransport|null=null; private status="connecting"; private message="啟動中";
  private pnl:number|null=null; private stopped=false; private lastTouch=Date.now();
  private objectCount=0; private lastLoggedTableCount=0;
  constructor(readonly key:string,readonly kind:VendorKind,readonly gameUrl:string){}
  async start(){
    this.transport=await startVendorBrowserTransport({sessionId:this.key,gameUrl:this.gameUrl,label:this.kind,
      onLog:m=>this.event(m),onObject:o=>this.handle(o),onFailure:m=>this.setStatus("error",m)});
    this.setStatus("connecting",`${this.kind} 已開啟，等待桌台資料`);
    const wait=setTimeout(()=>{if(!this.stopped&&!this.map.size)this.setStatus("error",`${this.kind} 背景頁面已開啟，但 45 秒內未收到可解析的桌台資料`)},45000);
    wait.unref?.();
  }
  subscribe(res:Sink){this.lastTouch=Date.now();this.clients.add(res);this.send(res,"status",{status:this.status,message:this.message});this.send(res,"tables",this.tables());this.send(res,"pnl",this.pnl);return()=>{this.clients.delete(res);this.lastTouch=Date.now()}}
  age(){return this.clients.size?0:Date.now()-this.lastTouch} stop(){this.stopped=true;this.transport?.stop();this.clients.clear();}
  private send(c:Sink,event:string,data:any){try{c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)}catch{}}
  private broadcast(event:string,data:any){for(const c of this.clients)this.send(c,event,data)}
  private event(message:string){console.log(`[Vendor ${this.kind}][${this.key.slice(0,8)}] ${message}`);this.broadcast("event",{message:`${this.kind} ${message}`})}
  private setStatus(status:string,message:string){this.status=status;this.message=message;console.log(`[Vendor ${this.kind}][${this.key.slice(0,8)}] status=${status}｜${message}`);this.broadcast("status",{status,message})}
  private tables(){return [...this.map.values()].sort((a,b)=>a.apiId.localeCompare(b.apiId,undefined,{numeric:true}))}
  private emit(){
    if(!this.map.size)return;
    this.setStatus("connected",`${this.kind} 已同步 ${this.map.size} 桌`);
    this.broadcast("tables",this.tables());
  }
  private handle(root:any){
    if(this.stopped||!root||typeof root!=="object")return;
    this.objectCount++;
    if(this.objectCount===1||this.objectCount===10||this.objectCount===100){
      const keys=Object.keys(root).slice(0,20).join(",");
      this.event(`已收到解密物件 ${this.objectCount} 筆｜keys=${keys||"(array)"}`);
    }
    this.lastTouch=Date.now();
    if(this.kind==="AB")this.handleAb(root);else this.handleDb(root);
    if(this.map.size!==this.lastLoggedTableCount){
      this.lastLoggedTableCount=this.map.size;
      this.event(`真實百家樂桌解析完成｜${this.map.size} 桌`);
    }
  }
  private handleAb(o:any){
    if(n(o?.code)===0&&Array.isArray(o?.data?.C)&&o.data.C.some((x:any)=>x?.JJ!==undefined&&x?.CC)){
      const total=Number(o.data.I??o.data.M);
      if(Number.isFinite(total)){this.pnl=total;this.broadcast("pnl",total)}
    }
    const cmd=String(o?.c||""); const p=o?.p||{};
    if(cmd==="getGameHall"&&Array.isArray(p.D)){
      for(const r of p.D){
        const cat=abCategory(r?.DD);if(cat==="其他")continue;
        const id=text(r?.BB,r?.AA);const roads=(r?.WW3?.[0]||[]).map(abRoad).filter(Boolean) as Road[];const c=count(roads);
        this.map.set(String(r.AA),{id,apiId:id,game:"百家樂",name:text(r?.II,"—"),players:"—",countdown:n(r?.HH?.BB),countdownUpdatedAt:Date.now(),roomId:id,tableBadge:String(r?.AA),shoe:"—",round:n(r?.HH?.CC),banker:c.莊,player:c.閒,tie:c.和,results:roads,trend:"",live:true,streamUrl:r?.Z16?String(r.Z16):undefined,lastUpdated:Date.now(),category:cat});
      }this.emit();return;
    }
    if(cmd==="pushGameStatus"&&Array.isArray(p.A)){
      for(const s of p.A){const prev=this.map.get(String(s.AA));if(!prev)continue;this.map.set(String(s.AA),{...prev,countdown:n(s.BB),countdownUpdatedAt:Date.now(),round:n(s.CC)||prev.round,lastUpdated:Date.now()})}this.emit();return;
    }
    if(cmd==="pushRawCards"){
      const prev=this.map.get(String(p.A));if(!prev)return;
      const poker=abPoker(p.B)||prev.poker;
      const round=n(p.E)||prev.round;
      const outcome=abRoadFromCards(p.B);
      const key=outcome?`${round}:${outcome}`:prev.lastResultKey;
      let results=prev.results,banker=prev.banker,player=prev.player,tie=prev.tie;
      if(outcome&&key!==prev.lastResultKey){
        results=[...prev.results,outcome];
        const c=count(results);banker=c.莊;player=c.閒;tie=c.和;
      }
      this.map.set(String(p.A),{...prev,round,poker,results,banker,player,tie,lastResultKey:key,lastUpdated:Date.now()});
      this.emit();return;
    }
    if(cmd==="pushPayoutInfo"){
      // Current user is the VIP=23 entry. Z is balance, L is this bet's P/L;
      // report endpoint remains authoritative for daily total when available.
      const i=Array.isArray(p.V)?p.V.findIndex((x:any)=>n(x)===23):-1;
      if(i>=0&&Array.isArray(p.L?.[i]))this.broadcast("settlement",{pnl:p.L[i].reduce((a:number,x:any)=>a+n(x),0),tableId:p.D});
    }
  }
  private handleDb(root:any){
    const pnlCandidate=root?.totalWinLoss??root?.todayWinLoss??root?.netWinLoss??root?.data?.totalWinLoss??root?.data?.todayWinLoss??root?.data?.netWinLoss;
    if(pnlCandidate!==undefined&&Number.isFinite(Number(pnlCandidate))){this.pnl=Number(pnlCandidate);this.broadcast("pnl",this.pnl)}
    let changed=false;
    const save=(value:any,forcedId?:string)=>{
      const id=text(forcedId,value?.tableId,value?.table_id);if(!id)return;
      const previousRaw=this.dbRaw.get(id)||{};
      const merged={...previousRaw,...value,tableOnline:{...(previousRaw.tableOnline||{}),...(value?.tableOnline||{})},roadPaper:{...(previousRaw.roadPaper||{}),...(value?.roadPaper||{})}};
      this.dbRaw.set(id,merged);
      const category=dbBaccaratCategory(merged.gameTypeId);if(!category)return;
      const old=this.map.get(id);
      let rr=dbDecodeBeatPlate(merged.roadPaper?.beatPlateRoad);
      if(!rr.length&&Array.isArray(merged.results))rr=merged.results.map((x:any)=>{
        const z=String(x?.result??x?.winner??x?.code??x).toLowerCase();
        if(z.includes("bank")||z==="1"||z==="莊")return"莊";if(z.includes("play")||z==="0"||z==="閒")return"閒";if(z.includes("tie")||z==="2"||z==="和")return"和";return null;
      }).filter(Boolean) as Road[];
      if(!rr.length&&old)rr=old.results;
      const summary=Array.isArray(merged.bootReport?.items)?merged.bootReport.items:[];
      const summaryCount=(point:number,fallback:number)=>n(summary.find((x:any)=>n(x?.betPointId)===point)?.winCount??fallback);
      const counted=count(rr);
      const serverTime=n(merged.serverTime),endTime=n(merged.countdownEndTime);
      const calculatedCountdown=endTime&&serverTime?Math.max(0,Math.ceil((endTime-serverTime)/1000)):0;
      this.map.set(id,{id:`DB-${id}`,apiId:id,game:"百家樂",name:text(merged.dealerName,merged.dealer?.name,old?.name,"—"),players:text(merged.tableOnline?.onlineNumber,merged.onlineCount,old?.players,"—"),countdown:n(calculatedCountdown||merged.countDown||merged.countdown||old?.countdown),countdownUpdatedAt:Date.now(),roomId:id,tableBadge:id,shoe:text(merged.bootNo,merged.shoeId,old?.shoe,"—"),round:n(merged.roundNo??merged.roundId??old?.round),banker:summaryCount(3001,counted.莊),player:summaryCount(3002,counted.閒),tie:summaryCount(3003,counted.和),results:rr,trend:"",live:true,dealerPhoto:text(merged.dealerPic,merged.dealerPicTable,merged.phonePicTable,old?.dealerPhoto)||undefined,lastUpdated:Date.now(),category});
      changed=true;
    };
    const visit=(value:any,depth=0)=>{
      if(value==null||depth>12)return;
      if(typeof value==="string"){
        const trimmed=value.trim();if(!trimmed||!(trimmed.startsWith("{")||trimmed.startsWith("[")))return;
        try{visit(JSON.parse(trimmed),depth+1)}catch{}return;
      }
      if(Array.isArray(value)){for(const item of value.slice(0,3000))visit(item,depth+1);return}
      if(typeof value!=="object")return;
      if(value.gameTableMap&&typeof value.gameTableMap==="object")for(const [id,table] of Object.entries(value.gameTableMap))save(table,id);
      if(value.tableId!=null&&(value.gameTypeId!=null||this.dbRaw.has(String(value.tableId))))save(value);
      for(const child of Object.values(value).slice(0,500))visit(child,depth+1);
    };
    visit(root);if(changed)this.emit();
  }
}

export async function startVendorRelay(sessionId:string,kind:VendorKind,gameUrl:string){
  const key=`${sessionId}:${kind}`;const old=relays.get(key);if(old)return old;
  const relay=new VendorRelay(key,kind,gameUrl);relays.set(key,relay);
  try{await relay.start();return relay}catch(e){relays.delete(key);relay.stop();throw e}
}
export const getVendorRelay=(sessionId:string,kind:VendorKind)=>relays.get(`${sessionId}:${kind}`);
export function stopVendorRelay(sessionId:string,kind?:VendorKind){for(const [k,r] of relays)if(k.startsWith(`${sessionId}:`)&&(!kind||r.kind===kind)){r.stop();relays.delete(k)}}
export function sweepVendorRelays(maxAge=180000){let stopped=0;for(const [k,r]of relays)if(r.age()>maxAge){r.stop();relays.delete(k);stopped++}return stopped}
