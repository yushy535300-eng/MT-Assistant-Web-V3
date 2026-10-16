import type { Express, RequestHandler, Request, Response } from 'express';

export type AuditDatabase = { query: (text: string, values?: unknown[]) => Promise<{ rows?: any[] }> };
export type AuditKind = 'usage' | 'settings' | 'acknowledgements';

type AuditAccount = { id: number | string; platform: string; username: string };
type AuditRead = {
  account: AuditAccount;
  total: number;
  page: number;
  pages: number;
  rows: any[];
  unavailable: boolean;
  settingsAvailable?: boolean;
};

export type AdminAuditReaderDeps = { getPool: () => AuditDatabase | null };
const PAGE_SIZE = 30;
// Reports arrive every 15–30 seconds; after three missed maximum cadence windows, active is no longer live.
const USAGE_OFFLINE_MS = 90_000;

export function escapeAdminAuditText(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]!));
}

export function adminAuditTime(value: unknown): string {
  const date = new Date(String(value ?? ''));
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })
    : '時間無法辨識';
}

function epochAuditTime(value: unknown): string {
  if (value === null || value === undefined || value === '') return '未回傳';
  const milliseconds = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0 && milliseconds <= 8_640_000_000_000_000
    ? adminAuditTime(new Date(milliseconds).toISOString())
    : '未回傳';
}

function formatElapsed(value: unknown): string {
  if (value === null || value === undefined || value === '') return '未回傳';
  const milliseconds = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return '未回傳';
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map(part => String(part).padStart(2, '0')).join(':');
}

function safePage(value: unknown): number | null {
  const page = Number(value || 1);
  return Number.isSafeInteger(page) && page >= 1 ? page : null;
}

/** This is intentionally metadata-only: it never creates or alters a shared table. */
async function hasRelation(db: AuditDatabase, name: string): Promise<boolean> {
  const result = await db.query('SELECT to_regclass($1) AS relation', [`public.${name}`]);
  return !!result.rows?.[0]?.relation;
}

function relationFor(kind: Exclude<AuditKind, 'usage'>): string {
  return kind === 'settings' ? 'autobac_dg_settings_records' : 'autobac_risk_acknowledgements';
}

function rowsForKind(kind: Exclude<AuditKind, 'usage'>, table: string): string {
  return kind === 'settings'
    ? `SELECT id, event_id, event_type, statement_version, snapshot, snapshot_sha256, recorded_at
        FROM ${table} WHERE platform=$1 AND username_key=$2
        ORDER BY recorded_at DESC, id DESC LIMIT ${PAGE_SIZE} OFFSET $3`
    : `SELECT id, event_id, game_platform, event_type, statement_version, statement_text,
        statement_sha256, recorded_at FROM ${table} WHERE platform=$1 AND username_key=$2
        ORDER BY recorded_at DESC, id DESC LIMIT ${PAGE_SIZE} OFFSET $3`;
}

function usageSource(settingsAvailable: boolean): string {
  const usageColumns = `u.id AS record_id, 'usage'::text AS record_source, u.run_id, u.settings_event_id,
    u.statement_version, u.status, u.sequence, u.client_started_at_ms, u.client_updated_at_ms,
    u.client_ended_at_ms, u.elapsed_ms, u.report, u.first_received_at, u.server_updated_at,
    u.stopped_received_at, u.server_updated_at AS recorded_at`;
  if (!settingsAvailable) {
    return `SELECT ${usageColumns}, NULL::jsonb AS settings_snapshot, NULL::timestamptz AS settings_recorded_at
      FROM autobac_dg_usage_records u WHERE u.platform=$1 AND u.username_key=$2`;
  }
  return `SELECT ${usageColumns}, s.snapshot AS settings_snapshot, s.recorded_at AS settings_recorded_at
    FROM autobac_dg_usage_records u
    LEFT JOIN autobac_dg_settings_records s
      ON s.platform=u.platform AND s.username_key=u.username_key AND s.event_id=u.settings_event_id
    WHERE u.platform=$1 AND u.username_key=$2
    UNION ALL
    SELECT s.id AS record_id, 'settings_only'::text AS record_source, NULL::uuid AS run_id,
      s.event_id AS settings_event_id, s.statement_version, NULL::text AS status,
      NULL::int AS sequence, NULL::bigint AS client_started_at_ms, NULL::bigint AS client_updated_at_ms,
      NULL::bigint AS client_ended_at_ms, NULL::bigint AS elapsed_ms, NULL::jsonb AS report,
      NULL::timestamptz AS first_received_at, NULL::timestamptz AS server_updated_at,
      NULL::timestamptz AS stopped_received_at, s.recorded_at, s.snapshot AS settings_snapshot,
      s.recorded_at AS settings_recorded_at
    FROM autobac_dg_settings_records s
    WHERE s.platform=$1 AND s.username_key=$2
      AND NOT EXISTS (SELECT 1 FROM autobac_dg_usage_records u
        WHERE u.platform=s.platform AND u.username_key=s.username_key AND u.settings_event_id=s.event_id)`;
}

/**
 * Cross-site audit reads share the existing whitelist identity, but never initialize,
 * seed, change, or authorize that whitelist. An absent optional audit table is reported
 * as unavailable rather than manufactured as an empty successful history.
 */
export async function readAdminAuditRecords(
  db: AuditDatabase,
  whitelistId: number,
  requestedPage: number,
  kind: AuditKind,
): Promise<AuditRead | null> {
  if (!await hasRelation(db, 'tz_whitelist')) throw new Error('whitelist_table_unavailable');
  const account = (await db.query(
    'SELECT id, platform, username FROM tz_whitelist WHERE id=$1 LIMIT 1',
    [whitelistId],
  )).rows?.[0] as AuditAccount | undefined;
  if (!account) return null;
  const identity = [String(account.platform).toUpperCase(), String(account.username).toLowerCase()];

  if (kind === 'usage') {
    const [usageAvailable, settingsAvailable] = await Promise.all([
      hasRelation(db, 'autobac_dg_usage_records'),
      hasRelation(db, 'autobac_dg_settings_records'),
    ]);
    if (!usageAvailable) {
      if (settingsAvailable) {
        const legacy = await readAdminAuditRecords(db, whitelistId, requestedPage, 'settings');
        if (!legacy) return null;
        return {
          ...legacy, settingsAvailable: true,
          rows: legacy.rows.map(row => ({
            ...row, record_source: 'settings_only', settings_snapshot: row.snapshot,
            settings_event_id: row.event_id,
          })),
        };
      }
      return { account, total: 0, page: 1, pages: 1, rows: [], unavailable: true, settingsAvailable };
    }
    const source = usageSource(settingsAvailable);
    const total = Number((await db.query(`SELECT COUNT(*)::int AS total FROM (${source}) AS audit_records`, identity)).rows?.[0]?.total ?? 0);
    const safeTotal = Number.isSafeInteger(total) && total >= 0 ? total : 0;
    const pages = Math.max(1, Math.ceil(safeTotal / PAGE_SIZE));
    const page = Math.min(Math.max(1, requestedPage), pages);
    const rows = (await db.query(
      `SELECT * FROM (${source}) AS audit_records
       ORDER BY COALESCE(server_updated_at, recorded_at) DESC, record_id DESC LIMIT ${PAGE_SIZE} OFFSET $3`,
      [...identity, (page - 1) * PAGE_SIZE],
    )).rows || [];
    return { account, total: safeTotal, page, pages, rows, unavailable: false, settingsAvailable };
  }

  const table = relationFor(kind);
  if (!await hasRelation(db, table)) {
    return { account, total: 0, page: 1, pages: 1, rows: [], unavailable: true };
  }
  const total = Number((await db.query(
    `SELECT COUNT(*)::int AS total FROM ${table} WHERE platform=$1 AND username_key=$2`,
    identity,
  )).rows?.[0]?.total ?? 0);
  const safeTotal = Number.isSafeInteger(total) && total >= 0 ? total : 0;
  const pages = Math.max(1, Math.ceil(safeTotal / PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), pages);
  const rows = (await db.query(rowsForKind(kind, table), [...identity, (page - 1) * PAGE_SIZE])).rows || [];
  return { account, total: safeTotal, page, pages, rows, unavailable: false };
}

function parsedObject(value: unknown): Record<string, any> | null {
  let candidate = value;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch { return null; }
  }
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as Record<string, any>
    : null;
}

function stringValue(value: unknown, empty = '未回傳'): string {
  return value === undefined || value === null || value === '' ? empty : String(value);
}

function moneyValue(value: unknown): string {
  return value === null ? '未設定' : stringValue(value);
}

/** Mirrors the shared dgSettingsFields output, while remaining deployable in the two non-AutoBac sites. */
function settingFields(snapshot: unknown): Array<[string, string]> | null {
  const value = parsedObject(snapshot);
  if (!value) return null;
  const selectedTables = Array.isArray(value.selectedTables)
    ? value.selectedTables.map(table => {
      const record = parsedObject(table) || {};
      return `${stringValue(record.tableName)}（ID ${stringValue(record.tableId)}）`;
    }).join('、') || '尚未選擇桌台'
    : '未回傳';
  const runMode = value.runMode === 'continuous' ? '持續執行' : value.runMode === 'once' ? '單次執行' : stringValue(value.runMode);
  const startMode = value.startMode === 'fresh' ? '全新開始' : value.startMode === 'resume' ? '繼續執行' : stringValue(value.startMode);
  const staking = value.staking === 'flat' ? '平注' : value.staking === 'martingale' ? '馬丁格爾' : value.staking === 'doubling' ? '加倍' : stringValue(value.staking);
  const selectionMode = value.selectionMode === 'auto' ? '自動' : value.selectionMode === 'manual' ? '手動' : stringValue(value.selectionMode);
  const tableCount = value.tableCount === 'all' ? '全部桌台' : value.tableCount === undefined || value.tableCount === null ? '未回傳' : `${value.tableCount} 桌`;
  const duration = value.durationMinutes === 0 ? '不限時' : stringValue(value.durationMinutes);
  return [
    ['設定版本', stringValue(value.version)], ['遊戲平台', stringValue(value.gamePlatform)],
    ['執行模式', runMode], ['啟動方式', startMode], ['策略提供者', ({combined:'AI綜合',gpt:'GPT',chatgpt:'GPT',claude:'Claude',grok:'Grok',meta:'Meta',deepseek:'DeepSeek',gemini:'Gemini',parity:'終值奇偶',counting:'四式算牌',road:'牌路推薦'} as Record<string,string>)[String(value.provider)] || stringValue(value.provider)],
    ['桌台數量', tableCount], ['選桌方式', selectionMode], ['已選桌台', selectedTables],
    ['基本金額', stringValue(value.baseAmount)], ['配注方式', staking], ['單注上限', stringValue(value.maxStake)],
    ['止損', moneyValue(value.stopLoss)], ['止盈', moneyValue(value.takeProfit)],
    ['自動停止時間（分鐘）', duration], ['最少剩餘秒數', stringValue(value.minSeconds)], ['幣別', stringValue(value.currency)],
  ];
}

function rawSnapshot(snapshot: unknown): string {
  try { return JSON.stringify(snapshot); } catch { return String(snapshot ?? ''); }
}

function settingsDetails(snapshot: unknown): string {
  const fields = settingFields(snapshot);
  return fields
    ? `<dl>${fields.map(([key, value]) => `<dt>${escapeAdminAuditText(key)}</dt><dd>${escapeAdminAuditText(value)}</dd>`).join('')}</dl>`
    : `<p class="bad">設定快照格式無法辨識或未回傳</p><pre>${escapeAdminAuditText(rawSnapshot(snapshot))}</pre>`;
}

function settingsSummary(snapshot: unknown): { brief: string; limits: string } {
  const fields = settingFields(snapshot);
  if (!fields) return { brief: '設定摘要未回傳', limits: '設定欄位未回傳' };
  const duration = fields[13][1] === '不限時' ? '不限時' : fields[13][1] === '未回傳' ? '設定分鐘未回傳' : `設定 ${fields[13][1]} 分鐘`;
  return {
    brief: `策略 ${fields[4][1]} · 配注 ${fields[9][1]} · 每注額 ${fields[8][1]} · ${fields[5][1]}`,
    limits: `止損 ${fields[11][1]} / 止盈 ${fields[12][1]} / ${duration}`,
  };
}

function renderSettingsCard(row: any): string {
  const summary = settingsSummary(row.snapshot);
  return `<article class="record"><div class="meta"><time>${escapeAdminAuditText(adminAuditTime(row.recorded_at))}</time><span class="badge">開始設定已記錄</span></div><div class="summary">${escapeAdminAuditText(summary.brief)}</div><div class="limits">${escapeAdminAuditText(summary.limits)}</div><details><summary>詳細設定</summary>${settingsDetails(row.snapshot)}<small>聲明版本：${escapeAdminAuditText(stringValue(row.statement_version))}</small></details></article>`;
}

function safeReportedValue(report: Record<string, any> | null, field: string): string {
  const result = report && parsedObject(report.result);
  const value = result?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '未回傳';
}

function usageStatus(row: any): string {
  if (row.status === 'stopped') {
    const code = row.stop_code ?? parsedObject(row.report).stopCode;
    const labels: Record<string, string> = {
      manual: '手動停止', time_limit: '設定時間到', stop_loss: '止損保護',
      take_profit: '達止盈', stake_cap: '單注上限', other: '停止保護',
    };
    return typeof code === 'string' && typeof labels[code] === 'string'
      ? `已停止 · ${labels[code]}` : '已停止';
  }
  if (row.status === 'interrupted') return '回報中斷 · 保留最後觀測時間';
  if (row.status !== 'active') return '狀態未回傳';
  const updated = new Date(String(row.server_updated_at ?? '')).getTime();
  return Number.isFinite(updated) && Date.now() - updated > USAGE_OFFLINE_MS
    ? `失聯／最後回傳於 ${adminAuditTime(row.server_updated_at)}`
    : '進行中（客戶端回報）';
}

function renderUsageCard(row: any): string {
  const summary = settingsSummary(row.settings_snapshot);
  if (row.record_source === 'settings_only') {
    return `<article class="record"><div class="meta"><time>${escapeAdminAuditText(adminAuditTime(row.recorded_at))}</time><span class="badge warn">此舊設定尚無使用回傳</span></div><div class="summary">${escapeAdminAuditText(summary.brief)}</div><div class="limits">${escapeAdminAuditText(summary.limits)}</div><details><summary>完整設定</summary>${settingsDetails(row.settings_snapshot)}<small>設定事件 ID：${escapeAdminAuditText(stringValue(row.settings_event_id))}</small></details></article>`;
  }
  const report = parsedObject(row.report);
  const pending = safeReportedValue(report, 'pendingCount');
  const uncertain = safeReportedValue(report, 'uncertainCount');
  const settledPnl = safeReportedValue(report, 'settledPnl');
  const joinedSettings = row.settings_snapshot === null || row.settings_snapshot === undefined
    ? '<small class="bad">對應設定快照未回傳；不補造設定欄位。</small>'
    : `<details><summary>完整設定</summary>${settingsDetails(row.settings_snapshot)}<small>設定事件 ID：${escapeAdminAuditText(stringValue(row.settings_event_id))}</small></details>`;
  return `<article class="record"><div class="meta"><time>實際開始：${escapeAdminAuditText(epochAuditTime(row.client_started_at_ms))}</time><span class="badge">${escapeAdminAuditText(usageStatus(row))}</span></div><div class="summary">實際使用時間：${escapeAdminAuditText(formatElapsed(row.elapsed_ms))}</div><div class="limits">本次已結算輸贏：${escapeAdminAuditText(settledPnl)}（客戶端回報，非 DG 官方報表）<br>待結算：${escapeAdminAuditText(pending)} ／ 歸屬不明：${escapeAdminAuditText(uncertain)}（客戶端回報，未併入已結算損益）</div><div class="limits">${escapeAdminAuditText(summary.brief)}<br>${escapeAdminAuditText(summary.limits)}</div>${joinedSettings}<details><summary>回傳資訊</summary><dl><dt>Run ID</dt><dd>${escapeAdminAuditText(stringValue(row.run_id))}</dd><dt>最新序號</dt><dd>${escapeAdminAuditText(stringValue(row.sequence))}</dd><dt>最後客戶端更新</dt><dd>${escapeAdminAuditText(epochAuditTime(row.client_updated_at_ms))}</dd><dt>後台最後接收</dt><dd>${escapeAdminAuditText(adminAuditTime(row.server_updated_at))}</dd></dl></details></article>`;
}

function renderAcknowledgementCard(row: any): string {
  return `<article class="record"><div class="meta"><time>${escapeAdminAuditText(adminAuditTime(row.recorded_at))}</time><span class="badge">${escapeAdminAuditText(stringValue(row.game_platform))} · 已勾選</span></div><details><summary>查看當時聲明</summary><pre>${escapeAdminAuditText(stringValue(row.statement_text))}</pre><small>聲明版本：${escapeAdminAuditText(stringValue(row.statement_version))}</small><small>SHA-256：${escapeAdminAuditText(stringValue(row.statement_sha256))}</small></details></article>`;
}

/** All dynamic data is escaped before it enters this HTML-only administrator page. */
export function adminAuditDetailsPage(data: AuditRead, kind: AuditKind): string {
  const root = `/api/admin/whitelist/${encodeURIComponent(String(data.account.id))}`;
  const current = `${root}/${kind === 'usage' ? 'records' : kind}`;
  const title = kind === 'usage' ? '使用紀錄' : kind === 'settings' ? '使用設定' : '免責確認';
  const content = data.unavailable
    ? `<div class="empty">${kind === 'usage' ? '此站尚未啟用使用回傳審核；不以空白、0 分鐘或 0 損益補造。' : '此站尚未啟用此類審核紀錄；不以空白或 0 補造。'}</div>`
    : data.rows.map(row => kind === 'usage' ? renderUsageCard(row) : kind === 'settings' ? renderSettingsCard(row) : renderAcknowledgementCard(row)).join('')
      || '<div class="empty">尚無紀錄；部署前的操作不會補造。</div>';
  const hint = '資料來源：AutoBac DG 客戶端回報，非官方報表；待結算／歸屬不明不算入輸贏。缺資料標示未回傳，不補造。';
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title><style>
*{box-sizing:border-box}body{margin:0;background:#080e13;color:#ecf0ed;font:14px system-ui,-apple-system,"Noto Sans TC",sans-serif}main{max-width:760px;margin:auto;padding:24px 16px}a{color:#a7d4c0;text-decoration:none}h1{font-size:22px;margin:18px 0 6px}.account{color:#a3afa9;overflow-wrap:anywhere}.tabs{display:flex;gap:8px;margin:20px 0 12px;flex-wrap:wrap}.tabs a{padding:11px 16px;border:1px solid #354640;border-radius:9px}.tabs a[aria-current=page]{background:#234137;color:#fff}.hint{color:#91a098;line-height:1.7;font-size:12px;margin-bottom:18px}.record{padding:16px;border:1px solid #2d4039;background:#111c20;border-radius:12px;margin-bottom:10px;min-width:0}.meta{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;color:#9aaba1;font-size:12px}.badge{color:#b8e3c7}.warn{color:#f0b45f}.summary{font-weight:700;font-size:15px;margin:10px 0;line-height:1.6;overflow-wrap:anywhere}.limits{font-size:12px;color:#bdc8c0;line-height:1.7;overflow-wrap:anywhere}details{margin-top:12px}summary{cursor:pointer;color:#a7d4c0;padding:7px 0}dl{display:grid;grid-template-columns:minmax(80px,120px) minmax(0,1fr);gap:8px;margin:10px 0;line-height:1.6}dt{color:#9aaba1}dd{margin:0;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px system-ui;line-height:1.7}small{display:block;color:#99aaa1;overflow-wrap:anywhere;line-height:1.7}.bad{color:#ff9ca4}.empty{padding:28px 12px;color:#91a098;text-align:center}.pages{display:flex;justify-content:center;align-items:center;gap:18px;margin:22px 0}.pages a{padding:10px}.back{display:inline-block;padding:8px 0}.version{display:inline-block;margin-left:8px;padding:3px 7px;border:1px solid #496153;border-radius:99px;color:#b8e3c7;font-size:10px;font-weight:700;vertical-align:middle}@media(max-width:400px){main{padding:16px 12px}.record{padding:13px}}
</style></head><body><main><a class="back" href="/admin">← 返回白名單</a><h1>${title}<span class="version">v3.2.20</span></h1><div class="account">${escapeAdminAuditText(data.account.platform)} · ${escapeAdminAuditText(data.account.username)}</div><nav class="tabs" aria-label="紀錄種類"><a href="${root}/records"${kind !== 'acknowledgements' ? ' aria-current="page"' : ''}>使用／設定</a><a href="${root}/acknowledgements"${kind === 'acknowledgements' ? ' aria-current="page"' : ''}>免責確認</a></nav><p class="hint">共 ${data.unavailable ? '待同步' : escapeAdminAuditText(data.total)} 筆 · 台北時間。詳細內容按一下展開。<br>${hint}</p>${content}<nav class="pages" aria-label="紀錄分頁">${data.page > 1 ? `<a href="${current}?page=${data.page - 1}">上一頁</a>` : ''}<span>${escapeAdminAuditText(data.page)} / ${escapeAdminAuditText(data.pages)}</span>${data.page < data.pages ? `<a href="${current}?page=${data.page + 1}">下一頁</a>` : ''}</nav></main></body></html>`;
}

export async function sendAdminAuditPage(req: Request, res: Response, kind: AuditKind, deps: AdminAuditReaderDeps) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const id = Number(req.params.id);
  const page = safePage(req.query.page);
  if (!Number.isSafeInteger(id) || id < 1 || page === null) return res.status(400).send('無效紀錄頁');
  try {
    const db = deps.getPool();
    if (!db) return res.status(503).send('紀錄資料庫尚未設定（待同步）');
    const data = await readAdminAuditRecords(db, id, page, kind);
    if (!data) return res.status(404).send('找不到此白名單帳號');
    return res.type('html').send(adminAuditDetailsPage(data, kind));
  } catch {
    return res.status(503).send('紀錄暫時無法讀取（待同步），請稍後再試');
  }
}

/** Other sites call this with their own existing requireAdmin guard; sessions never cross sites. */
export function registerAdminAuditReader(app: Express, requireAdmin: RequestHandler, deps: AdminAuditReaderDeps) {
  app.get(['/api/admin/whitelist/:id/records', '/api/admin/whitelist/:id/usage'], requireAdmin,
    (req, res) => void sendAdminAuditPage(req, res, 'usage', deps));
  app.get('/api/admin/whitelist/:id/settings', requireAdmin,
    (req, res) => void sendAdminAuditPage(req, res, 'settings', deps));
  app.get('/api/admin/whitelist/:id/acknowledgements', requireAdmin,
    (req, res) => void sendAdminAuditPage(req, res, 'acknowledgements', deps));
}
