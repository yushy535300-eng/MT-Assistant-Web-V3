import "dotenv/config";
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter, hasActiveTrackerSession } from "../routers";
import { createContext } from "./context";
import { randomUUID } from "node:crypto";
import { adminPage } from "../admin-page";
import { listWhitelist, upsertWhitelist, setWhitelistEnabled, extendWhitelist, deleteWhitelist } from "../whitelist";
import { startDgRelay, getDgRelay, stopDgRelay } from "../dg-relay";
import { prewarmDgChromium } from "../dg-chromium";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ limit: "5mb", extended: true }));

  app.get("/api/health", (_req, res) => res.json({ ok: true, timestamp: Date.now() }));

  const adminSessions = new Set<string>();
  const getAdminToken = (req:any) => {
    const headerToken = String(req.header("X-Admin-Token") || "");
    if (headerToken) return headerToken;
    const cookie = String(req.headers.cookie || "");
    const match = cookie.match(/(?:^|;\s*)mt_admin_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  };
  const requireAdmin = (req:any,res:any,next:any) => {
    const token = getAdminToken(req);
    if(!token || !adminSessions.has(token)) return res.status(401).json({error:"管理員登入已失效"});
    next();
  };
  const adminRedirect=(res:any,msg="")=>res.redirect(303,"/admin"+(msg?"?msg="+encodeURIComponent(msg):""));
  app.get("/admin", async (req,res)=>{
    res.setHeader("Cache-Control","no-store, no-cache, must-revalidate");
    const token=getAdminToken(req); const logged=!!token&&adminSessions.has(token);
    if(!logged) return res.type("html").send(adminPage(false));
    let items:any[]=[]; let dbError="";
    try { items=await listWhitelist(); console.log(`[MT Admin] whitelist loaded: ${items.length}`); }
    catch(e:any){ dbError=e?.message||"讀取失敗"; console.error("[MT Admin] whitelist load failed:",e); }
    res.type("html").send(adminPage(true,"",items,String(req.query.msg||""),dbError));
  });
  app.post("/api/admin/login", (req,res)=>{
    const expected=String(process.env.ADMIN_PASSWORD??"").trim(), supplied=String(req.body?.password??"").trim();
    if(!expected)return res.status(503).type("html").send(adminPage(false,"Render 尚未設定 ADMIN_PASSWORD"));
    if(supplied!==expected)return res.status(401).type("html").send(adminPage(false,"管理員密碼錯誤"));
    const token=randomUUID();adminSessions.add(token);res.setHeader("Set-Cookie",`mt_admin_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${process.env.NODE_ENV==="production"?"; Secure":""}`);adminRedirect(res);
  });
  app.post("/api/admin/logout-form",(req,res)=>{const t=getAdminToken(req);if(t)adminSessions.delete(t);res.setHeader("Set-Cookie",`mt_admin_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV==="production"?"; Secure":""}`);adminRedirect(res)});
  app.post("/api/admin/whitelist-form",requireAdmin,async(req,res)=>{try{const u=String(req.body?.username||"").trim();if(!u)return adminRedirect(res,"請輸入平台帳號");const platform=String(req.body?.platform||"TZ").toUpperCase();const d=String(req.body?.days||"permanent");await upsertWhitelist({username:u,platform,permanent:d==="permanent",days:d==="permanent"?null:Number(d),note:String(req.body?.note||"")});adminRedirect(res,`${u} 已新增並立即生效`)}catch(e:any){adminRedirect(res,`新增失敗：${e?.message||e}`)}});
  app.post("/api/admin/whitelist/:id/toggle-form",requireAdmin,async(req,res)=>{try{await setWhitelistEnabled(Number(req.params.id),String(req.body?.enabled)==="1");adminRedirect(res,"授權狀態已更新") }catch(e:any){adminRedirect(res,`操作失敗：${e?.message||e}`)}});
  app.post("/api/admin/whitelist/:id/extend-form",requireAdmin,async(req,res)=>{try{await extendWhitelist(Number(req.params.id),30);adminRedirect(res,"已延長 30 天")}catch(e:any){adminRedirect(res,`操作失敗：${e?.message||e}`)}});
  app.post("/api/admin/whitelist/:id/delete-form",requireAdmin,async(req,res)=>{try{await deleteWhitelist(Number(req.params.id));adminRedirect(res,"帳號已刪除") }catch(e:any){adminRedirect(res,`操作失敗：${e?.message||e}`)}});

  // Pre-warm only the Chromium process. This does NOT call DGLI/login and therefore
  // does not enter DG or trigger the platform's automatic wallet transfer.
  app.post("/api/dg/prewarm", async (req,res)=>{
    const sessionId=String(req.body?.sessionId||"");
    if(!hasActiveTrackerSession(sessionId)) return res.status(401).json({ok:false,error:"session_invalid"});
    try{await prewarmDgChromium(message=>console.log(`[DG prewarm][${sessionId.slice(0,8)}] ${message}`));return res.json({ok:true});}
    catch(e:any){console.error("[DG prewarm] failed",e);return res.status(500).json({ok:false,error:e?.message||"prewarm_failed"});}
  });

  // DG relay: the browser keeps its normal TZ/DG login flow, while the server
  // owns the vendor WebSocket so the required DG Origin header can be preserved.
  app.post("/api/dg/start", async (req,res)=>{
    const sessionId=String(req.body?.sessionId||"");
    const gameUrl=String(req.body?.gameUrl||"");
    if(!hasActiveTrackerSession(sessionId)) return res.status(401).json({ok:false,error:"session_invalid"});
    let parsed:URL; try{parsed=new URL(gameUrl)}catch{return res.status(400).json({ok:false,error:"invalid_game_url"})}
    // DG rotates launch domains. Do not pin the relay to one historical
    // new-dd-cn.* hostname; validate the security properties instead.
    const host=parsed.hostname.toLowerCase();
    const looksLocal = host==="localhost" || host.endsWith(".localhost") || host==="0.0.0.0" || host==="::1" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    const hasToken=!!parsed.searchParams.get("token");
    // The DG launch path/domain can rotate between gateways. The relay only
    // needs a public HTTPS vendor origin plus the one-time token; do not reject
    // a valid launch URL merely because its path is no longer /ddnewpc/direct1.
    if(parsed.protocol!=="https:"||looksLocal||!hasToken) return res.status(400).json({ok:false,error:"invalid_game_url"});
    console.log(`[DG API] start｜host=${parsed.hostname}｜path=${parsed.pathname}｜session=${sessionId.slice(0,8)}`);
    try{await startDgRelay(sessionId,gameUrl);return res.json({ok:true});}
    catch(e:any){console.error("[DG relay] start failed",e);return res.status(502).json({ok:false,error:e?.message||"dg_start_failed"});}
  });
  app.get("/api/dg/stream",(req,res)=>{
    const sessionId=String(req.query.sessionId||"");
    if(!hasActiveTrackerSession(sessionId)) return res.status(401).end();
    const relay=getDgRelay(sessionId); if(!relay) return res.status(404).end();
    res.status(200);
    res.setHeader("Content-Type","text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control","no-cache, no-transform");
    res.setHeader("Connection","keep-alive");
    res.setHeader("X-Accel-Buffering","no");
    (res as any).flushHeaders?.();
    const unsubscribe=relay.subscribe(res);
    const keepalive=setInterval(()=>{try{res.write(": keepalive\n\n")}catch{}},15000);
    req.on("close",()=>{clearInterval(keepalive);unsubscribe()});
  });
  app.post("/api/dg/stop",(req,res)=>{
    const sessionId=String(req.body?.sessionId||"");
    if(!hasActiveTrackerSession(sessionId)) return res.status(401).json({ok:false});
    stopDgRelay(sessionId); return res.json({ok:true});
  });

  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

  const staticDir = path.resolve(__dirname, "../../web-dist");
  app.use(express.static(staticDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(staticDir, "index.html"));
  });

  const port = Number(process.env.PORT || 3000);
  server.listen(port, "0.0.0.0", () => console.log(`[MT Assistant] http://localhost:${port}`));
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
