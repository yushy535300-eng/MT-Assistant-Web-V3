export type VendorKind="AB"|"DB";
export type VendorRoadResult="莊"|"閒"|"和";
export type VendorTableData={
  id:string;apiId:string;game:string;name:string;players:string;countdown?:number;countdownUpdatedAt?:number;
  roomId?:string;tableBadge?:string;shoe:string;round:number;banker:number;player:number;tie:number;
  results:VendorRoadResult[];trend:string;live?:boolean;dealerPhoto?:string;streamUrl?:string;
  lastUpdated?:number;lastResultKey?:string;poker?:string;category?:string;
};
type Callbacks={onTables:(v:VendorTableData[])=>void;onStatus?:(s:string,m?:string)=>void;onEvent?:(m:string)=>void;onPnl?:(v:number|null)=>void;onSettlement?:(v:{pnl:number;tableId?:string})=>void};

export async function connectVendorLive(kind:VendorKind,gameUrl:string,sessionId:string,cb:Callbacks){
  const response=await fetch("/api/vendor/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind,gameUrl,sessionId})});
  const data=await response.json().catch(()=>null);if(!response.ok||!data?.ok)throw new Error(data?.error||`${kind} 啟動失敗`);
  const source=new EventSource(`/api/vendor/stream?kind=${kind}&sessionId=${encodeURIComponent(sessionId)}`);
  source.addEventListener("status",(e:any)=>{try{const x=JSON.parse(e.data);cb.onStatus?.(x.status,x.message)}catch{}});
  source.addEventListener("tables",(e:any)=>{try{const x=JSON.parse(e.data);if(Array.isArray(x))cb.onTables(x)}catch{}});
  source.addEventListener("pnl",(e:any)=>{try{const x=JSON.parse(e.data);cb.onPnl?.(typeof x==="number"?x:null)}catch{}});
  source.addEventListener("settlement",(e:any)=>{try{cb.onSettlement?.(JSON.parse(e.data))}catch{}});
  source.addEventListener("event",(e:any)=>{try{cb.onEvent?.(JSON.parse(e.data)?.message||"")}catch{}});
  source.onerror=()=>cb.onStatus?.("error",`${kind} 即時資料暫時中斷`);
  return{close(){source.close();void fetch("/api/vendor/stop",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind,sessionId})}).catch(()=>{})}};
}
