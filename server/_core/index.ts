import "dotenv/config";
import express from "express";
import { createServer } from "http";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter, hasActiveTrackerSession, requireTrackerSession } from "../routers";
import { createContext } from "./context";
import { randomUUID } from "node:crypto";
import { adminPage } from "../admin-page";
import { listWhitelist, upsertWhitelist, deleteWhitelist } from "../whitelist";
import { startDgRelay, getDgRelay, stopDgRelay, findDgRelayByToken, sweepIdleDgRelays } from "../dg-relay";
import { startSaRelay, getSaRelay, stopSaRelay, sweepIdleSaRelays, ensureSaRelayShell } from "../sa-relay";
import { registerDgGameProxy } from "../dg-game-proxy";
import { registerExternalGameProxy } from "../external-game-proxy";
import { extractSaAuth } from "../sa-protocol";
import {
  MV_LIVE_ROOM_CATALOG,
  mvRoomsOrFallback,
  parseMvLobbyHtml,
} from "../mv-live-rooms";
import { restoreTrackerSessions, saveTrackerSession } from "../sessions";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  await restoreTrackerSessions();
  const app = express();
  const server = createServer(app);
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ limit: "5mb", extended: true }));

  // Foreground same-session proxies. These are intentionally registered
  // before the app's static catch-all. MT routes / sockets are untouched.
  registerDgGameProxy({ app, server, hasActiveSession: hasActiveTrackerSession, getRelay: getDgRelay });
  // SA / 美女直播: strip X-Frame and serve vendor SPA same-origin so iframe works.
  // SA proxy WS frames are mirrored into the SA road relay while the iframe is open.
  registerExternalGameProxy({
    app,
    server,
    hasActiveSession: hasActiveTrackerSession,
    onSaUpstreamPacket: (sessionId, packet) => {
      getSaRelay(sessionId)?.ingestApplicationPacket(packet);
    },
    onSaProxyBridge: async (sessionId, phase, gameUrl) => {
      if (phase === "enter") {
        const url = String(gameUrl || "");
        if (!url) {
          getSaRelay(sessionId)?.enterBridgeMode();
          return;
        }
        ensureSaRelayShell(sessionId, url).enterBridgeMode();
        return;
      }
      const relay = getSaRelay(sessionId);
      if (relay) await relay.leaveBridgeMode();
    },
  });

  app.get("/api/health", (_req, res) => {
    const mem = process.memoryUsage();
    res.json({
      ok: true,
      timestamp: Date.now(),
      memoryMb: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576) },
    });
  });

  // SA room covers — same-origin proxy of rivetlabs `{hostId}.jpg` for dealer crop.
  const saThumbCache = new Map<number, { buf: Buffer; at: number; type: string }>();
  app.get("/api/sa/thumb/:hostId", async (req, res) => {
    const hostId = Number(String(req.params.hostId || "").replace(/\.jpg$/i, ""));
    if (!Number.isFinite(hostId) || hostId <= 0)
      return res.status(400).send("bad host");
    const hit = saThumbCache.get(hostId);
    if (hit && Date.now() - hit.at < 5 * 60_000) {
      res.setHeader("Cache-Control", "public, max-age=60");
      res.type(hit.type).send(hit.buf);
      return;
    }
    try {
      const upstream = await fetch(
        `https://thumbnail.rivetlabs.net/${hostId}.jpg`,
        {
          headers: {
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          },
        },
      );
      if (!upstream.ok) return res.status(upstream.status).end();
      const type = upstream.headers.get("content-type") || "image/jpeg";
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.length < 100 || buf.length > 2_000_000)
        return res.status(502).end();
      saThumbCache.set(hostId, { buf, at: Date.now(), type });
      if (saThumbCache.size > 200) {
        const oldest = [...saThumbCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) saThumbCache.delete(oldest[0]);
      }
      res.setHeader("Cache-Control", "public, max-age=60");
      res.type(type).send(buf);
    } catch {
      res.status(502).end();
    }
  });

  // 美女直播主播牌卡：預設目錄 + 可解析 lobby HTML（瀏覽器端抓到後 POST）。
  app.get("/api/mv/rooms", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      source: "catalog",
      rooms: MV_LIVE_ROOM_CATALOG,
      updatedAt: Date.now(),
    });
  });
  app.post("/api/mv/rooms/parse", (req, res) => {
    const html = String(req.body?.html || "");
    if (!html || html.length < 40)
      return res.status(400).json({ ok: false, error: "html_required" });
    const parsed = parseMvLobbyHtml(html);
    const rooms = mvRoomsOrFallback(parsed);
    res.json({
      ok: true,
      source: parsed.length ? "parsed" : "catalog",
      rooms,
      updatedAt: Date.now(),
    });
  });

  // Local-only UI demo: skip TZ login so platform tabs can be verified.
  app.post("/api/demo/enter", async (req, res) => {
    const host = String(req.hostname || req.headers.host || "").split(":")[0].toLowerCase();
    const local =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1";
    if (!local) return res.status(403).json({ ok: false, error: "demo_local_only" });
    const sessionId = randomUUID();
    await saveTrackerSession({ sessionId, platform: "TZ", username: "demo-local" });
    return res.json({ ok: true, sessionId, platformToken: "demo-local-token" });
  });

  const dgSweepTimer = setInterval(() => {
    const result = sweepIdleDgRelays(180000);
    if (result.stopped) console.log(`[DG cleanup] stopped=${result.stopped} active=${result.active}`);
  }, 60000);
  dgSweepTimer.unref?.();

  const saSweepTimer = setInterval(() => {
    sweepIdleSaRelays(180000);
  }, 60000);
  saSweepTimer.unref?.();

  const adminSessions = new Set<string>();
  const getAdminToken = (req: any) => {
    const headerToken = String(req.header("X-Admin-Token") || "");
    if (headerToken) return headerToken;
    const cookie = String(req.headers.cookie || "");
    const match = cookie.match(/(?:^|;\s*)mt_admin_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  };
  const requireAdmin = (req: any, res: any, next: any) => {
    const token = getAdminToken(req);
    if (!token || !adminSessions.has(token)) return res.status(401).json({ error: "管理員登入已失效" });
    next();
  };
  const adminRedirect = (res: any, msg = "") =>
    res.redirect(303, "/admin" + (msg ? "?msg=" + encodeURIComponent(msg) : ""));
  app.get("/admin", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    const token = getAdminToken(req);
    const logged = !!token && adminSessions.has(token);
    if (!logged) return res.type("html").send(adminPage(false));
    let items: any[] = [];
    let dbError = "";
    try {
      items = await listWhitelist();
      console.log(`[MT Admin] whitelist loaded: ${items.length}`);
    } catch (e: any) {
      dbError = e?.message || "讀取失敗";
      console.error("[MT Admin] whitelist load failed:", e);
    }
    res.type("html").send(adminPage(true, "", items, String(req.query.msg || ""), dbError));
  });
  app.post("/api/admin/login", (req, res) => {
    const expected = String(process.env.ADMIN_PASSWORD ?? "").trim(),
      supplied = String(req.body?.password ?? "").trim();
    if (!expected)
      return res.status(503).type("html").send(adminPage(false, "Render 尚未設定 ADMIN_PASSWORD"));
    if (supplied !== expected)
      return res.status(401).type("html").send(adminPage(false, "管理員密碼錯誤"));
    const token = randomUUID();
    adminSessions.add(token);
    res.setHeader(
      "Set-Cookie",
      `mt_admin_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    );
    adminRedirect(res);
  });
  app.post("/api/admin/logout-form", (req, res) => {
    const t = getAdminToken(req);
    if (t) adminSessions.delete(t);
    res.setHeader(
      "Set-Cookie",
      `mt_admin_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    );
    adminRedirect(res);
  });
  app.post("/api/admin/whitelist-form", requireAdmin, async (req, res) => {
    try {
      const u = String(req.body?.username || "").trim();
      if (!u) return adminRedirect(res, "請輸入登入帳號");
      await upsertWhitelist({ username: u });
      adminRedirect(res, `${u} 已加入共用白名單`);
    } catch (e: any) {
      adminRedirect(res, `新增失敗：${e?.message || e}`);
    }
  });
  app.post("/api/admin/whitelist/:id/delete-form", requireAdmin, async (req, res) => {
    try {
      await deleteWhitelist(Number(req.params.id));
      adminRedirect(res, "帳號已刪除");
    } catch (e: any) {
      adminRedirect(res, `操作失敗：${e?.message || e}`);
    }
  });

  // Compatibility endpoint retained for older clients. Chromium has been removed
  // from the DG road path, so there is nothing to prewarm anymore.
  app.post("/api/dg/prewarm", (req, res) => {
    const sessionId = String(req.body?.sessionId || "");
    if (!hasActiveTrackerSession(sessionId)) return res.status(401).json({ ok: false, error: "session_invalid" });
    return res.json({ ok: true, mode: "lightweight-ws" });
  });

  // DG relay: the browser keeps its normal TZ/DG login flow, while the server
  // owns the vendor WebSocket so the required DG Origin header can be preserved.
  app.post("/api/dg/start", async (req, res) => {
    const sessionId = String(req.body?.sessionId || "");
    const gameUrl = String(req.body?.gameUrl || "");
    if (!hasActiveTrackerSession(sessionId)) return res.status(401).json({ ok: false, error: "session_invalid" });
    let parsed: URL;
    try {
      parsed = new URL(gameUrl);
    } catch {
      return res.status(400).json({ ok: false, error: "invalid_game_url" });
    }
    // DG rotates launch domains. Do not pin the relay to one historical
    // new-dd-cn.* hostname; validate the security properties instead.
    const host = parsed.hostname.toLowerCase();
    const looksLocal =
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "0.0.0.0" ||
      host === "::1" ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    const hasToken = !!parsed.searchParams.get("token");
    // The DG launch path/domain can rotate between gateways. The relay only
    // needs a public HTTPS vendor origin plus the one-time token; do not reject
    // a valid launch URL merely because its path is no longer /ddnewpc/direct1.
    if (parsed.protocol !== "https:" || looksLocal || !hasToken)
      return res.status(400).json({ ok: false, error: "invalid_game_url" });
    try {
      const result = await startDgRelay(sessionId, gameUrl);
      const status = result.relay.getStatus();
      if (result.reused) console.log(`[DG API] reuse｜status=${status}｜session=${sessionId.slice(0, 8)}`);
      else
        console.log(
          `[DG API] start｜host=${parsed.hostname}｜path=${parsed.pathname}｜session=${sessionId.slice(0, 8)}`,
        );
      return res.json({ ok: true, reused: result.reused, status });
    } catch (e: any) {
      console.error("[DG relay] start failed", e);
      return res.status(502).json({ ok: false, error: e?.message || "dg_start_failed" });
    }
  });
  app.get("/api/dg/stream", (req, res) => {
    const sessionId = String(req.query.sessionId || "");
    if (!hasActiveTrackerSession(sessionId)) return res.status(401).end();
    const relay = getDgRelay(sessionId);
    if (!relay) return res.status(404).end();
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    (res as any).flushHeaders?.();
    const unsubscribe = relay.subscribe(res);
    const keepalive = setInterval(() => {
      try {
        res.write(": keepalive\n\n");
      } catch {}
    }, 15000);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(keepalive);
      try {
        unsubscribe();
      } catch {}
    };
    req.once("close", cleanup);
    res.once("close", cleanup);
    res.once("finish", cleanup);
  });
  app.post("/api/dg/stop", (req, res) => {
    const sessionId = String(req.body?.sessionId || "");
    // Allow cleanup of an already-created relay even when the tracker session
    // has just expired/logged out. The opaque session id is still required.
    if (!hasActiveTrackerSession(sessionId) && !getDgRelay(sessionId))
      return res.status(401).json({ ok: false });
    stopDgRelay(sessionId);
    return res.json({ ok: true });
  });

  // SA lobby road relay (connect2explorer binary protocol).
  app.post("/api/sa/start", async (req, res) => {
    const sessionId = String(req.body?.sessionId || "");
    const gameUrl = String(req.body?.gameUrl || "");
    if (!hasActiveTrackerSession(sessionId))
      return res.status(401).json({ ok: false, error: "session_invalid" });
    let parsed: URL;
    try {
      parsed = new URL(gameUrl);
    } catch {
      return res.status(400).json({ ok: false, error: "invalid_game_url" });
    }
    const auth = extractSaAuth(gameUrl);
    if (parsed.protocol !== "https:" || !auth.token)
      return res.status(400).json({ ok: false, error: "invalid_game_url" });
    try {
      const result = await startSaRelay(sessionId, gameUrl);
      const status = result.relay.getStatus();
      if (result.reused)
        console.log(`[SA API] reuse｜status=${status}｜session=${sessionId.slice(0, 8)}`);
      else
        console.log(
          `[SA API] start｜host=${parsed.hostname}｜session=${sessionId.slice(0, 8)}`,
        );
      return res.json({ ok: true, reused: result.reused, status });
    } catch (e: any) {
      console.error("[SA relay] start failed", e);
      return res.status(502).json({ ok: false, error: e?.message || "sa_start_failed" });
    }
  });
  app.get("/api/sa/stream", (req, res) => {
    const sessionId = String(req.query.sessionId || "");
    if (!hasActiveTrackerSession(sessionId)) return res.status(401).end();
    const relay = getSaRelay(sessionId);
    if (!relay) return res.status(404).end();
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    (res as any).flushHeaders?.();
    const unsubscribe = relay.subscribe(res);
    const keepalive = setInterval(() => {
      try {
        res.write(": keepalive\n\n");
      } catch {}
    }, 15000);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(keepalive);
      try {
        unsubscribe();
      } catch {}
    };
    req.once("close", cleanup);
    res.once("close", cleanup);
    res.once("finish", cleanup);
  });
  app.post("/api/sa/stop", (req, res) => {
    const sessionId = String(req.body?.sessionId || "");
    if (!hasActiveTrackerSession(sessionId) && !getSaRelay(sessionId))
      return res.status(401).json({ ok: false });
    stopSaRelay(sessionId);
    return res.json({ ok: true });
  });

  // SA single-session bridge (ERR26). Stop background PS_LOGIN before the
  // game iframe loads — including the direct-iframe path when /api/ext/proxy
  // fails (Cloudflare). Mirror DG's /api/dg/bridge/enter contract.
  app.post("/api/sa/bridge/enter", async (req, res) => {
    const sessionId = String(req.body?.sessionId || "");
    const gameUrl = String(req.body?.gameUrl || "");
    if (!hasActiveTrackerSession(sessionId))
      return res.status(401).json({ ok: false, error: "session_invalid" });
    try {
      if (gameUrl) {
        ensureSaRelayShell(sessionId, gameUrl).enterBridgeMode();
      } else {
        const relay = getSaRelay(sessionId);
        if (!relay)
          return res.status(404).json({ ok: false, error: "relay_not_found" });
        relay.enterBridgeMode();
      }
      // Let upstream WS close settle before the iframe opens PS_LOGIN.
      await new Promise((resolve) => setTimeout(resolve, 250));
      return res.json({ ok: true });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, error: e?.message || "bridge_enter_failed" });
    }
  });

  app.post("/api/sa/bridge/leave", async (req, res) => {
    const sessionId = String(req.body?.sessionId || "");
    if (!hasActiveTrackerSession(sessionId))
      return res.status(401).json({ ok: false, error: "session_invalid" });
    const relay = getSaRelay(sessionId);
    if (!relay) return res.status(404).json({ ok: false, error: "relay_not_found" });
    try {
      if (req.body?.restoreRelay === false) {
        // Keep background WS stopped (e.g. mid-enter); do not reopen PS_LOGIN.
        return res.json({ ok: true, restored: false });
      }
      await relay.leaveBridgeMode();
      return res.json({ ok: true, restored: true });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, error: e?.message || "bridge_leave_failed" });
    }
  });

  // Game iframe keeps token A; float background switches to a DIFFERENT SALI (token B).
  // Same-token retarget is rejected (would ERR26 the game).
  app.post("/api/sa/bridge/retarget", async (req, res) => {
    const sessionId = String(req.body?.sessionId || "");
    const gameUrl = String(req.body?.gameUrl || "");
    if (!hasActiveTrackerSession(sessionId))
      return res.status(401).json({ ok: false, error: "session_invalid" });
    if (!gameUrl)
      return res.status(400).json({ ok: false, error: "game_url_required" });
    try {
      const existing = getSaRelay(sessionId);
      if (!existing) {
        // No shell yet — start float directly on token B.
        const { relay } = await startSaRelay(sessionId, gameUrl);
        return res.json({ ok: true, status: relay.getStatus(), mode: "start" });
      }
      await existing.retargetBackground(gameUrl);
      return res.json({ ok: true, status: existing.getStatus(), mode: "retarget" });
    } catch (e: any) {
      const msg = e?.message || "bridge_retarget_failed";
      const sameToken = /不同 SALI token|ERR26/i.test(msg);
      return res
        .status(sameToken ? 409 : 500)
        .json({ ok: false, error: msg });
    }
  });

  // DG single-session browser bridge. When the user opens the real DG iframe,
  // stop the competing Render Chromium transport but keep the SAME relay object,
  // SSE subscribers and table cache alive. The companion extension mirrors the
  // foreground DG WebSocket's binary frames into this relay.
  app.post("/api/dg/bridge/enter", async (req, res) => {
    const sessionId = String(req.body?.sessionId || "");
    if (!hasActiveTrackerSession(sessionId)) return res.status(401).json({ ok: false, error: "session_invalid" });
    const relay = getDgRelay(sessionId);
    if (!relay) return res.status(404).json({ ok: false, error: "relay_not_found" });
    try {
      relay.enterBridgeMode();
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message || "bridge_enter_failed" });
    }
  });

  app.post("/api/dg/bridge/leave", async (req, res) => {
    const sessionId = String(req.body?.sessionId || "");
    if (!hasActiveTrackerSession(sessionId)) return res.status(401).json({ ok: false, error: "session_invalid" });
    const relay = getDgRelay(sessionId);
    if (!relay) return res.status(404).json({ ok: false, error: "relay_not_found" });
    try {
      await relay.leaveBridgeMode();
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message || "bridge_leave_failed" });
    }
  });

  app.post("/api/dg/bridge/status", (req, res) => {
    const token = String(req.body?.token || "");
    const state = String(req.body?.state || "");
    const pageUrl = String(req.body?.pageUrl || "");
    const relay = findDgRelayByToken(token);
    if (!relay) return res.status(404).json({ ok: false, error: "bridge_not_active" });
    if (state !== "open" && state !== "close" && state !== "error")
      return res.status(400).json({ ok: false, error: "invalid_state" });
    relay.bridgeSocketState(state as "open" | "close" | "error", pageUrl);
    return res.json({ ok: true });
  });

  app.post("/api/dg/bridge/frames", (req, res) => {
    const token = String(req.body?.token || "");
    const relay = findDgRelayByToken(token);
    if (!relay) return res.status(404).json({ ok: false, error: "bridge_not_active" });
    const frames = Array.isArray(req.body?.frames) ? req.body.frames : [];
    if (!frames.length || frames.length > 128)
      return res.status(400).json({ ok: false, error: "invalid_frames" });
    let accepted = 0;
    for (const raw of frames) {
      if (typeof raw !== "string" || raw.length > 2_000_000) continue;
      try {
        const data = Buffer.from(raw, "base64");
        if (!data.length || data.length > 1_500_000) continue;
        if (relay.ingestBridgeFrame(data)) accepted++;
      } catch {}
    }
    return res.json({ ok: true, accepted });
  });

  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

  // Source zip for GitHub upload (refreshed on each ship).
  app.get("/download/mt-assistant-github.zip", (_req, res) => {
    const candidates = [
      path.resolve("/opt/cursor/artifacts/mt-assistant-github.zip"),
      path.resolve(__dirname, "../../public/download/mt-assistant-github.zip"),
      path.resolve(__dirname, "../../mt_assistant_for_github.zip"),
      path.resolve(__dirname, "../../web-dist/mt-assistant-github.zip"),
    ];
    for (const file of candidates) {
      if (fs.existsSync(file)) {
        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="mt-assistant-github.zip"',
        );
        res.setHeader("Cache-Control", "no-store");
        return res.sendFile(file);
      }
    }
    return res.status(404).json({ ok: false, error: "zip_not_found" });
  });

  // Explicit locked-good-version alias (same bytes as github zip after ship).
  app.get("/download/MT-Assistant-locked.zip", (_req, res) => {
    const candidates = [
      path.resolve("/opt/cursor/artifacts/mt-assistant-github.zip"),
      path.resolve(__dirname, "../../public/download/mt-assistant-github.zip"),
      path.resolve(__dirname, "../../web-dist/mt-assistant-github.zip"),
    ];
    for (const file of candidates) {
      if (fs.existsSync(file)) {
        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="MT-Assistant-locked.zip"',
        );
        res.setHeader("Cache-Control", "no-store");
        return res.sendFile(file);
      }
    }
    return res.status(404).json({ ok: false, error: "zip_not_found" });
  });

  // Windows desktop installer (NSIS) — plain Setup.exe, runs normally after install.
  // App encrypts local user data at rest (not the download zip).
  app.get("/download/MT-Assistant-Setup.exe", (_req, res) => {
    const candidates: string[] = [
      path.resolve("/opt/cursor/artifacts/MT-Assistant-Setup.exe"),
      path.resolve(__dirname, "../../web-dist/MT-Assistant-Setup.exe"),
    ];
    try {
      const releaseDir = path.resolve(__dirname, "../../desktop/release");
      if (fs.existsSync(releaseDir)) {
        for (const name of fs.readdirSync(releaseDir)) {
          if (/^MT-Assistant-Setup-.*\.exe$/i.test(name) && !/\.blockmap$/i.test(name)) {
            candidates.push(path.join(releaseDir, name));
          }
        }
      }
    } catch {}
    let best: { file: string; mtime: number } | null = null;
    for (const file of candidates) {
      try {
        const st = fs.statSync(file);
        if (!st.isFile() || st.size < 5_000_000) continue;
        if (!best || st.mtimeMs > best.mtime) best = { file, mtime: st.mtimeMs };
      } catch {}
    }
    if (!best) return res.status(404).json({ ok: false, error: "setup_exe_not_found" });
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="MT-Assistant-Setup.exe"',
    );
    return res.sendFile(best.file);
  });

  // Legacy encrypted-zip URL → redirect people to the plain installer.
  app.get("/download/MT-Assistant-Setup.zip", (_req, res) => {
    return res.redirect(302, "/download/MT-Assistant-Setup.exe");
  });

  // Windows desktop portable exe (Electron) — single-file.
  app.get("/download/MT-Assistant-portable.exe", (_req, res) => {
    const candidates = [
      path.resolve("/opt/cursor/artifacts/MT-Assistant-portable.exe"),
      path.resolve(
        __dirname,
        "../../desktop/release/MT-Assistant-1.0.0-portable.exe",
      ),
      path.resolve(__dirname, "../../web-dist/MT-Assistant-portable.exe"),
    ];
    try {
      const releaseDir = path.resolve(__dirname, "../../desktop/release");
      if (fs.existsSync(releaseDir)) {
        for (const name of fs.readdirSync(releaseDir)) {
          if (/portable\.exe$/i.test(name)) {
            candidates.unshift(path.join(releaseDir, name));
          }
        }
      }
    } catch {}
    for (const file of candidates) {
      if (fs.existsSync(file)) {
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="MT-Assistant-portable.exe"',
        );
        return res.sendFile(file);
      }
    }
    return res.status(404).json({ ok: false, error: "exe_not_found" });
  });

  // Windows desktop folder zip (extract → MT Assistant.exe).
  app.get("/download/MT-Assistant-Windows.zip", (_req, res) => {
    const candidates = [
      path.resolve("/opt/cursor/artifacts/MT-Assistant-Windows.zip"),
      path.resolve(__dirname, "../../MT-Assistant-Windows.zip"),
      path.resolve(__dirname, "../../web-dist/MT-Assistant-Windows.zip"),
    ];
    for (const file of candidates) {
      if (fs.existsSync(file)) {
        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="MT-Assistant-Windows.zip"',
        );
        return res.sendFile(file);
      }
    }
    return res.status(404).json({ ok: false, error: "windows_zip_not_found" });
  });

  // Desktop (Electron) sets MT_WEB_DIST / MT_PUBLIC_DIR to extraResources.
  const staticDir = path.resolve(
    process.env.MT_WEB_DIST || path.resolve(__dirname, "../../web-dist"),
  );
  const publicDir = path.resolve(
    process.env.MT_PUBLIC_DIR || path.resolve(__dirname, "../../public"),
  );
  // Streamer avatars for 美女直播 cards (same-origin; score777 CDN is CF-blocked here).
  app.use(
    "/mv-hosts",
    express.static(path.join(publicDir, "mv-hosts"), {
      maxAge: "7d",
      fallthrough: true,
    }),
  );
  app.use(express.static(staticDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(staticDir, "index.html"));
  });

  const port = Number(process.env.PORT || 3000);
  const host = process.env.MT_LISTEN_HOST || "0.0.0.0";
  server.listen(port, host, () =>
    console.log(`[MT Assistant] http://127.0.0.1:${port}`),
  );
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
