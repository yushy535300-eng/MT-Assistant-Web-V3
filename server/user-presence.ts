import type { Express, RequestHandler } from "express";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
// @ts-expect-error This project has ws installed but does not include its declaration package.
import WebSocket, { WebSocketServer } from "ws";

type Database = { query: (text: string, values?: any[]) => Promise<{ rows?: any[] }> };
type Identity = { platform: string; username: string };
type RawData = string | Buffer | ArrayBuffer | Buffer[];

export type PresenceDependencies = {
  appId?: "autobac" | "baccarat-helper" | "scarab-heart";
  publicOrigin?: string;
  /** Tests may inject an anonymous mock. Production obtains the existing PG pool. */
  db?: Database | null;
  getPool?: () => Database | null;
  readRiskTrackerIdentity?: (db: Database, sessionId: string) => Promise<Identity | null>;
  createConnectionId?: () => string;
  heartbeatIntervalMs?: number;
  pongTimeoutMs?: number;
  authTimeoutMs?: number;
  now?: () => number;
};

const initialized = new WeakMap<object, Promise<void>>();
const PRESENCE_PATH = "/api/presence/ws";
const LEASE_TTL_SECONDS = 25;
const DEFAULT_HEARTBEAT_MS = 10_000;
const DEFAULT_PONG_TIMEOUT_MS = 20_000;
const DEFAULT_AUTH_TIMEOUT_MS = 5_000;

/**
 * This is deliberately a transient lease table: it has no session, credential,
 * IP, game URL, or historical-event columns. Stale rows are ignored after 25s.
 */
export function ensureUserPresence(db: Database): Promise<void> {
  const previous = initialized.get(db as object);
  if (previous) return previous;
  const job = (async () => {
    await db.query(`CREATE TABLE IF NOT EXISTS autobac_user_presence (
      connection_id UUID PRIMARY KEY,
      platform VARCHAR(16) NOT NULL,
      username_key VARCHAR(128) NOT NULL,
      running BOOLEAN NOT NULL DEFAULT FALSE,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await db.query(`ALTER TABLE autobac_user_presence ADD COLUMN IF NOT EXISTS app_id VARCHAR(32) NOT NULL DEFAULT 'autobac'`);
    await db.query(`CREATE INDEX IF NOT EXISTS autobac_user_presence_lease
      ON autobac_user_presence (last_seen_at)`);
    await db.query(`CREATE INDEX IF NOT EXISTS autobac_user_presence_account_lease
      ON autobac_user_presence (platform, username_key, last_seen_at)`);
  })();
  initialized.set(db as object, job);
  void job.catch(() => {
    if (initialized.get(db as object) === job) initialized.delete(db as object);
  });
  return job;
}

function cleanIdentity(identity: Identity): { platform: string; usernameKey: string } | null {
  const platform = String(identity?.platform || "").trim().toUpperCase();
  const usernameKey = String(identity?.username || "").trim().toLowerCase();
  if (!platform || !usernameKey || platform.length > 16 || usernameKey.length > 128) return null;
  return { platform, usernameKey };
}

function strictObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  return actual.length === keys.length && actual.every((key, i) => key === keys.slice().sort()[i]);
}

function decodeFrame(data: RawData): string | null {
  try {
    if (typeof data === "string") return data;
    if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
    if (Buffer.isBuffer(data)) return data.toString("utf8");
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
    return null;
  } catch {
    return null;
  }
}

function parseFrame(data: RawData): Record<string, unknown> | null {
  const text = decodeFrame(data);
  if (text == null || text.length > 4096) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Browser Origin is a scheme + authority; accept no path/query/opaque origin. */
function isSameOrigin(req: IncomingMessage, publicOrigin?: string): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (typeof origin !== "string" || !origin || typeof host !== "string" || !host) return false;
  // This also prevents an Origin with a path/query from being normalized into a match.
  if (!/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+$/i.test(origin)) return false;
  try {
    const parsed = new URL(origin);
    const transportProtocol = (req.socket as any).encrypted ? 'https:' : 'http:';
    const expected = publicOrigin ? new URL(publicOrigin) : new URL(`${transportProtocol}//${host}`);
    return (
      parsed.origin === expected.origin &&
      ["http:", "https:"].includes(parsed.protocol) &&
      parsed.origin !== "null" &&
      !parsed.username &&
      !parsed.password &&
      parsed.host.toLowerCase() === host.toLowerCase()
    );
  } catch {
    return false;
  }
}

function rejectUpgrade(socket: Socket, status: 400 | 403 = 403) {
  const reason = status === 403 ? "Forbidden" : "Bad Request";
  try {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  } catch {}
  try {
    socket.destroy();
  } catch {}
}

function asCount(value: unknown): number {
  if(value===null || value===undefined || value==='') throw new Error("invalid_count");
  const count = Number(value);
  if(!Number.isSafeInteger(count) || count<0) throw new Error("invalid_count");
  return count;
}

/**
 * Registers AutoBac-only authenticated browser-connection presence.
 * The returned disposer is primarily for isolated tests; normal process lifetime
 * owns the listener and transient sockets.
 */
export function registerUserPresence(
  app: Express,
  server: HttpServer,
  requireAdmin: RequestHandler,
  deps: PresenceDependencies = {},
) {
  const getDatabase = () => (deps.db !== undefined ? deps.db : (deps.getPool?.() ?? null));
  const readIdentity = deps.readRiskTrackerIdentity || (async () => null);
  const appId = deps.appId || "autobac";
  const makeConnectionId = deps.createConnectionId || randomUUID;
  const heartbeatIntervalMs = Math.max(1, deps.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS);
  const pongTimeoutMs = Math.max(1, deps.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS);
  const authTimeoutMs = Math.max(1, deps.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS);
  const now = deps.now || Date.now;
  const sockets = new Set<() => void>();
  const wss = new WebSocketServer({ noServer: true, clientTracking: false, maxPayload: 4096 });

  app.get(
    "/api/admin/presence",
    (req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      return requireAdmin(req, res, next);
    },
    async (_req, res) => {
      let db: Database | null = null;
      try {
        db = getDatabase();
        if (!db) throw new Error("database_unavailable");
        await ensureUserPresence(db);
        // This deletion is only transient lease housekeeping, not an audit/history record.
        await db.query(
          `DELETE FROM autobac_user_presence
           WHERE last_seen_at <= NOW() - INTERVAL '${LEASE_TTL_SECONDS} seconds'`,
        );
        const result = await db.query(`WITH eligible_presence AS (
            SELECT p.app_id, p.platform, p.username_key,
              BOOL_OR(p.running AND p.app_id='autobac') AS running
            FROM autobac_user_presence p
            WHERE p.last_seen_at > NOW() - INTERVAL '${LEASE_TTL_SECONDS} seconds'
              AND EXISTS (
                SELECT 1 FROM tz_whitelist w
                WHERE UPPER(w.platform)=UPPER(p.platform)
                  AND LOWER(w.username)=p.username_key
                  AND w.enabled=TRUE
                  AND (w.expires_at IS NULL OR w.expires_at>NOW())
              )
            GROUP BY p.app_id, p.platform, p.username_key
          )
          SELECT NULL::text AS app_id,
            COUNT(DISTINCT (platform, username_key))::int AS online_accounts,
            COUNT(DISTINCT (platform, username_key)) FILTER (WHERE running)::int AS running_accounts
          FROM eligible_presence
          UNION ALL
          SELECT app_id, COUNT(*)::int AS online_accounts,
            COUNT(*) FILTER (WHERE running)::int AS running_accounts
          FROM eligible_presence GROUP BY app_id`);
        const rows = result.rows || [];
        const row = rows.find(value => value.app_id == null) || {};
        const onlineAccounts = asCount(row.online_accounts);
        const runningAccounts = asCount(row.running_accounts);
        if (runningAccounts > onlineAccounts) throw new Error('invalid_count');
        const applications = [
          { appId: 'autobac', name: 'AutoBac' },
          { appId: 'baccarat-helper', name: '百家輔助' },
          { appId: 'scarab-heart', name: '聖甲之心' },
        ].map(application => {
          // No grouped row means no eligible live lease for this site, not a failed query.
          const site = rows.find(value => value.app_id === application.appId);
          const online = site ? asCount(site.online_accounts) : 0;
          const running = site ? asCount(site.running_accounts) : 0;
          if (running > online || online > onlineAccounts) throw new Error('invalid_count');
          return { ...application, onlineAccounts: online, runningAccounts: running };
        });
        return res.json({
          ok: true,
          scope: "shared-whitelist",
          appId,
          schemaVersion: 2,
          onlineAccounts,
          runningAccounts,
          applications,
          updatedAt: new Date(now()).toISOString(),
          disconnectDetectionSeconds: 20,
        });
      } catch {
        // Do not convert a persistence outage into a credible-looking zero.
        return res.status(503).json({ ok: false, error: "presence_unavailable" });
      }
    },
  );

  wss.on("connection", (socket: any) => {
    let closed = false;
    let authenticated = false;
    let authStarted = false;
    let connectionId = "";
    let sessionId = ""; // memory only; never placed in the presence table or logs.
    let identity: { platform: string; usernameKey: string } | null = null;
    let dbForConnection: Database | null = null;
    let lastPongAt = now();
    let serial: Promise<void> = Promise.resolve();
    let authTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

    const queue = (work: () => Promise<void>) => {
      const next = serial.then(async () => {
        if (closed) return;
        try {
          await work();
        } catch {
          closeConnection(1011, "presence unavailable");
        }
      });
      serial = next.catch(() => undefined);
    };

    const queueDelete = () => {
      serial = serial
        .then(async () => {
          const db = dbForConnection;
          if (!db || !connectionId) return;
          try {
            await db.query("DELETE FROM autobac_user_presence WHERE connection_id=$1", [connectionId]);
          } catch {
            // A failed delete is still hidden by the 25-second lease query.
          }
        })
        .catch(() => undefined);
    };

    const closeConnection = (code?: number, reason?: string) => {
      if (closed) return;
      closed = true;
      if (authTimer) clearTimeout(authTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      queueDelete();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        try {
          socket.close(code, reason);
        } catch {
          try {
            socket.terminate();
          } catch {}
        }
      }
    };

    const dispose = () => closeConnection();
    sockets.add(dispose);

    authTimer = setTimeout(() => closeConnection(1008, "authentication required"), authTimeoutMs);
    (authTimer as any).unref?.();

    heartbeatTimer = setInterval(() => {
      if (closed) return;
      if (now() - lastPongAt >= pongTimeoutMs) {
        closeConnection(1011, "pong timeout");
        return;
      }
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.ping();
        } catch {
          closeConnection();
        }
      }
    }, heartbeatIntervalMs);
    (heartbeatTimer as any).unref?.();

    socket.on("pong", () => {
      lastPongAt = now();
      if (!authenticated || !identity || !sessionId || !connectionId || !dbForConnection) return;
      queue(async () => {
        const verified = await readIdentity(dbForConnection!, sessionId);
        const checked = verified && cleanIdentity(verified);
        if (!checked || checked.platform !== identity!.platform || checked.usernameKey !== identity!.usernameKey) {
          closeConnection(1008, "session invalid");
          return;
        }
        if (closed) return;
        await dbForConnection!.query(
          `UPDATE autobac_user_presence SET last_seen_at=NOW()
           WHERE connection_id=$1 AND platform=$2 AND username_key=$3`,
          [connectionId, identity!.platform, identity!.usernameKey],
        );
      });
    });

    socket.on("message", (data: RawData) => {
      const frame = parseFrame(data);
      if (!authenticated) {
        if (
          authStarted ||
          !frame ||
          !strictObject(frame, ["type", "sessionId"]) ||
          frame.type !== "auth" ||
          typeof frame.sessionId !== "string" ||
          !frame.sessionId ||
          frame.sessionId.length > 128
        ) {
          closeConnection(1008, "invalid authentication frame");
          return;
        }
        authStarted = true;
        connectionId = makeConnectionId();
        // Frame-only credential: this variable stays in this socket closure only.
        sessionId = frame.sessionId;
        queue(async () => {
          const db = getDatabase();
          if (!db) throw new Error("database_unavailable");
          dbForConnection = db;
          await ensureUserPresence(db);
          const verified = await readIdentity(db, sessionId);
          const checked = verified && cleanIdentity(verified);
          if (!checked) {
            closeConnection(1008, "session invalid");
            return;
          }
          if (closed) return;
          identity = checked;
          await db.query(
            `INSERT INTO autobac_user_presence
              (connection_id, platform, username_key, running, last_seen_at, app_id)
             VALUES ($1, $2, $3, FALSE, NOW(), $4)
             ON CONFLICT (connection_id) DO NOTHING`,
            [connectionId, checked.platform, checked.usernameKey, appId],
          );
          if (closed) return;
          authenticated = true;
          if (authTimer) clearTimeout(authTimer);
          if (socket.readyState === WebSocket.OPEN) {
            try {
              socket.send(JSON.stringify({ type: "authenticated" }));
            } catch {
              closeConnection();
            }
          }
        });
        return;
      }

      if (
        !frame ||
        !strictObject(frame, ["type", "running"]) ||
        frame.type !== "state" ||
        typeof frame.running !== "boolean" ||
        !identity ||
        !connectionId ||
        !dbForConnection
      ) {
        closeConnection(1008, "invalid state frame");
        return;
      }

      const running = appId === "autobac" && frame.running;
      queue(async () => {
        if (!identity || !dbForConnection || !connectionId) return;
        // This WHERE clause makes a state frame incapable of modifying another socket's row.
        await dbForConnection.query(
          `UPDATE autobac_user_presence SET running=$1
           WHERE connection_id=$2 AND platform=$3 AND username_key=$4`,
          [running, connectionId, identity.platform, identity.usernameKey],
        );
      });
    });

    socket.once("close", () => {
      sockets.delete(dispose);
      closeConnection();
    });
    socket.once("error", () => closeConnection());
  });

  const onUpgrade = (req: IncomingMessage, socket: Socket, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(req.url || "", "http://localhost");
    } catch {
      return;
    }
    // Do not consume or disturb the DG/external proxy upgrade paths.
    if (url.pathname !== PRESENCE_PATH) return;
    // Session credentials are accepted only in the first WS data frame, never in a URL.
    if (url.search || !isSameOrigin(req, deps.publicOrigin)) {
      rejectUpgrade(socket, url.search ? 400 : 403);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws: any) => wss.emit("connection", ws, req));
  };
  server.on("upgrade", onUpgrade);

  return {
    close() {
      server.off("upgrade", onUpgrade);
      for (const closeSocket of [...sockets]) closeSocket();
      try {
        wss.close();
      } catch {}
    },
  };
}
