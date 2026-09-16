import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const NORMAL_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

export type DgChromiumTransport = { stop: () => void };
export type DgChromiumHooks = {
  sessionId: string;
  gameUrl: string;
  onLog: (message: string) => void;
  onBinary: (data: Buffer) => void;
  onMainUrl?: (url: string) => void;
  onHandshake?: (url: string, status: number) => void;
  onFailure?: (message: string) => void;
};

type CdpMessage = { id?: number; method?: string; params?: any; result?: any; error?: any; sessionId?: string };

function findChromeExecutable() {
  const root = process.cwd();
  const candidates = [
    process.env.DG_CHROME_PATH,
    process.env.CHROME_PATH,
    path.join(root, '.chrome', 'opt', 'google', 'chrome', 'google-chrome'),
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((x): x is string => !!x);
  for (const p of candidates) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  return '';
}

function isDgWs(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === 'wss:' && /(?:^|\.)(?:kindlestone\.com|taxyss\.com|ywjxi\.com)$/i.test(u.hostname);
  } catch { return false; }
}

class CdpClient {
  private ws: any;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Set<(message: CdpMessage) => void>();
  private openPromise: Promise<void>;

  constructor(private readonly url: string) {
    const NativeWebSocket = (globalThis as any).WebSocket;
    if (!NativeWebSocket) throw new Error('Node WebSocket client unavailable');
    this.ws = new NativeWebSocket(url);
    this.openPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome DevTools connection timeout')), 8000);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Chrome DevTools connection failed')); }, { once: true });
    });
    this.ws.addEventListener('message', (evt: any) => {
      let message: CdpMessage;
      try {
        const raw = typeof evt.data === 'string' ? evt.data : Buffer.from(evt.data).toString('utf8');
        message = JSON.parse(raw);
      } catch { return; }
      if (message.id != null) {
        const p = this.pending.get(message.id);
        if (p) {
          clearTimeout(p.timer); this.pending.delete(message.id);
          if (message.error) p.reject(new Error(message.error.message || 'CDP command failed'));
          else p.resolve(message.result || {});
        }
      }
      if (message.method) for (const fn of this.listeners) { try { fn(message); } catch {} }
    });
    this.ws.addEventListener('close', () => {
      for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('Chrome DevTools disconnected')); this.pending.delete(id); }
    });
  }

  async ready() { await this.openPromise; }
  onEvent(fn: (message: CdpMessage) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async send(method: string, params: any = {}, sessionId?: string, timeoutMs = 10000) {
    await this.ready();
    const id = this.nextId++;
    const payload: any = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(payload));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function launchChrome(executable: string, sessionId: string, onLog: (message: string) => void) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `dg-chrome-${sessionId.slice(0, 8)}-`));
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--disable-features=TranslateUI',
    '--disable-blink-features=AutomationControlled',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--password-store=basic',
    '--use-mock-keychain',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--user-agent=${NORMAL_CHROME_UA}`,
    '--window-size=1280,720',
    'about:blank',
  ];

  const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
  let stderr = '';
  let resolved = false;
  const wsUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`Chromium launch timeout${stderr ? `: ${stderr.slice(-500)}` : ''}`));
    }, 12000);
    const inspect = (chunk: Buffer) => {
      const text = chunk.toString('utf8'); stderr += text;
      const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/i);
      if (m?.[1] && !resolved) {
        resolved = true; clearTimeout(timer); resolve(m[1]);
      }
    };
    child.stderr.on('data', inspect);
    child.stdout.on('data', inspect);
    child.once('exit', (code, signal) => {
      if (resolved) return;
      resolved = true; clearTimeout(timer);
      reject(new Error(`Chromium exited before DevTools was ready (code=${code}, signal=${signal})${stderr ? `: ${stderr.slice(-500)}` : ''}`));
    });
    child.once('error', err => {
      if (resolved) return;
      resolved = true; clearTimeout(timer); reject(err);
    });
  });
  onLog(`Chromium 已啟動｜pid=${child.pid}｜exe=${executable}`);
  return { child, profile, wsUrl };
}

export async function startDgChromiumTransport(hooks: DgChromiumHooks): Promise<DgChromiumTransport> {
  const executable = findChromeExecutable();
  if (!executable) throw new Error('找不到 Chrome/Chromium；請確認 postinstall 已完成');

  hooks.onLog('正在以真正 Chromium 開啟 DG 頁面');
  const launched = await launchChrome(executable, hooks.sessionId, hooks.onLog);
  const cdp = new CdpClient(launched.wsUrl);
  await cdp.ready();

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const pageSessionId = String(attached.sessionId || '');
  if (!pageSessionId) throw new Error('Chromium target attach failed');

  let stopped = false;
  let got101 = false;
  let finalUrl = hooks.gameUrl;
  const dgRequests = new Map<string, string>();
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (watchdog) clearTimeout(watchdog);
    try { cdp.close(); } catch {}
    try { launched.child.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { if (!launched.child.killed) launched.child.kill('SIGKILL'); } catch {} }, 1200).unref?.();
    try { fs.rmSync(launched.profile, { recursive: true, force: true }); } catch {}
  };

  cdp.onEvent((message) => {
    if (stopped || message.sessionId !== pageSessionId) return;
    const p = message.params || {};
    if (message.method === 'Page.frameNavigated') {
      const frame = p.frame || {};
      if (!frame.parentId && /^https:\/\//i.test(String(frame.url || ''))) {
        finalUrl = String(frame.url);
        hooks.onMainUrl?.(finalUrl);
        hooks.onLog(`Chromium 頁面：${finalUrl}`);
      }
      return;
    }
    if (message.method === 'Network.webSocketCreated') {
      const url = String(p.url || '');
      if (isDgWs(url)) {
        dgRequests.set(String(p.requestId), url);
        hooks.onLog(`Chromium WSS 建立：${new URL(url).hostname}`);
      }
      return;
    }
    if (message.method === 'Network.webSocketHandshakeResponseReceived') {
      const requestId = String(p.requestId || '');
      const url = dgRequests.get(requestId);
      if (!url) return;
      const status = Number(p.response?.status || 0);
      hooks.onLog(`Chromium WebSocket ${status || '?'}：${new URL(url).hostname}｜Origin=${(() => { try { return new URL(finalUrl).origin; } catch { return ''; } })()}`);
      hooks.onHandshake?.(url, status);
      if (status === 101) {
        got101 = true;
        if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      }
      return;
    }
    if (message.method === 'Network.webSocketFrameReceived') {
      const requestId = String(p.requestId || '');
      if (!dgRequests.has(requestId)) return;
      const response = p.response || {};
      if (Number(response.opcode) !== 2 || !response.payloadData) return;
      try { hooks.onBinary(Buffer.from(String(response.payloadData), 'base64')); } catch {}
      return;
    }
    if (message.method === 'Network.webSocketFrameError') {
      const requestId = String(p.requestId || '');
      const url = dgRequests.get(requestId);
      if (url) hooks.onLog(`Chromium WSS 錯誤：${new URL(url).hostname}｜${String(p.errorMessage || 'unknown')}`);
      return;
    }
    if (message.method === 'Network.webSocketClosed') {
      const requestId = String(p.requestId || '');
      const url = dgRequests.get(requestId);
      if (url) hooks.onLog(`Chromium WSS 已關閉：${new URL(url).hostname}`);
    }
  });

  await cdp.send('Network.enable', {}, pageSessionId);
  await cdp.send('Page.enable', {}, pageSessionId);
  await cdp.send('Runtime.enable', {}, pageSessionId);
  await cdp.send('Network.setUserAgentOverride', { userAgent: NORMAL_CHROME_UA, acceptLanguage: 'zh-TW,zh;q=0.9', platform: 'Windows' }, pageSessionId);
  await cdp.send('Network.setBlockedURLs', {
    urls: ['*.flv', '*.mp4', '*.m3u8', '*.ts', '*.jpg', '*.jpeg', '*.png', '*.gif', '*.webp', '*.woff', '*.woff2', '*.ttf']
  }, pageSessionId).catch(() => {});
  await cdp.send('Page.navigate', { url: hooks.gameUrl }, pageSessionId, 15000);
  hooks.onLog(`Chromium 已導航至 DG direct1｜host=${new URL(hooks.gameUrl).hostname}`);

  watchdog = setTimeout(() => {
    if (stopped || got101) return;
    const message = 'Chromium 15 秒內仍未取得 DG WebSocket 101';
    hooks.onLog(message);
    hooks.onFailure?.(message);
  }, 15000);

  launched.child.once('exit', (code, signal) => {
    if (stopped) return;
    hooks.onFailure?.(`Chromium 意外結束 (code=${code}, signal=${signal})`);
  });

  return { stop };
}
