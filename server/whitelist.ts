import mysql from "mysql2/promise";

let pool: mysql.Pool | null = null;
let initialized = false;
const INITIAL_WHITELIST = ["sdfg56sd", "fqfq761126", "frank9026133", "a0928a", "s870053", "asd58678", "Hua80pp", "heheheh0", "0929785252", "ljt922", "aigste", "0966555961", "Miao9487", "sam828021", "a0970648", "fredapple83", "qi511", "coco51788", "0970259733", "aopop198611", "Aw2025", "zzz6118", "a2395057", "az5539856", "Lei875869", "zz1127", "sray0720", "a755160z", "jasony07", "d95637820", "ap93217", "xaing1028", "a0988773822", "Switch", "yuyun0417", "sks5120", "Amc564423", "Ray0715", "qqq19882001", "tt1026", "890906xx", "fgjxu1738", "f0983821969", "Kct103010", "Kai0119", "Doggo", "055512681", "ben910416", "moke88", "zx7417410", "Joe16588", "sheng1028", "k095695100", "lin11112222", "peterfus", "Remix1110", "win8899", "hugo38735028", "0919474047", "Qwer1234567", "Wu0817", "run970417", "bess86688", "EEE888", "Miyavi89", "Nien2003", "asd830901", "Zzyy1322", "0955552794", "z9601196", "Zz520776", "ean1029", "winnie927", "andybdm01", "hao0315", "shuai111", "Gtr6688", "Xiang0614", "hy9500", "kiss791111", "hp963508", "Aa950831", "Aa991203", "a0906733338", "Sheng5138", "yzlin818", "A42437", "zxc123456", "vn1128", "frank0518", "love0985441113", "Hwc25136792", "zzz930611", "love0985441114", "patrickph", "Fang0524", "Jin021", "Hsiao"];
let seeded = false;


function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) pool = mysql.createPool(process.env.DATABASE_URL);
  return pool;
}

export function whitelistEnabled() {
  return String(process.env.TZ_WHITELIST_ENABLED ?? "false").toLowerCase() === "true";
}

export async function ensureWhitelistTables() {
  const db = getPool();
  if (!db) return false;
  if (initialized) return true;
  await db.query(`CREATE TABLE IF NOT EXISTS tz_whitelist (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(128) NOT NULL UNIQUE,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    expires_at DATETIME NULL,
    max_devices INT NOT NULL DEFAULT 1,
    note VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS tz_whitelist_devices (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    whitelist_id BIGINT UNSIGNED NOT NULL,
    device_id VARCHAR(128) NOT NULL,
    first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_whitelist_device (whitelist_id, device_id),
    CONSTRAINT fk_whitelist_device FOREIGN KEY (whitelist_id) REFERENCES tz_whitelist(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  if (!seeded) {
    for (const username of INITIAL_WHITELIST) {
      await db.query(`INSERT IGNORE INTO tz_whitelist (username, enabled, expires_at, max_devices, note) VALUES (?,1,NULL,1,?)`, [username, "初始白名單"]);
    }
    seeded = true;
  }
  initialized = true;
  return true;
}

export async function authorizeWhitelist(usernameRaw: string, deviceIdRaw?: string) {
  if (!whitelistEnabled()) return { allowed: true, reason: "whitelist_disabled" } as const;
  const db = getPool();
  if (!db) return { allowed: false, reason: "database_unavailable" } as const;
  await ensureWhitelistTables();
  const username = usernameRaw.trim();
  const deviceId = (deviceIdRaw || "web").trim().slice(0, 128);
  const [rows] = await db.query<any[]>(`SELECT * FROM tz_whitelist WHERE LOWER(username)=LOWER(?) LIMIT 1`, [username]);
  const row = rows[0];
  if (!row) return { allowed: false, reason: "not_whitelisted" } as const;
  if (!Number(row.enabled)) return { allowed: false, reason: "disabled" } as const;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return { allowed: false, reason: "expired" } as const;

  const [deviceRows] = await db.query<any[]>(`SELECT id, device_id FROM tz_whitelist_devices WHERE whitelist_id=? ORDER BY first_seen ASC`, [row.id]);
  const existing = deviceRows.find((d:any) => d.device_id === deviceId);
  if (existing) {
    await db.query(`UPDATE tz_whitelist_devices SET last_seen=NOW() WHERE id=?`, [existing.id]);
  } else {
    const maxDevices = Math.max(1, Number(row.max_devices) || 1);
    if (deviceRows.length >= maxDevices) return { allowed: false, reason: "device_limit" } as const;
    await db.query(`INSERT INTO tz_whitelist_devices (whitelist_id, device_id) VALUES (?,?)`, [row.id, deviceId]);
  }
  return { allowed: true, reason: "ok" } as const;
}

export async function listWhitelist() {
  const db = getPool();
  if (!db) throw new Error("DATABASE_URL 尚未設定");
  await ensureWhitelistTables();
  const [rows] = await db.query<any[]>(`SELECT w.*, COUNT(d.id) AS device_count FROM tz_whitelist w LEFT JOIN tz_whitelist_devices d ON d.whitelist_id=w.id GROUP BY w.id ORDER BY w.updated_at DESC`);
  return rows;
}

export async function upsertWhitelist(input:{username:string; days?:number|null; permanent?:boolean; maxDevices?:number; note?:string}) {
  const db = getPool();
  if (!db) throw new Error("DATABASE_URL 尚未設定");
  await ensureWhitelistTables();
  const username=input.username.trim();
  const maxDevices=Math.max(1, Math.min(10, Number(input.maxDevices)||1));
  const expiresAt=input.permanent ? null : new Date(Date.now()+Math.max(1, Number(input.days)||30)*86400000);
  await db.query(`INSERT INTO tz_whitelist (username,enabled,expires_at,max_devices,note) VALUES (?,1,?,?,?) ON DUPLICATE KEY UPDATE enabled=1,expires_at=VALUES(expires_at),max_devices=VALUES(max_devices),note=VALUES(note)`, [username, expiresAt, maxDevices, (input.note||"").slice(0,255)]);
}

export async function setWhitelistEnabled(id:number, enabled:boolean) {
  const db=getPool(); if(!db) throw new Error("DATABASE_URL 尚未設定"); await ensureWhitelistTables();
  await db.query(`UPDATE tz_whitelist SET enabled=? WHERE id=?`, [enabled?1:0,id]);
}
export async function extendWhitelist(id:number, days:number) {
  const db=getPool(); if(!db) throw new Error("DATABASE_URL 尚未設定"); await ensureWhitelistTables();
  await db.query(`UPDATE tz_whitelist SET expires_at=DATE_ADD(CASE WHEN expires_at IS NULL OR expires_at < NOW() THEN NOW() ELSE expires_at END, INTERVAL ? DAY), enabled=1 WHERE id=?`, [Math.max(1,days),id]);
}
export async function clearWhitelistDevices(id:number) {
  const db=getPool(); if(!db) throw new Error("DATABASE_URL 尚未設定"); await ensureWhitelistTables();
  await db.query(`DELETE FROM tz_whitelist_devices WHERE whitelist_id=?`, [id]);
}
export async function deleteWhitelist(id:number) {
  const db=getPool(); if(!db) throw new Error("DATABASE_URL 尚未設定"); await ensureWhitelistTables();
  await db.query(`DELETE FROM tz_whitelist WHERE id=?`, [id]);
}
