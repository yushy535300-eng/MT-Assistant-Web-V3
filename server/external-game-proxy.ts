import type { Express, Request, Response } from "express";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";

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

async function resolveLaunchUrl(gameUrl: string, platform: ExtPlatform) {
  const start = safePublicHttpsUrl(gameUrl);
  if (!hostAllowed(start.hostname, PLATFORM_HOST_ALLOW[platform])) {
    // Allow TZ-issued hosts that still redirect into allowlisted domains.
    // Final host is re-checked after redirects.
  }
  // LIVE77 registerAndLogin is a one-time token. Prefetching it here consumes
  // the login on the server fetch, then the iframe lands logged-out (訪客登入).
  // Hand the original URL to the browser/proxy so the first real navigation auths.
  if (
    platform === "MV" ||
    /registerAndLogin/i.test(start.pathname) ||
    /[?&](?:userid|sign|time)=/i.test(start.search)
  ) {
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

function sessionFromRequest(req: Request) {
  const sid = parseCookie(req.headers.cookie, COOKIE_NAME);
  if (!sid) return null;
  const session = proxySessions.get(sid);
  if (!session) return null;
  session.lastUsed = Date.now();
  return session;
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
  const hook =
    `<script>(function(){\n` +
    `const __sid=${sid},__origin=${origin},__allow=${allow},__hostPrefix=${hostPrefix},__wsPath=${wsPath};\n` +
    `if(window.__MT_EXT_PROXY__)return;window.__MT_EXT_PROXY__=true;\n` +
    `const allowHost=(h)=>{try{const host=String(h||"").toLowerCase();return __allow.some(s=>host===s||host.endsWith("."+s));}catch{return false;}};\n` +
    `const mapHttp=(value)=>{try{const raw=String(value||"");if(!raw)return value;const abs=raw.startsWith("//")?location.protocol+raw:raw;if(!(raw.startsWith("http://")||raw.startsWith("https://")||raw.startsWith("//")))return value;const u=new URL(abs,location.href);if(u.origin===__origin)return u.pathname+u.search+u.hash;if(allowHost(u.hostname))return __hostPrefix+"/"+u.hostname+(u.pathname||"/")+u.search+u.hash;return value;}catch{return value;}};\n` +
    `const mapWs=(value)=>{try{const raw=String(value||"");const u=new URL(raw,location.href);if(u.protocol!=="ws:"&&u.protocol!=="wss:")return value;if(u.origin.replace(/^http/,"ws")===__origin.replace(/^http/,"ws")||allowHost(u.hostname))return __wsPath+"?target="+encodeURIComponent(u.toString());return value;}catch{return value;}};\n` +
    `const NativeWS=window.WebSocket;if(NativeWS){class MTExtWS extends NativeWS{constructor(url,protocols){const mapped=mapWs(String(url||""));if(arguments.length>1)super(mapped,protocols);else super(mapped);}}window.WebSocket=MTExtWS;}\n` +
    `const nativeFetch=window.fetch;if(nativeFetch){window.fetch=function(input,init){if(typeof input==="string"||input instanceof URL)return nativeFetch.call(this,mapHttp(String(input)),init);return nativeFetch.call(this,input,init);};}\n` +
    `const xhrOpen=window.XMLHttpRequest&&XMLHttpRequest.prototype.open;if(xhrOpen){XMLHttpRequest.prototype.open=function(method,url){const args=Array.from(arguments);args[1]=mapHttp(url);return xhrOpen.apply(this,args);};}\n` +
    `const patchUrlProp=(proto,prop)=>{try{const d=Object.getOwnPropertyDescriptor(proto,prop);if(!d||!d.set)return;Object.defineProperty(proto,prop,{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){d.set.call(this,mapHttp(v));}});}catch{}};\n` +
    `if(window.HTMLScriptElement)patchUrlProp(HTMLScriptElement.prototype,"src");\n` +
    `if(window.HTMLLinkElement)patchUrlProp(HTMLLinkElement.prototype,"href");\n` +
    `if(window.HTMLImageElement)patchUrlProp(HTMLImageElement.prototype,"src");\n` +
    `if(window.HTMLSourceElement)patchUrlProp(HTMLSourceElement.prototype,"src");\n` +
    `if(window.HTMLVideoElement)patchUrlProp(HTMLVideoElement.prototype,"src");\n` +
    `const setAttr=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){if(name==="src"||name==="href")value=mapHttp(value);return setAttr.call(this,name,value);};\n` +
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
  return hook + page;
}

function wsAccept(key: string) {
  return createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
}

/** Assemble WebSocket data frames and yield application payloads (opcode 2). */
function createWsFrameSniffer(onBinary: (payload: Buffer) => void) {
  let buf = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const b0 = buf[0];
      const b1 = buf[1];
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
        if (big > BigInt(2_000_000)) {
          buf = Buffer.alloc(0);
          return;
        }
        len = Number(big);
        offset = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (buf.length < offset + maskLen + len) return;
      let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
      if (masked) {
        const mask = buf.subarray(offset, offset + 4);
        const out = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ mask[i % 4];
        payload = out;
      }
      buf = buf.subarray(offset + maskLen + len);
      if (opcode === 2 && payload.length) onBinary(payload);
      // opcode 0 continuation / 1 text / 8 close / 9 ping — ignore for roads
    }
  };
}

async function proxyHttp(
  req: Request,
  res: Response,
  session: ProxySession,
  target: URL,
) {
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
      if (next.origin === session.origin) {
        res
          .status(upstream.status)
          .setHeader("Location", next.pathname + next.search)
          .end();
        return;
      }
      if (hostAllowed(next.hostname, session.hostAllow)) {
        const mapped =
          next.origin === session.origin
            ? next.pathname + next.search
            : `${HOST_PREFIX}/${next.hostname}${next.pathname}${next.search}`;
        res.status(upstream.status).setHeader("Location", mapped).end();
        return;
      }
      res.status(upstream.status).setHeader("Location", next.toString()).end();
      return;
    }
    const contentType = upstream.headers.get("content-type") || "";
    const isHtml =
      /text\/html|application\/xhtml\+xml/i.test(contentType) ||
      /(?:^|\/)index\.html$/i.test(target.pathname) ||
      /\.aspx$/i.test(target.pathname);
    res.status(upstream.status);
    forwardResponseHeaders(upstream, res, isHtml);
    if (
      req.method === "HEAD" ||
      upstream.status === 204 ||
      upstream.status === 304 ||
      !upstream.body
    )
      return res.end();
    if (isHtml) {
      const html = await upstream.text();
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
      res.type("html").send(injectProxyHook(html, session));
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
  const sid = parseCookie(req.headers.cookie, COOKIE_NAME);
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

        const sniffSa =
          session.platform === "SA" && !!options.onSaUpstreamPacket
            ? createWsFrameSniffer((packet) => {
                try {
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
    if (!session || !hasActiveSession(session.sessionId))
      return res.status(401).send("ext proxy session expired");
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
    return res.json({
      ok: true,
      url: finalUrl.pathname + finalUrl.search,
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
