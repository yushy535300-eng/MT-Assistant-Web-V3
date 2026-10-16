import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
// @ts-expect-error This project has ws installed but does not include its declaration package.
import WebSocket from "ws";
import { registerUserPresence } from "../server/user-presence";

type QueryCall = [string, any[] | undefined];
type MockDb = { query: ReturnType<typeof vi.fn>; calls: QueryCall[] };

const identity = { platform: "OFA", username: "OwnerCase" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function eventually(check: () => boolean, message = "condition was not reached") {
  for (let i = 0; i < 80; i++) {
    if (check()) return;
    await sleep(10);
  }
  throw new Error(message);
}

function createMockDb(summary = { online_accounts: "1", running_accounts: "1" }): MockDb {
  const calls: QueryCall[] = [];
  const query = vi.fn(async (sql: string, values?: any[]) => {
    calls.push([sql, values]);
    if (sql.includes('WITH eligible_presence AS')) return { rows: [{app_id:null,...summary},{app_id:'autobac',...summary}] };
    return { rows: [] };
  });
  return { query, calls };
}

function once<T = any>(socket: any, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event as any, (...args: any[]) => resolve(args[0] as T)));
}

async function rejectedStatus(url: string, origin: string) {
  return new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(url, { origin });
    socket.once("unexpected-response", (_request: any, response: any) => {
      const status = response.statusCode || 0;
      socket.terminate();
      resolve(status);
    });
    socket.once("error", (error: any) => {
      // ws reports only an error when the peer closes before it can expose the response.
      if (!String(error.message).includes("Unexpected server response")) reject(error);
    });
  });
}

async function openSocket(wsUrl: string, origin: string) {
  const socket = new WebSocket(wsUrl, { origin });
  await once(socket, "open");
  return socket;
}

async function fixture(options: {
  db?: MockDb;
  readIdentity?: ReturnType<typeof vi.fn>;
  heartbeatIntervalMs?: number;
  pongTimeoutMs?: number;
  authTimeoutMs?: number;
  appId?: "autobac" | "baccarat-helper" | "scarab-heart";
  connectionId?: string;
  publicOrigin?: string;
} = {}) {
  const app = express();
  const server = createServer(app);
  const db = options.db || createMockDb();
  const readIdentity = options.readIdentity || vi.fn(async () => identity);
  const controller = registerUserPresence(
    app,
    server,
    ((req: any, res: any, next: any) =>
      req.get("X-Admin-Token") === "anonymous-admin" ? next() : res.status(401).end()) as any,
    {
      db: db as any,
      appId: options.appId,
      publicOrigin: options.publicOrigin,
      readRiskTrackerIdentity: readIdentity as any,
      createConnectionId: () => options.connectionId || "51c585a2-2d0b-4b8c-807e-e6ad6e90b2f0",
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? 15,
      pongTimeoutMs: options.pongTimeoutMs ?? 90,
      authTimeoutMs: options.authTimeoutMs ?? 100,
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  const origin = `http://127.0.0.1:${port}`;
  return {
    db,
    readIdentity,
    origin,
    wsUrl: `ws://127.0.0.1:${port}/api/presence/ws`,
    async close() {
      controller.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe("AutoBac authenticated connection presence", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("uses a real localhost socket for auth/state/pong/close and an admin-only, no-store summary", async () => {
    const test = await fixture();
    cleanups.push(test.close);
    const socket = await openSocket(test.wsUrl, test.origin);

    socket.send(JSON.stringify({ type: "auth", sessionId: "opaque-current-session" }));
    const authenticated = JSON.parse(String(await once(socket, "message")));
    expect(authenticated).toEqual({ type: "authenticated" });
    await eventually(() => test.db.calls.some(([sql]) => sql.includes("INSERT INTO autobac_user_presence")));
    const insert = test.db.calls.find(([sql]) => sql.includes("INSERT INTO autobac_user_presence"))!;
    expect(insert[0]).not.toContain("session_id");
    expect(insert[1]).toEqual(["51c585a2-2d0b-4b8c-807e-e6ad6e90b2f0", "OFA", "ownercase", "autobac"]);

    socket.send(JSON.stringify({ type: "state", running: true }));
    await eventually(() => test.db.calls.some(([sql]) => /SET running=\$1/.test(sql)));
    const state = test.db.calls.find(([sql]) => /SET running=\$1/.test(sql))!;
    expect(state[1]).toEqual([true, "51c585a2-2d0b-4b8c-807e-e6ad6e90b2f0", "OFA", "ownercase"]);
    // The ws client automatically answers server pings. Each pong re-checks current session.
    await eventually(() => test.readIdentity.mock.calls.length >= 2, "pong did not revalidate the session");
    expect(test.db.calls.some(([sql]) => /SET last_seen_at=NOW\(\)/.test(sql))).toBe(true);

    const denied = await fetch(`${test.origin}/api/admin/presence`);
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    const allowed = await fetch(`${test.origin}/api/admin/presence`, {
      headers: { "X-Admin-Token": "anonymous-admin" },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("cache-control")).toBe("no-store");
    expect(await allowed.json()).toMatchObject({
      ok: true,
      scope: "shared-whitelist",
      onlineAccounts: 1,
      runningAccounts: 1,
      disconnectDetectionSeconds: 20,
    });

    socket.close();
    await once(socket, "close");
    await eventually(() =>
      test.db.calls.some(([sql, values]) => sql === "DELETE FROM autobac_user_presence WHERE connection_id=$1" && values?.[0] === "51c585a2-2d0b-4b8c-807e-e6ad6e90b2f0"),
    );
  });

  it("rejects cross-origin upgrades, URL credential channels, and non-exact auth frames", async () => {
    const test = await fixture();
    cleanups.push(test.close);
    expect(await rejectedStatus(test.wsUrl, "http://attacker.invalid")).toBe(403);
    expect(await rejectedStatus(test.wsUrl, test.origin.replace("http:", "https:"))).toBe(403);
    expect(await rejectedStatus(`${test.wsUrl}?sessionId=leak`, test.origin)).toBe(400);

    const socket = await openSocket(test.wsUrl, test.origin);
    socket.send(JSON.stringify({ type: "auth", sessionId: "opaque-current-session", extra: true }));
    await once(socket, "close");
    expect(test.readIdentity).not.toHaveBeenCalled();
    expect(test.db.calls.some(([sql]) => sql.includes("INSERT INTO autobac_user_presence"))).toBe(false);
  });

  it("accepts the configured public HTTPS origin behind a plaintext reverse proxy and rejects HTTP for that authority", async () => {
    const app=express();const server=createServer(app);const db=createMockDb();
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const port=(server.address() as any).port;const host=`127.0.0.1:${port}`;
    const controller=registerUserPresence(app,server,((_req:any,_res:any,next:any)=>next()) as any,{db:db as any,readRiskTrackerIdentity:async()=>identity,publicOrigin:`https://${host}`});
    cleanups.push(async()=>{controller.close();await new Promise<void>(resolve=>server.close(()=>resolve()));});
    expect(await rejectedStatus(`ws://${host}/api/presence/ws`,`http://${host}`)).toBe(403);
    const socket=await openSocket(`ws://${host}/api/presence/ws`,`https://${host}`);
    socket.send(JSON.stringify({type:'auth',sessionId:'anonymous-current-session'}));
    expect(JSON.parse(String(await once(socket,'message')))).toEqual({type:'authenticated'});
    socket.close();await once(socket,'close');
  });

  it("does not resurrect a row when the socket closes while async identity verification is pending", async () => {
    let resolveIdentity!: (value: typeof identity | null) => void;
    const readIdentity = vi.fn(
      () => new Promise<typeof identity | null>((resolve) => {
        resolveIdentity = resolve;
      }),
    );
    const test = await fixture({ readIdentity, authTimeoutMs: 500 });
    cleanups.push(test.close);
    const socket = await openSocket(test.wsUrl, test.origin);
    socket.send(JSON.stringify({ type: "auth", sessionId: "opaque-current-session" }));
    await eventually(() => readIdentity.mock.calls.length === 1);
    socket.terminate();
    await once(socket, "close");
    resolveIdentity(identity);
    await sleep(30);
    expect(test.db.calls.some(([sql]) => sql.includes("INSERT INTO autobac_user_presence"))).toBe(false);
  });

  it("uses account/platform grouping plus enabled, unexpired whitelist and per-site authenticated session verification", async () => {
    const db = createMockDb({ online_accounts: "7", running_accounts: "3" });
    const test = await fixture({ db });
    cleanups.push(test.close);
    const response = await fetch(`${test.origin}/api/admin/presence`, {
      headers: { "X-Admin-Token": "anonymous-admin" },
    });
    expect(await response.json()).toMatchObject({ onlineAccounts: 7, runningAccounts: 3, scope: "shared-whitelist" });
    const sql = db.calls.find(([text]) => text.includes('WITH eligible_presence AS'))![0];
    expect(sql).toContain("BOOL_OR(p.running AND p.app_id='autobac')");
    expect(sql).toContain("GROUP BY p.app_id, p.platform, p.username_key");
    expect(sql).toContain("COUNT(DISTINCT (platform, username_key))");
    expect(sql).toContain("w.enabled=TRUE");
    expect(sql).toContain("w.expires_at>NOW()");
    expect(sql).toContain("tz_whitelist w");
    expect(sql).toContain("INTERVAL '25 seconds'");
    expect(sql).not.toContain("p.session_id");
  });

  it("aggregates three real localhost endpoints, deduplicates one account across sites and ignores non-AutoBac running claims", async () => {
    const rows=new Map<string,{platform:string,user:string,running:boolean,site:string}>();
    const calls:QueryCall[]=[];
    const db={calls,query:vi.fn(async(sql:string,values?:any[])=>{
      calls.push([sql,values]);
      if(sql.includes('INSERT INTO autobac_user_presence'))rows.set(values![0],{platform:values![1],user:values![2],running:false,site:values![3]});
      else if(sql.includes('SET running=$1')){const row=rows.get(values![1]);if(row)row.running=values![0];}
      else if(sql==='DELETE FROM autobac_user_presence WHERE connection_id=$1')rows.delete(values![0]);
      if(sql.includes('WITH eligible_presence AS')){
        const accounts=new Map<string,boolean>();for(const row of rows.values()){const key=row.platform+':'+row.user;accounts.set(key,!!accounts.get(key)||row.running);}
        const sites=new Map<string,Map<string,boolean>>();
        for(const row of rows.values()){const group=sites.get(row.site)||new Map<string,boolean>();const key=row.platform+':'+row.user;group.set(key,!!group.get(key)||row.running);sites.set(row.site,group);}
        return {rows:[{app_id:null,online_accounts:accounts.size,running_accounts:[...accounts.values()].filter(Boolean).length},...Array.from(sites,([app_id,group])=>({app_id,online_accounts:group.size,running_accounts:[...group.values()].filter(Boolean).length}))]};
      }
      return {rows:[]};
    })};
    const sites=['autobac','baccarat-helper','scarab-heart','autobac'] as const;
    const fixtures: Array<Awaited<ReturnType<typeof fixture>>> = [];
    for(let i=0;i<sites.length;i++){
      const test=await fixture({db,appId:sites[i],connectionId:`00000000-0000-4000-8000-00000000000${i}`,readIdentity:vi.fn(async()=>i===2?{platform:'TZ',username:'Another'}:identity)});
      cleanups.push(test.close);fixtures.push(test);
    }
    const sockets=[];
    for(const test of fixtures){const socket=await openSocket(test.wsUrl,test.origin);socket.send(JSON.stringify({type:'auth',sessionId:'anonymous-session'}));await once(socket,'message');sockets.push(socket);}
    sockets[0].send(JSON.stringify({type:'state',running:true}));sockets[1].send(JSON.stringify({type:'state',running:true}));
    await eventually(()=>rows.get('00000000-0000-4000-8000-000000000000')?.running===true);
    await sleep(20);
    const summary=async()=>await(await fetch(fixtures[0].origin+'/api/admin/presence',{headers:{'X-Admin-Token':'anonymous-admin'}})).json();
    const first=await summary();
    expect(first).toMatchObject({schemaVersion:2,onlineAccounts:2,runningAccounts:1});
    expect(first.applications).toEqual([
      {appId:'autobac',name:'AutoBac',onlineAccounts:1,runningAccounts:1},
      {appId:'baccarat-helper',name:'百家輔助',onlineAccounts:1,runningAccounts:0},
      {appId:'scarab-heart',name:'聖甲之心',onlineAccounts:1,runningAccounts:0},
    ]);
    // The same account visits AutoBac and helper: per-site sum 3, union 2.
    expect(first.applications.reduce((sum:number,site:any)=>sum+site.onlineAccounts,0)).toBe(3);
    expect(rows.get('00000000-0000-4000-8000-000000000001')?.running).toBe(false);
    expect(new Set([...rows.values()].map(r=>r.site))).toEqual(new Set(sites));
    sockets[0].close();await once(sockets[0],'close');await eventually(()=>rows.size===3);
    expect(await summary()).toMatchObject({onlineAccounts:2,runningAccounts:0,applications:[{appId:'autobac',onlineAccounts:1,runningAccounts:0},{appId:'baccarat-helper',onlineAccounts:1},{appId:'scarab-heart',onlineAccounts:1}]});
    sockets[1].close();await once(sockets[1],'close');await eventually(()=>rows.size===2);
    expect(await summary()).toMatchObject({onlineAccounts:2,runningAccounts:0});
    sockets[3].close();await once(sockets[3],'close');await eventually(()=>rows.size===1);
    expect(await summary()).toMatchObject({onlineAccounts:1,runningAccounts:0});
    sockets[2].close();await once(sockets[2],'close');await eventually(()=>rows.size===0);
    expect(await summary()).toMatchObject({onlineAccounts:0,runningAccounts:0,applications:[{onlineAccounts:0},{onlineAccounts:0},{onlineAccounts:0}]});
  });

  it("returns 503 rather than a misleading zero when the database fails", async () => {
    const db = createMockDb();
    db.query.mockRejectedValue(new Error("private failure"));
    const test = await fixture({ db });
    cleanups.push(test.close);
    const response = await fetch(`${test.origin}/api/admin/presence`, {
      headers: { "X-Admin-Token": "anonymous-admin" },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "presence_unavailable" });
  });
});
