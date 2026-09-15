import "dotenv/config";
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { randomUUID } from "node:crypto";
import { adminPage } from "../admin-page";
import { listWhitelist, upsertWhitelist, setWhitelistEnabled, extendWhitelist, clearWhitelistDevices, deleteWhitelist } from "../whitelist";

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
  app.post("/api/admin/whitelist-form",requireAdmin,async(req,res)=>{try{const u=String(req.body?.username||"").trim();if(!u)return adminRedirect(res,"請輸入 TZ 帳號");const d=String(req.body?.days||"permanent");await upsertWhitelist({username:u,permanent:d==="permanent",days:d==="permanent"?null:Number(d),maxDevices:Number(req.body?.maxDevices)||1,note:String(req.body?.note||"")});adminRedirect(res,`${u} 已新增並立即生效`)}catch(e:any){adminRedirect(res,`新增失敗：${e?.message||e}`)}});
  app.post("/api/admin/whitelist/:id/toggle-form",requireAdmin,async(req,res)=>{try{await setWhitelistEnabled(Number(req.params.id),String(req.body?.enabled)==="1");adminRedirect(res,"授權狀態已更新") }catch(e:any){adminRedirect(res,`操作失敗：${e?.message||e}`)}});
  app.post("/api/admin/whitelist/:id/extend-form",requireAdmin,async(req,res)=>{try{await extendWhitelist(Number(req.params.id),30);adminRedirect(res,"已延長 30 天")}catch(e:any){adminRedirect(res,`操作失敗：${e?.message||e}`)}});
  app.post("/api/admin/whitelist/:id/devices-form",requireAdmin,async(req,res)=>{try{await clearWhitelistDevices(Number(req.params.id));adminRedirect(res,"裝置綁定已解除")}catch(e:any){adminRedirect(res,`操作失敗：${e?.message||e}`)}});
  app.post("/api/admin/whitelist/:id/delete-form",requireAdmin,async(req,res)=>{try{await deleteWhitelist(Number(req.params.id));adminRedirect(res,"帳號已刪除") }catch(e:any){adminRedirect(res,`操作失敗：${e?.message||e}`)}});

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
