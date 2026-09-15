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
  const requireAdmin = (req:any,res:any,next:any) => {
    const token=String(req.header("X-Admin-Token")||"");
    if(!token || !adminSessions.has(token)) return res.status(401).json({error:"管理員登入已失效"});
    next();
  };
  app.get("/admin", (_req,res)=>{
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.type("html").send(adminPage);
  });
  app.get("/api/admin/status", (_req,res)=>{
    const configured = String(process.env.ADMIN_PASSWORD ?? "").trim().length > 0;
    res.setHeader("Cache-Control", "no-store");
    res.json({ok:true,configured});
  });
  app.post("/api/admin/login", (req,res)=>{
    // Render env values can accidentally contain leading/trailing whitespace or CR/LF.
    // Normalize only the outer whitespace; the actual password contents remain case-sensitive.
    const expected=String(process.env.ADMIN_PASSWORD ?? "").trim();
    const supplied=String(req.body?.password ?? "").trim();
    res.setHeader("Cache-Control", "no-store");
    if(!expected) return res.status(503).json({error:"Render 尚未設定 ADMIN_PASSWORD"});
    if(!supplied) return res.status(400).json({error:"請輸入管理員密碼"});
    if(supplied!==expected) return res.status(401).json({error:"管理員密碼錯誤，請確認 Render 的 ADMIN_PASSWORD"});
    const token=randomUUID(); adminSessions.add(token);
    res.json({ok:true,token});
  });
  app.get("/api/admin/whitelist", requireAdmin, async (_req,res)=>{try{res.json({items:await listWhitelist()})}catch(e:any){res.status(500).json({error:e?.message||"讀取失敗"})}});
  app.post("/api/admin/whitelist", requireAdmin, async (req,res)=>{try{if(!String(req.body?.username||"").trim())return res.status(400).json({error:"請輸入 TZ 帳號"});await upsertWhitelist(req.body);res.json({ok:true})}catch(e:any){res.status(500).json({error:e?.message||"儲存失敗"})}});
  app.post("/api/admin/whitelist/:id/toggle", requireAdmin, async (req,res)=>{try{await setWhitelistEnabled(Number(req.params.id),!!req.body?.enabled);res.json({ok:true})}catch(e:any){res.status(500).json({error:e?.message||"操作失敗"})}});
  app.post("/api/admin/whitelist/:id/extend", requireAdmin, async (req,res)=>{try{await extendWhitelist(Number(req.params.id),Number(req.body?.days)||30);res.json({ok:true})}catch(e:any){res.status(500).json({error:e?.message||"操作失敗"})}});
  app.post("/api/admin/whitelist/:id/devices", requireAdmin, async (req,res)=>{try{await clearWhitelistDevices(Number(req.params.id));res.json({ok:true})}catch(e:any){res.status(500).json({error:e?.message||"操作失敗"})}});
  app.post("/api/admin/whitelist/:id/delete", requireAdmin, async (req,res)=>{try{await deleteWhitelist(Number(req.params.id));res.json({ok:true})}catch(e:any){res.status(500).json({error:e?.message||"操作失敗"})}});

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
