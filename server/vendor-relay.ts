import type { Response } from "express";
import { startVendorBrowserTransport, type VendorBrowserTransport } from "./dg-chromium";

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
export function dbCategory(value:any){const s=String(value??"");if(/終極|ultimate/i.test(s))return"終極";if(/完美|perfect/i.test(s))return"完美";if(/共贏|cowin|co-win/i.test(s))return"共贏";if(/包桌|private/i.test(s))return"包桌";if(/電投|electronic/i.test(s))return"電投";return"一般"}

class VendorRelay{
  private clients=new Set<Sink>(); private map=new Map<string,VendorTable>();
  private transport:VendorBrowserTransport|null=null; private status="connecting"; private message="啟動中";
  private pnl:number|null=null; private stopped=false; private lastTouch=Date.now();
  constructor(readonly key:string,readonly kind:VendorKind,readonly gameUrl:string){}
  async start(){
    this.transport=await startVendorBrowserTransport({sessionId:this.key,gameUrl:this.gameUrl,label:this.kind,
      onLog:m=>this.event(m),onObject:o=>this.handle(o),onFailure:m=>this.setStatus("error",m)});
    this.setStatus("connecting",`${this.kind} 已開啟，等待桌台資料`);
    const wait=setTimeout(()=>{if(!this.stopped&&!this.map.size)this.setStatus("error",`${this.kind} 背景頁面已開啟，但 20 秒內未收到可解析的桌台資料`)},20000);
    wait.unref?.();
  }
  subscribe(res:Sink){this.lastTouch=Date.now();this.clients.add(res);this.send(res,"status",{status:this.status,message:this.message});this.send(res,"tables",this.tables());this.send(res,"pnl",this.pnl);return()=>{this.clients.delete(res);this.lastTouch=Date.now()}}
  age(){return this.clients.size?0:Date.now()-this.lastTouch} stop(){this.stopped=true;this.transport?.stop();this.clients.clear();}
  private send(c:Sink,event:string,data:any){try{c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)}catch{}}
  private broadcast(event:string,data:any){for(const c of this.clients)this.send(c,event,data)}
  private event(message:string){console.log(`[Vendor ${this.kind}][${this.key.slice(0,8)}] ${message}`);this.broadcast("event",{message:`${this.kind} ${message}`})}
  private setStatus(status:string,message:string){this.status=status;this.message=message;console.log(`[Vendor ${this.kind}][${this.key.slice(0,8)}] status=${status}｜${message}`);this.broadcast("status",{status,message})}
  private tables(){return [...this.map.values()].sort((a,b)=>a.apiId.localeCompare(b.apiId,undefined,{numeric:true}))}
  private emit(){this.setStatus("connected",`${this.kind} 已同步 ${this.map.size} 桌`);this.broadcast("tables",this.tables())}
  private handle(root:any){
    if(this.stopped||!root||typeof root!=="object")return;
    this.lastTouch=Date.now();
    if(this.kind==="AB")this.handleAb(root);else this.handleDb(root);
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
      const prev=this.map.get(String(p.A));if(!prev)return;this.map.set(String(p.A),{...prev,round:n(p.E)||prev.round,poker:abPoker(p.B)||prev.poker,lastUpdated:Date.now()});this.emit();return;
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
    const visit=(v:any,depth=0)=>{
      if(!v||typeof v!=="object"||depth>6)return;
      const gameId=n(v.gameId??v.game_id??v.gameType??v.game_type);
      const id=text(v.fms,v.tableCode,v.table_code,v.tableName,v.table_name,v.tableId,v.table_id);
      const roads=v.roads??v.roadmaps??v.roadMap??v.results??v.resultList;
      if(id&&(gameId===1||/^(?:BAC|B|J)\w+/i.test(id))&&Array.isArray(roads)){
        const old=this.map.get(id);const rr=roads.map((x:any)=>{
          const z=String(x?.result??x?.winner??x?.code??x).toLowerCase();
          if(z.includes("bank")||z==="1"||z==="莊")return"莊";if(z.includes("play")||z==="2"||z==="閒")return"閒";if(z.includes("tie")||z==="3"||z==="和")return"和";return null;
        }).filter(Boolean) as Road[];const c=count(rr);
        const category=dbCategory(text(v.categoryName,v.category,v.gameMode,v.tableType));
        this.map.set(id,{id,apiId:id,game:"百家樂",name:text(v.dealer?.name,v.dealerName,v.dealer_name,old?.name,"—"),players:text(v.onlineCount,v.online_count,old?.players,"—"),countdown:n(v.countDown??v.countdown??old?.countdown),countdownUpdatedAt:Date.now(),roomId:text(v.tableName,v.table_name,id),tableBadge:text(v.tableId,v.table_id,id),shoe:text(v.shoeId,v.shoe_id,v.shoe,old?.shoe,"—"),round:n(v.playId??v.round??v.roundNo??old?.round),banker:c.莊,player:c.閒,tie:c.和,results:rr,trend:"",live:true,lastUpdated:Date.now(),category});
      }
      if(Array.isArray(v))for(const x of v.slice(0,500))visit(x,depth+1);else for(const x of Object.values(v).slice(0,200))visit(x,depth+1);
    };visit(root);if(this.map.size)this.emit();
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
