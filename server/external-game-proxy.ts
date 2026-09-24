import type { Express, Request, Response } from "express";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { getSaRelay } from "./sa-relay";

export type ExtPlatform = "SA" | "MV";

type ProxySession = {
  sessionId: string;
  platform: ExtPlatform;
  origin: string;
  launchUrl: string;
  pathPrefixes: string[];
  hostAllow: string[];
  lastUsed: number;
};

type RegisterOptions = {
  app: Express;
  server: HttpServer;
  hasActiveSession: (sessionId: string) => boolean;
  /** SA only: application-layer binary packets from upstream WSS. */
  onSaUpstreamPacket?: (sessionId: string, packet: Buffer) => void;
  /** SA only: pause/resume background road relay around iframe play. */
  onSaProxyBridge?: (
    sessionId: string,
    phase: "enter" | "leave",
    gameUrl?: string,
  ) => void | Promise<void>;
};

const COOKIE_NAME = "mt_ext_proxy_sid";
const PROXY_PREFIX = "/api/ext/proxy";
const HOST_PREFIX = "/api/ext/host";
const WS_PATH = "/api/ext/ws";

const PLATFORM_HOST_ALLOW: Record<ExtPlatform, string[]> = {
  SA: [
    "labplatformplus.com",
    "sa-globalxns.com",
    "saapiservice.com",
    "slgaming.net",
    "sagaming.com",
    "sa-gaming.net",
    "connect2explorer.com",
    "cloudfront.net",
  ],
  MV: ["score777.net", "score777.com"],
};

const proxySessions = new Map<string, ProxySession>();

function parseCookie(header: string | undefined, name: string) {
  if (!header) return "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return part.slice(i + 1).trim();
    }
  }
  return "";
}

/**
 * Only mark proxy cookies Secure when the browser actually used HTTPS.
 * NODE_ENV=production alone is wrong for http://127.0.0.1 previews: browsers
 * discard Secure cookies on plain HTTP, so the SA/MV iframe then gets 401
 * "ext proxy session expired" instead of the game lobby.
 */
export function proxyCookieSecureAttr(req: {
  secure?: boolean;
  protocol?: string;
  headers?: Record<string, unknown>;
}) {
  const xf = String(req.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (xf === "https") return "; Secure";
  if (xf === "http") return "";
  if (req.secure) return "; Secure";
  if (String(req.protocol || "").toLowerCase() === "https") return "; Secure";
  return "";
}

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

function hostAllowed(hostname: string, allow: string[]) {
  const host = hostname.toLowerCase();
  return allow.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

function safePublicHttpsUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("invalid_game_url");
  }
  if (u.protocol !== "https:" || isPrivateHost(u.hostname))
    throw new Error("invalid_game_url");
  return u;
}

function pathPrefixesFor(url: URL, platform: ExtPlatform) {
  const parts = url.pathname.split("/").filter(Boolean);
  const first = parts[0] ? `/${parts[0]}` : "";
  const defaults =
    platform === "SA"
      ? ["/rm", "/app.aspx"]
      : ["/live", "/cdn-cgi"];
  const set = new Set<string>(defaults);
  if (first && first !== "/") set.add(first);
  if (url.pathname.toLowerCase().endsWith(".aspx")) set.add(url.pathname);
  return [...set];
}

/** Datacenter IPs often get CF challenge/403 HTML instead of the real game page. */
export function looksLikeCloudflareBlock(
  html: string,
  status?: number,
  headers?: Headers | Record<string, string | string[] | undefined> | null,
) {
  if (status === 403 || status === 503 || status === 429) {
    const sample = String(html || "").slice(0, 12000).toLowerCase();
    if (
      !sample ||
      /cloudflare|cf-ray|cf-browser|challenge-platform|just a moment|attention required|enable javascript and cookies|checking your browser|cdn-cgi/i.test(
        sample,
      )
    )
      return true;
  }
  const cfHeader =
    headers &&
    (typeof (headers as Headers).get === "function"
      ? (headers as Headers).get("cf-ray") ||
        (headers as Headers).get("cf-mitigated") ||
        (headers as Headers).get("server")
      : String(
          (headers as any)["cf-ray"] ||
            (headers as any)["cf-mitigated"] ||
            (headers as any)["server"] ||
            "",
        ));
  if (
    cfHeader &&
    /cloudflare/i.test(String(cfHeader)) &&
    status != null &&
    status >= 400
  )
    return true;
  const sample = String(html || "").slice(0, 12000).toLowerCase();
  if (!sample) return false;
  return (
    /cdn-cgi\/challenge|cf-browser-verification|challenge-platform|__cf_chl|cf-error-details/i.test(
      sample,
    ) ||
    (/just a moment|attention required|checking your browser|enable javascript and cookies to continue/i.test(
      sample,
    ) &&
      /cloudflare|cf-ray|cdn-cgi/i.test(sample))
  );
}

/**
 * TZ SALI often returns `web.sa-globalxns.com/app.aspx?...` — an API-gateway
 * stub that answers HTTP 200 with an empty body from datacenter IPs. The real
 * lobby SPA (where WebSocket + our inject must run) is on labplatformplus.
 * Preserve username/token query so login still works.
 */
export function normalizeSaLaunchUrl(gameUrl: string | URL): URL {
  const u = typeof gameUrl === "string" ? safePublicHttpsUrl(gameUrl) : gameUrl;
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  if (
    (host === "sa-globalxns.com" || host.endsWith(".sa-globalxns.com")) &&
    (path === "/app.aspx" || path.endsWith("/app.aspx"))
  ) {
    const next = new URL("https://ws2.labplatformplus.com/rm/featured");
    u.searchParams.forEach((value, key) => {
      if (key === "__mt_ext_sid") return;
      next.searchParams.set(key, value);
    });
    return next;
  }
  return u;
}

async function resolveLaunchUrl(gameUrl: string, platform: ExtPlatform) {
  const start0 = safePublicHttpsUrl(gameUrl);
  const start =
    platform === "SA" ? normalizeSaLaunchUrl(start0) : start0;
  if (!hostAllowed(start.hostname, PLATFORM_HOST_ALLOW[platform])) {
    // Allow TZ-issued hosts that still redirect into allowlisted domains.
    // Final host is re-checked after redirects.
  }
  // LIVE77 registerAndLogin is a one-time token. Prefetching it here consumes
  // the login on the server fetch, then the iframe lands logged-out (訪客登入).
  // Hand the original URL to the browser/proxy so the first real navigation auths.
  //
  // SA SALI URLs with token: same rule — datacenter prefetch often hits Cloudflare
  // and falsely fails proxy enter, forcing direct iframe (no inject → float freezes).
  if (
    platform === "MV" ||
    platform === "SA" ||
    /registerAndLogin/i.test(start.pathname) ||
    /[?&](?:userid|sign|time|token)=/i.test(start.search)
  ) {
    if (
      platform === "SA" &&
      !hostAllowed(start.hostname, PLATFORM_HOST_ALLOW[platform])
    ) {
      // Still accept TZ hosts; iframe navigation will land on allowlisted origin.
      return start;
    }
    if (!hostAllowed(start.hostname, PLATFORM_HOST_ALLOW[platform]))
      throw new Error("host_not_allowed");
    return start;
  }
  let current = start.toString();
  let finalUrl = start;
  for (let i = 0; i < 8; i++) {
    const res = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const location = res.headers.get("location");
    if (location && res.status >= 300 && res.status < 400) {
      const next = new URL(location, current);
      if (next.protocol !== "https:" || isPrivateHost(next.hostname))
        throw new Error("invalid_redirect");
      current = next.toString();
      finalUrl = next;
      continue;
    }
    finalUrl = new URL(current);
    const contentType = res.headers.get("content-type") || "";
    if (
      /text\/html|application\/xhtml\+xml/i.test(contentType) ||
      res.status === 403 ||
      res.status === 503
    ) {
      const html = await res.text().catch(() => "");
      if (looksLikeCloudflareBlock(html, res.status, res.headers))
        throw new Error("cloudflare_blocked");
    } else if (looksLikeCloudflareBlock("", res.status, res.headers)) {
      throw new Error("cloudflare_blocked");
    }
    break;
  }
  if (!hostAllowed(finalUrl.hostname, PLATFORM_HOST_ALLOW[platform]))
    throw new Error("host_not_allowed");
  return finalUrl;
}

function sessionIdFromRequest(req: Request) {
  const fromCookie = parseCookie(req.headers.cookie, COOKIE_NAME);
  if (fromCookie) return fromCookie;
  // Iframe cookie can miss on some tunnels / SameSite edges — DG stays on
  // first-party /ddnewpc mounts; SA falls back to query sid on host-prefix URLs.
  try {
    const u = new URL(req.originalUrl || req.url || "", "http://localhost");
    const q = String(u.searchParams.get("__mt_ext_sid") || "").trim();
    if (q) return q;
  } catch {}
  return "";
}

function sessionFromRequest(req: Request) {
  const sid = sessionIdFromRequest(req);
  if (!sid) return null;
  const session = proxySessions.get(sid);
  if (!session) return null;
  session.lastUsed = Date.now();
  return session;
}

/** Strip our sid helper before forwarding to the vendor. */
function stripProxySid(target: URL) {
  if (target.searchParams.has("__mt_ext_sid")) {
    target.searchParams.delete("__mt_ext_sid");
  }
  return target;
}

function copyUpstreamHeaders(req: Request, origin: string) {
  const headers = new Headers();
  const pass = [
    "accept",
    "accept-language",
    "cache-control",
    "pragma",
    "range",
    "if-none-match",
    "if-modified-since",
    "content-type",
    "user-agent",
  ];
  for (const key of pass) {
    const v = req.headers[key];
    if (typeof v === "string" && v) headers.set(key, v);
  }
  // Forward vendor cookies that were rewritten onto our origin (drop our
  // proxy session cookie). Without this, LIVE77 registerAndLogin Set-Cookie
  // never reaches score777 on the next /live/home request → guest login wall.
  const rawCookie = typeof req.headers.cookie === "string" ? req.headers.cookie : "";
  if (rawCookie) {
    const forwarded = rawCookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part && !part.toLowerCase().startsWith(`${COOKIE_NAME}=`));
    if (forwarded.length) headers.set("cookie", forwarded.join("; "));
  }
  headers.set("origin", origin);
  const referer =
    typeof req.headers.referer === "string" ? req.headers.referer : "";
  if (referer) {
    try {
      const local = new URL(referer);
      headers.set("referer", origin + local.pathname + local.search);
    } catch {
      headers.set("referer", origin + "/");
    }
  } else {
    headers.set("referer", origin + "/");
  }
  return headers;
}

function forwardResponseHeaders(
  upstream: globalThis.Response,
  res: Response,
  rewritten: boolean,
) {
  const blocked = new Set([
    "content-length",
    "content-encoding",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "content-security-policy",
    "content-security-policy-report-only",
    "x-frame-options",
    "cross-origin-opener-policy",
    "cross-origin-embedder-policy",
    "cross-origin-resource-policy",
  ]);
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (blocked.has(lower)) return;
    if (lower === "set-cookie") {
      // Drop Domain so cookie sticks to our proxy origin.
      const cleaned = value
        .replace(/;\s*domain=[^;]*/gi, "")
        .replace(/;\s*secure/gi, "")
        .replace(/;\s*samesite=[^;]*/gi, "; SameSite=Lax");
      try {
        res.appendHeader("set-cookie", cleaned);
      } catch {
        try {
          res.setHeader("set-cookie", cleaned);
        } catch {}
      }
      return;
    }
    try {
      res.setHeader(key, value);
    } catch {}
  });
  // Explicitly allow embedding in our same-origin iframe.
  res.removeHeader("x-frame-options");
  res.removeHeader("content-security-policy");
  if (rewritten) res.setHeader("Cache-Control", "no-store");
}

function injectProxyHook(html: string, session: ProxySession) {
  const sid = JSON.stringify(session.sessionId);
  const origin = JSON.stringify(session.origin);
  const allow = JSON.stringify(session.hostAllow);
  const hostPrefix = JSON.stringify(HOST_PREFIX);
  const wsPath = JSON.stringify(WS_PATH);
  const mirrorSa = session.platform === "SA";
  // SA mirrors DG's inject: wrap WebSocket, POST decoded frames to
  // /api/sa/proxy/frames — does NOT open a second PS_LOGIN.
  // Also mapWs through /api/ext/ws so the server can sniff frames with the
  // correct vendor Origin (DG-equivalent dual feed: client mirror + proxy tap).
  const saMirrorHook = mirrorSa
    ? `const __frames=[];let __frameTimer=0,__flushing=false;\n` +
      `const __flushFrames=async()=>{if(__flushing||!__frames.length)return;__flushing=true;clearTimeout(__frameTimer);__frameTimer=0;const frames=__frames.splice(0,64);try{await fetch(\"/api/sa/proxy/frames\",{method:\"POST\",credentials:\"include\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({frames,sessionId:__sid}),keepalive:true});}catch{}finally{__flushing=false;if(__frames.length)__frameTimer=setTimeout(__flushFrames,30);}};\n` +
      `const __mirrorFrame=async value=>{try{let buf;if(value instanceof ArrayBuffer)buf=value;else if(ArrayBuffer.isView(value))buf=value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength);else if(typeof Blob!==\"undefined\"&&value instanceof Blob)buf=await value.arrayBuffer();else return;const bytes=new Uint8Array(buf);let binary=\"\";for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+32768));__frames.push(btoa(binary));if(__frames.length>=32)void __flushFrames();else if(!__frameTimer)__frameTimer=setTimeout(__flushFrames,30);}catch{}};\n` +
      `let __pnlSocket=null,__pnlBusy=false,__pnlLocked=false;\n` +
      // Parse SA 0xaa cmdId (u16le at offset 5). Lock the authenticated game
      // socket on SP_LOGIN (50001) — same idea as DG locking on cmd=10086 —
      // so BetRecord 今日輸贏 never goes to a chat/video secondary WS.
      `function __saCmdId(value){try{let buf;if(value instanceof ArrayBuffer)buf=new Uint8Array(value);else if(ArrayBuffer.isView(value))buf=new Uint8Array(value.buffer,value.byteOffset,value.byteLength);else return 0;if(!buf||buf.length<7||buf[0]!==0xaa)return 0;return buf[5]|(buf[6]<<8);}catch{return 0;}}\n` +
      `async function __saPnlPoll(){const ws=__pnlSocket;if(__pnlBusy||!ws||ws.readyState!==1)return;__pnlBusy=true;try{const r=await fetch(\"/api/sa/proxy/report-request\",{method:\"POST\",credentials:\"include\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({sessionId:__sid})});if(!r.ok)return;const data=await r.json();if(data.frame&&ws===__pnlSocket&&ws.readyState===1){const bytes=Uint8Array.from(atob(data.frame),c=>c.charCodeAt(0));NativeWS.prototype.send.call(ws,bytes);}}catch{}finally{__pnlBusy=false;}}\n` +
      `function __saPnlReceive(ws,event){try{const cmd=__saCmdId(event.data);if(cmd===50001){__pnlSocket=ws;__pnlLocked=true;setTimeout(__saPnlPoll,400);}else if(cmd===30006){setTimeout(__saPnlPoll,250);setTimeout(__saPnlPoll,900);}}catch{}}\n` +
      `const __pnlTimer=setInterval(__saPnlPoll,2000);window.addEventListener(\"pagehide\",()=>{clearInterval(__pnlTimer);__pnlSocket=null;__pnlLocked=false;},{once:true});\n`
    : "";
  const wsHook = mirrorSa
    ? `const NativeWS=window.WebSocket;if(NativeWS&&!window.__MT_SA_PROXY_WS__){window.__MT_SA_PROXY_WS__=true;class MTSAWebSocket extends NativeWS{constructor(url,protocols){const raw=String(url||\"\");const mapped=mapWs(raw);if(arguments.length>1)super(mapped,protocols);else super(mapped);this.addEventListener(\"open\",()=>{if(!__pnlLocked){__pnlSocket=this;setTimeout(__saPnlPoll,600);}});this.addEventListener(\"message\",event=>{void __mirrorFrame(event.data);__saPnlReceive(this,event);});}}window.WebSocket=MTSAWebSocket;}\n`
    : `const NativeWS=window.WebSocket;if(NativeWS){class MTExtWS extends NativeWS{constructor(url,protocols){const mapped=mapWs(String(url||\"\"));if(arguments.length>1)super(mapped,protocols);else super(mapped);}}window.WebSocket=MTExtWS;}\n`;
  // Keep the iframe on /api/ext/host/... — SA often escapes via location.href /
  // assign / replace to the vendor origin (which drops our mirror hook).
  const stayHook = mirrorSa
    ? `const __withSid=u=>{try{const s=String(u||\"\");if(!s||s.indexOf(__hostPrefix)!==0||s.indexOf(\"__mt_ext_sid=\")>=0)return s;return s+(s.indexOf(\"?\")>=0?\"&\":\"?\")+\"__mt_ext_sid=\"+encodeURIComponent(__sid);}catch{return u;}};\n` +
      `const __stay=u=>{try{return __withSid(mapHttp(String(u||\"\")));}catch{return u;}};\n` +
      `try{const _assign=location.assign.bind(location);location.assign=function(u){return _assign(__stay(u));};}catch{}\n` +
      `try{const _replace=location.replace.bind(location);location.replace=function(u){return _replace(__stay(u));};}catch{}\n` +
      `try{const desc=Object.getOwnPropertyDescriptor(Location.prototype,\"href\");if(desc&&desc.set){Object.defineProperty(Location.prototype,\"href\",{configurable:true,enumerable:desc.enumerable,get:desc.get,set:function(v){return desc.set.call(this,__stay(v));}});}}catch{}\n` +
      `try{const _push=history.pushState.bind(history);history.pushState=function(s,t,u){return _push(s,t,u==null?u:__stay(u));};}catch{}\n` +
      `try{const _rep=history.replaceState.bind(history);history.replaceState=function(s,t,u){return _rep(s,t,u==null?u:__stay(u));};}catch{}\n` +
      `document.addEventListener(\"click\",function(ev){try{const a=ev.target&&ev.target.closest?ev.target.closest(\"a[href]\"):null;if(!a)return;const href=a.getAttribute(\"href\");if(!href||href.startsWith(\"#\")||href.startsWith(\"javascript:\"))return;const next=__stay(href);if(next&&next!==href){ev.preventDefault();location.assign(next);}}catch{}},true);\n`
    : "";
  const hook =
    `<script>(function(){\n` +
    `const __sid=${sid},__origin=${origin},__allow=${allow},__hostPrefix=${hostPrefix},__wsPath=${wsPath};\n` +
    `if(window.__MT_EXT_PROXY__)return;window.__MT_EXT_PROXY__=true;\n` +
    `const allowHost=(h)=>{try{const host=String(h||\"\").toLowerCase();return __allow.some(s=>host===s||host.endsWith(\".\"+s));}catch{return false;}};\n` +
    `const mapHttp=(value)=>{try{const raw=String(value||\"\");if(!raw)return value;const abs=raw.startsWith(\"//\")?location.protocol+raw:raw;if(!(raw.startsWith(\"http://\")||raw.startsWith(\"https://\")||raw.startsWith(\"//\")))return value;const u=new URL(abs,location.href);if(u.origin===__origin||allowHost(u.hostname)){const host=u.origin===__origin?(function(){try{return new URL(__origin).hostname;}catch{return u.hostname;}})():u.hostname;return __hostPrefix+\"/\"+host+(u.pathname||\"/\")+u.search+u.hash;}return value;}catch{return value;}};\n` +
    `const mapWs=(value)=>{try{const raw=String(value||\"\");const u=new URL(raw,location.href);if(u.protocol!==\"ws:\"&&u.protocol!==\"wss:\")return value;if(u.origin.replace(/^http/,\"ws\")===__origin.replace(/^http/,\"ws\")||allowHost(u.hostname))return __wsPath+\"?target=\"+encodeURIComponent(u.toString())+\"&__mt_ext_sid=\"+encodeURIComponent(__sid);return value;}catch{return value;}};\n` +
    saMirrorHook +
    stayHook +
    wsHook +
    `const nativeFetch=window.fetch;if(nativeFetch){window.fetch=function(input,init){if(typeof input===\"string\"||input instanceof URL)return nativeFetch.call(this,mapHttp(String(input)),init);return nativeFetch.call(this,input,init);};}\n` +
    `const xhrOpen=window.XMLHttpRequest&&XMLHttpRequest.prototype.open;if(xhrOpen){XMLHttpRequest.prototype.open=function(method,url){const args=Array.from(arguments);args[1]=mapHttp(url);return xhrOpen.apply(this,args);};}\n` +
    `const patchUrlProp=(proto,prop)=>{try{const d=Object.getOwnPropertyDescriptor(proto,prop);if(!d||!d.set)return;Object.defineProperty(proto,prop,{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){d.set.call(this,mapHttp(v));}});}catch{}};\n` +
    `if(window.HTMLScriptElement)patchUrlProp(HTMLScriptElement.prototype,\"src\");\n` +
    `if(window.HTMLLinkElement)patchUrlProp(HTMLLinkElement.prototype,\"href\");\n` +
    `if(window.HTMLImageElement)patchUrlProp(HTMLImageElement.prototype,\"src\");\n` +
    `if(window.HTMLSourceElement)patchUrlProp(HTMLSourceElement.prototype,\"src\");\n` +
    `if(window.HTMLVideoElement)patchUrlProp(HTMLVideoElement.prototype,\"src\");\n` +
    `const setAttr=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){if(name===\"src\"||name===\"href\")value=mapHttp(value);return setAttr.call(this,name,value);};\n` +
    `window.__MT_EXT_UPSTREAM_ORIGIN__=__origin;\n` +
    `})();</script>`;
  let page = html;
  try {
    const host = new URL(session.origin).host;
    page = page.split(session.origin).join("");
    page = page.split(`//${host}`).join("");
  } catch {}
  if (/<head(?:\s[^>]*)?>/i.test(page))
    return page.replace(/<head(?:\s[^>]*)?>/i, (m) => m + hook);
  if (/<html(?:\s[^>]*)?>/i.test(page))
    return page.replace(/<html(?:\s[^>]*)?>/i, (m) => m + hook);
  return hook + page;
}

function wsAccept(key: string) {
  return createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
}

/**
 * Assemble WebSocket data frames and yield application payloads (opcode 2).
 * Handles fragmented messages (FIN=0 + continuation opcode 0) like DG ServerFrameTap.
 */
function createWsFrameSniffer(onBinary: (payload: Buffer) => void) {
  let buf = Buffer.alloc(0);
  let fragments: Buffer[] = [];
  let fragmentOpcode = 0;
  return (chunk: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
    while (buf.length >= 2) {
      const b0 = buf[0]!;
      const b1 = buf[1]!;
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(16 * 1024 * 1024)) {
          buf = Buffer.alloc(0);
          fragments = [];
          fragmentOpcode = 0;
          return;
        }
        len = Number(big);
        offset = 10;
      }
      if (len > 16 * 1024 * 1024) {
        buf = Buffer.alloc(0);
        fragments = [];
        fragmentOpcode = 0;
        return;
      }
      const maskLen = masked ? 4 : 0;
      if (buf.length < offset + maskLen + len) return;
      let payload = Buffer.from(
        buf.subarray(offset + maskLen, offset + maskLen + len),
      );
      if (masked) {
        const mask = buf.subarray(offset, offset + 4);
        for (let i = 0; i < payload.length; i++)
          payload[i]! ^= mask[i % 4]!;
      }
      buf = buf.subarray(offset + maskLen + len);
      if (opcode === 0) {
        fragments.push(payload);
        if (fin) {
          const full = Buffer.concat(fragments);
          const op = fragmentOpcode;
          fragments = [];
          fragmentOpcode = 0;
          if (op === 2 && full.length) onBinary(full);
        }
        continue;
      }
      if (!fin && (opcode === 1 || opcode === 2)) {
        fragmentOpcode = opcode;
        fragments = [payload];
        continue;
      }
      if (fin && opcode === 2 && payload.length) onBinary(payload);
      // opcode 1 text / 8 close / 9 ping / 10 pong — ignore for roads
    }
  };
}

/** When sa-globalxns app.aspx returns empty, hop the iframe to the real SPA. */
function saEmptyDocumentBootstrap(session: ProxySession, from: URL) {
  let lobby: URL;
  try {
    lobby = normalizeSaLaunchUrl(session.launchUrl || from.toString());
  } catch {
    lobby = new URL("https://ws2.labplatformplus.com/rm/featured");
    from.searchParams.forEach((v, k) => {
      if (k !== "__mt_ext_sid") lobby.searchParams.set(k, v);
    });
  }
  if (/sa-globalxns\.com$/i.test(lobby.hostname)) {
    const next = new URL("https://ws2.labplatformplus.com/rm/featured");
    lobby.searchParams.forEach((v, k) => next.searchParams.set(k, v));
    lobby = next;
  }
  const dest = `${HOST_PREFIX}/${lobby.hostname}${lobby.pathname}${lobby.search}${
    lobby.search ? "&" : "?"
  }__mt_ext_sid=${encodeURIComponent(session.sessionId)}`;
  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8"/>` +
    `<meta http-equiv="refresh" content="0;url=${dest}"/>` +
    `<script>try{location.replace(${JSON.stringify(dest)});}catch(e){}</script>` +
    `</head><body></body></html>`;
  return injectProxyHook(html, {
    ...session,
    origin: lobby.origin,
    launchUrl: lobby.toString(),
  });
}

async function proxyHttp(
  req: Request,
  res: Response,
  session: ProxySession,
  target: URL,
) {
  stripProxySid(target);
  // Even if the iframe still requests empty app.aspx, hop to the real SPA.
  if (
    session.platform === "SA" &&
    /sa-globalxns\.com$/i.test(target.hostname) &&
    /app\.aspx$/i.test(target.pathname)
  ) {
    console.log(
      `[ext proxy] SA empty-gateway hop｜${target.pathname}→/rm/featured｜session=${session.sessionId.slice(0, 8)}`,
    );
    return res
      .status(200)
      .type("html")
      .send(saEmptyDocumentBootstrap(session, target));
  }
  if (
    target.protocol !== "https:" ||
    isPrivateHost(target.hostname) ||
    !hostAllowed(target.hostname, session.hostAllow)
  ) {
    return res.status(400).send("ext proxy target blocked");
  }
  try {
    const init: RequestInit & { duplex?: "half" } = {
      method: req.method,
      headers: copyUpstreamHeaders(req, target.origin),
      redirect: "manual",
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      const ct = String(req.headers["content-type"] || "").toLowerCase();
      if (req.body != null && /application\/json/.test(ct))
        init.body = JSON.stringify(req.body);
      else if (
        req.body != null &&
        /application\/x-www-form-urlencoded/.test(ct)
      )
        init.body = new URLSearchParams(
          req.body as Record<string, string>,
        ).toString();
      else {
        init.body = req as any;
        init.duplex = "half";
      }
    }
    const upstream = await fetch(target, init as any);
    const location = upstream.headers.get("location");
    if (location && upstream.status >= 300 && upstream.status < 400) {
      const next = new URL(location, target);
      // SA must stay under /api/ext/host/... so inject/mirror keeps working
      // (bare /rm paths can miss mounts; bare / hits our SPA).
      const saMapped = (u: URL) => {
        const q = u.search || "";
        const sidQ = q
          ? `${q}&__mt_ext_sid=${encodeURIComponent(session.sessionId)}`
          : `?__mt_ext_sid=${encodeURIComponent(session.sessionId)}`;
        return `${HOST_PREFIX}/${u.hostname}${u.pathname}${sidQ}`;
      };
      if (next.origin === session.origin) {
        const loc =
          session.platform === "SA"
            ? saMapped(next)
            : next.pathname + next.search;
        res.status(upstream.status).setHeader("Location", loc).end();
        return;
      }
      if (hostAllowed(next.hostname, session.hostAllow)) {
        const mapped =
          session.platform === "SA" || next.origin !== session.origin
            ? saMapped(next)
            : next.pathname + next.search;
        res.status(upstream.status).setHeader("Location", mapped).end();
        return;
      }
      res.status(upstream.status).setHeader("Location", next.toString()).end();
      return;
    }
    const contentType = upstream.headers.get("content-type") || "";
    const fetchDest = String(req.headers["sec-fetch-dest"] || "").toLowerCase();
    const isNavigate =
      fetchDest === "document" ||
      fetchDest === "iframe" ||
      String(req.headers["sec-fetch-mode"] || "").toLowerCase() === "navigate";
    let isHtml =
      /text\/html|application\/xhtml\+xml/i.test(contentType) ||
      /(?:^|\/)index\.html$/i.test(target.pathname) ||
      /\.aspx$/i.test(target.pathname) ||
      (session.platform === "SA" && isNavigate && !/\.(js|css|json|png|jpe?g|gif|webp|svg|woff2?|ttf|ico|map)(\?|$)/i.test(target.pathname));
    // SA gateways often serve the lobby shell with a non-HTML Content-Type
    // (same class of bug DG fixed for index.html). Peek the body when unsure.
    res.status(upstream.status);
    forwardResponseHeaders(upstream, res, isHtml);
    if (req.method === "HEAD" || upstream.status === 204 || upstream.status === 304) {
      return res.end();
    }
    if (!upstream.body) {
      if (session.platform === "SA" && isNavigate) {
        console.log(
          `[ext proxy] SA empty body hop｜${target.pathname}｜session=${session.sessionId.slice(0, 8)}`,
        );
        return res
          .status(200)
          .type("html")
          .send(saEmptyDocumentBootstrap(session, target));
      }
      return res.end();
    }
    if (isHtml || session.platform === "SA") {
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (!buf.length && session.platform === "SA") {
        console.log(
          `[ext proxy] SA zero-byte hop｜${target.pathname}｜session=${session.sessionId.slice(0, 8)}`,
        );
        return res
          .status(200)
          .type("html")
          .send(saEmptyDocumentBootstrap(session, target));
      }
      const head = buf.subarray(0, 2048).toString("utf8").trimStart();
      const looksHtml =
        isHtml ||
        /^<!DOCTYPE/i.test(head) ||
        /^<html/i.test(head) ||
        /^<\?xml/i.test(head) ||
        /^<!--/i.test(head) ||
        /<(?:html|head|body|script|meta|title|link|div|app)\b/i.test(head);
      if (looksHtml) {
        const html = buf.toString("utf8");
        if (looksLikeCloudflareBlock(html, upstream.status, upstream.headers)) {
          console.error(
            `[EXT proxy] Cloudflare blocked upstream｜${session.platform} ${target}`,
          );
          return res
            .status(502)
            .type("json")
            .send(
              JSON.stringify({
                ok: false,
                error: "cloudflare_blocked",
                message:
                  "Upstream blocked by Cloudflare from this server IP. Open the game URL in a browser tab instead.",
              }),
            );
        }
        if (session.platform === "SA") {
          console.log(
            `[ext proxy] SA inject HTML｜${target.pathname}｜session=${session.sessionId.slice(0, 8)}`,
          );
        }
        res.type("html").send(injectProxyHook(html, session));
        return;
      }
      if (session.platform === "SA") {
        console.log(
          `[ext proxy] SA skip inject｜ct=${contentType.slice(0, 40)}｜path=${target.pathname}｜head=${JSON.stringify(head.slice(0, 60))}｜session=${session.sessionId.slice(0, 8)}`,
        );
      }
      res.send(buf);
      return;
    }
    Readable.fromWeb(upstream.body as any).pipe(res);
  } catch (error: any) {
    console.error(
      `[EXT proxy] HTTP failed｜${session.platform} ${req.method} ${target}｜${error?.message || error}`,
    );
    if (!res.headersSent) res.status(502).send("ext proxy upstream failed");
    else res.end();
  }
}

function handleWsUpgrade(
  req: IncomingMessage,
  client: Socket,
  head: Buffer,
  options: RegisterOptions,
) {
  let parsed: URL;
  try {
    parsed = new URL(req.url || "", "http://localhost");
  } catch {
    client.destroy();
    return;
  }
  if (parsed.pathname !== WS_PATH) return;
  const sid = parseCookie(req.headers.cookie, COOKIE_NAME)
    || String(parsed.searchParams.get("__mt_ext_sid") || "").trim();
  const session = sid ? proxySessions.get(sid) : null;
  if (!session || !options.hasActiveSession(session.sessionId)) {
    client.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }
  session.lastUsed = Date.now();
  const targetRaw = parsed.searchParams.get("target") || "";
  let target: URL;
  try {
    target = new URL(targetRaw);
  } catch {
    client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }
  if (
    (target.protocol !== "wss:" && target.protocol !== "ws:") ||
    isPrivateHost(target.hostname) ||
    !hostAllowed(target.hostname, session.hostAllow)
  ) {
    client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }
  const browserKey = String(req.headers["sec-websocket-key"] || "");
  if (!browserKey) {
    client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }

  import("node:https")
    .then(({ request: httpsRequest }) => {
      const upstreamReq = httpsRequest({
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: "GET",
        headers: {
          host: target.host,
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-version": "13",
          "sec-websocket-key": browserKey,
          origin: session.origin,
          "user-agent": String(req.headers["user-agent"] || ""),
        },
      });
      upstreamReq.on("upgrade", (upRes, upSocket, upHead) => {
        const proto = upRes.headers["sec-websocket-protocol"];
        const lines = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${wsAccept(browserKey)}`,
        ];
        if (proto) lines.push(`Sec-WebSocket-Protocol: ${proto}`);
        lines.push("\r\n");
        client.write(lines.join("\r\n"));
        if (head?.length) upSocket.write(head);
        if (upHead?.length) client.write(upHead);

        if (session.platform === "SA") {
          console.log(
            `[ext proxy] SA WS 101｜host=${target.hostname}｜session=${session.sessionId.slice(0, 8)}｜sniff=${!!options.onSaUpstreamPacket}`,
          );
        }

        let sniffLogged = false;
        const sniffSa =
          session.platform === "SA" && !!options.onSaUpstreamPacket
            ? createWsFrameSniffer((packet) => {
                try {
                  if (!sniffLogged) {
                    sniffLogged = true;
                    console.log(
                      `[ext proxy] SA sniff first frame ${packet.length}b｜session=${session.sessionId.slice(0, 8)}`,
                    );
                  }
                  options.onSaUpstreamPacket?.(session.sessionId, packet);
                } catch {}
              })
            : null;

        if (sniffSa) {
          // Manual duplex so we can tap server→client binary frames for SA roads.
          upSocket.on("data", (chunk: Buffer) => {
            try {
              sniffSa(chunk);
            } catch {}
            if (!client.destroyed) client.write(chunk);
          });
          client.on("data", (chunk: Buffer) => {
            if (!upSocket.destroyed) upSocket.write(chunk);
          });
        } else {
          client.pipe(upSocket);
          upSocket.pipe(client);
        }

        const closeBoth = () => {
          try {
            client.destroy();
          } catch {}
          try {
            upSocket.destroy();
          } catch {}
        };
        client.on("error", closeBoth);
        upSocket.on("error", closeBoth);
        client.on("close", closeBoth);
        upSocket.on("close", closeBoth);
      });
      upstreamReq.on("error", () => {
        try {
          client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        } catch {}
      });
      upstreamReq.end();
    })
    .catch(() => {
      try {
        client.end("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      } catch {}
    });
}

export function registerExternalGameProxy(options: RegisterOptions) {
  const { app, server, hasActiveSession } = options;

  // Mirror binary frames the SA page already received (browser-decoded) into the
  // road relay. Does not open a second PS_LOGIN — same single-session as DG.
  // Auth: proxy cookie OR body.sessionId (iframe cookie misses on some tunnels).
  app.post("/api/sa/proxy/frames", (req: Request, res: Response) => {
    let session = sessionFromRequest(req);
    if (!session) {
      const sid = String(req.body?.sessionId || "").trim();
      if (sid) {
        const byBody = proxySessions.get(sid);
        if (byBody) {
          byBody.lastUsed = Date.now();
          session = byBody;
        }
      }
    }
    if (!session || session.platform !== "SA" || !hasActiveSession(session.sessionId))
      return res.status(401).json({ ok: false, error: "session_invalid" });
    if (!options.onSaUpstreamPacket)
      return res.status(503).json({ ok: false, error: "mirror_unavailable" });
    const frames = Array.isArray(req.body?.frames) ? req.body.frames : [];
    if (!frames.length || frames.length > 64)
      return res.status(400).json({ ok: false, error: "invalid_frames" });
    let accepted = 0;
    for (const raw of frames) {
      if (typeof raw !== "string" || raw.length > 2_000_000) continue;
      try {
        const data = Buffer.from(raw, "base64");
        if (!data.length || data.length > 1_500_000) continue;
        options.onSaUpstreamPacket(session.sessionId, data);
        accepted++;
      } catch {}
    }
    if (accepted > 0) {
      const key = `_mirrorLog_${session.sessionId}`;
      const g = globalThis as any;
      if (!g[key]) {
        g[key] = true;
        console.log(
          `[ext proxy] SA mirror frames ok｜accepted=${accepted}｜session=${session.sessionId.slice(0, 8)}`,
        );
      }
    }
    return res.json({ ok: true, accepted });
  });

  // Official SA BetRecord summary frame for iframe inject (今日輸贏 = 投注記錄).
  app.post("/api/sa/proxy/report-request", (req: Request, res: Response) => {
    let session = sessionFromRequest(req);
    if (!session) {
      const sid = String(req.body?.sessionId || "").trim();
      if (sid) {
        const byBody = proxySessions.get(sid);
        if (byBody) {
          byBody.lastUsed = Date.now();
          session = byBody;
        }
      }
    }
    if (!session || session.platform !== "SA" || !hasActiveSession(session.sessionId))
      return res.status(401).json({ ok: false, error: "session_invalid" });
    const relay = getSaRelay(session.sessionId);
    if (!relay) return res.status(404).json({ ok: false, error: "relay_missing" });
    try {
      const frame = relay.buildBetLogSummaryRequestFrame();
      return res.json({
        ok: true,
        frame: Buffer.from(frame).toString("base64"),
      });
    } catch (error: any) {
      return res
        .status(500)
        .json({ ok: false, error: String(error?.message || error) });
    }
  });

  const sameOriginHandler = async (req: Request, res: Response) => {
    const session = sessionFromRequest(req);
    if (!session || !hasActiveSession(session.sessionId))
      return res.status(401).send("ext proxy session expired");
    const target = new URL(req.originalUrl || req.url, session.origin);
    target.hash = "";
    return proxyHttp(req, res, session, target);
  };

  app.use(HOST_PREFIX + "/:host", async (req: Request, res: Response) => {
    const session = sessionFromRequest(req);
    if (!session || !hasActiveSession(session.sessionId)) {
      if (String(req.params.host || "")) {
        console.warn(
          `[ext proxy] SA/MV host 401｜host=${req.params.host}｜hasCookie=${!!parseCookie(req.headers.cookie, COOKIE_NAME)}｜path=${String(req.url || "").slice(0, 80)}`,
        );
      }
      return res.status(401).send("ext proxy session expired");
    }
    const host = String(req.params.host || "").toLowerCase();
    if (!hostAllowed(host, session.hostAllow))
      return res.status(400).send("host not allowed");
    const rest = String(req.url || "/");
    const pathAndQuery = rest.startsWith("?")
      ? `/${rest}`
      : rest || "/";
    let target: URL;
    try {
      target = new URL(`https://${host}${pathAndQuery}`);
    } catch {
      return res.status(400).send("bad host path");
    }
    if (session.platform === "SA") {
      const key = `_hostHit_${session.sessionId}`;
      const g = globalThis as any;
      if (!g[key]) {
        g[key] = true;
        console.log(
          `[ext proxy] SA host first hit｜${host}${target.pathname}｜session=${session.sessionId.slice(0, 8)}`,
        );
      }
    }
    return proxyHttp(req, res, session, target);
  });

  // Mount common SA / MV first-party path prefixes at the site root so relative
  // asset URLs in the vendor SPA keep working after same-origin rewrite.
  for (const prefix of ["/rm", "/live", "/app.aspx"]) {
    app.use(prefix, sameOriginHandler);
  }

  app.post(`${PROXY_PREFIX}/enter`, async (req: Request, res: Response) => {
    const sessionId = String(req.body?.sessionId || "");
    const gameUrl = String(req.body?.gameUrl || "");
    const platform = String(req.body?.platform || "").toUpperCase() as ExtPlatform;
    if (!sessionId || !hasActiveSession(sessionId))
      return res.status(401).json({ ok: false, error: "session_invalid" });
    if (platform !== "SA" && platform !== "MV")
      return res.status(400).json({ ok: false, error: "invalid_platform" });
    let finalUrl: URL;
    try {
      finalUrl = await resolveLaunchUrl(gameUrl, platform);
    } catch (error: any) {
      const code = String(error?.message || "invalid_game_url");
      const status = code === "cloudflare_blocked" ? 502 : 400;
      return res.status(status).json({
        ok: false,
        error: code,
        message:
          code === "cloudflare_blocked"
            ? "Cloudflare blocked server-side fetch; open the TZ game URL in a browser tab"
            : undefined,
      });
    }
    const hostAllow = [...PLATFORM_HOST_ALLOW[platform]];
    // Always include the resolved launch host.
    if (!hostAllowed(finalUrl.hostname, hostAllow))
      hostAllow.push(finalUrl.hostname);
    const pathPrefixes = pathPrefixesFor(finalUrl, platform);
    proxySessions.set(sessionId, {
      sessionId,
      platform,
      origin: finalUrl.origin,
      launchUrl: finalUrl.toString(),
      pathPrefixes,
      hostAllow,
      lastUsed: Date.now(),
    });
    if (platform === "SA") {
      try {
        // Stop background SA WS and adopt this launch token before the iframe
        // loads — same single-session pattern as DG (avoids ERR26 double login).
        await options.onSaProxyBridge?.(sessionId, "enter", finalUrl.toString());
        await new Promise((resolve) => setTimeout(resolve, 250));
      } catch (error: any) {
        console.warn(
          `[ext proxy] SA bridge enter failed｜${error?.message || error}`,
        );
      }
    }
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=14400${proxyCookieSecureAttr(req)}`,
    );
    // SA: always load via /api/ext/host/<hostname>/... so EVERY HTML response
    // hits proxyHttp + inject (DG mounts /ddnewpc; SA hosts vary and bare
    // pathname can fall through to our SPA without the mirror hook).
    // Embed __mt_ext_sid so iframe auth works even when the proxy cookie misses.
    const iframeUrl =
      platform === "SA"
        ? (() => {
            const path = `${HOST_PREFIX}/${finalUrl.hostname}${finalUrl.pathname || "/"}${finalUrl.search}`;
            return `${path}${finalUrl.search ? "&" : "?"}__mt_ext_sid=${encodeURIComponent(sessionId)}`;
          })()
        : finalUrl.pathname + finalUrl.search;
    return res.json({
      ok: true,
      url: iframeUrl,
      origin: finalUrl.origin,
      platform,
    });
  });

  app.post(`${PROXY_PREFIX}/leave`, async (req: Request, res: Response) => {
    const sessionId = String(req.body?.sessionId || "");
    if (!sessionId)
      return res.status(400).json({ ok: false, error: "session_invalid" });
    const existing = proxySessions.get(sessionId);
    const restoreRelay = req.body?.restoreRelay !== false;
    if (existing?.platform === "SA" && restoreRelay) {
      try {
        await options.onSaProxyBridge?.(sessionId, "leave");
      } catch (error: any) {
        console.warn(
          `[ext proxy] SA bridge leave failed｜${error?.message || error}`,
        );
      }
    }
    proxySessions.delete(sessionId);
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${proxyCookieSecureAttr(req)}`,
    );
    return res.json({ ok: true });
  });

  server.on("upgrade", (req, socket, head) => {
    try {
      const u = new URL(req.url || "", "http://localhost");
      if (u.pathname !== WS_PATH) return;
      handleWsUpgrade(req, socket as Socket, head, options);
    } catch {
      try {
        socket.destroy();
      } catch {}
    }
  });

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [sid, item] of proxySessions)
      if (now - item.lastUsed > 6 * 60 * 60 * 1000) proxySessions.delete(sid);
  }, 30 * 60 * 1000);
  timer.unref?.();
}
