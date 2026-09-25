import pg from "pg";

const { Pool } = pg;
let pool: pg.Pool | null = null;
let initialized = false;

const INITIAL_WHITELIST = ["sdfg56sd", "fqfq761126", "frank9026133", "a0928a", "s870053", "asd58678", "Hua80pp", "heheheh0", "0929785252", "ljt922", "aigste", "0966555961", "Miao9487", "sam828021", "a0970648", "fredapple83", "qi511", "coco51788", "0970259733", "aopop198611", "Aw2025", "zzz6118", "a2395057", "az5539856", "Lei875869", "zz1127", "sray0720", "a755160z", "jasony07", "d95637820", "ap93217", "xaing1028", "a0988773822", "Switch", "yuyun0417", "sks5120", "Amc564423", "Ray0715", "qqq19882001", "tt1026", "890906xx", "fgjxu1738", "f0983821969", "Kct103010", "Kai0119", "Doggo", "055512681", "ben910416", "moke88", "zx7417410", "Joe16588", "sheng1028", "k095695100", "lin11112222", "peterfus", "Remix1110", "win8899", "hugo38735028", "0919474047", "Qwer1234567", "Wu0817", "run970417", "bess86688", "EEE888", "Miyavi89", "Nien2003", "asd830901", "Zzyy1322", "0955552794", "z9601196", "Zz520776", "ean1029", "winnie927", "andybdm01", "hao0315", "shuai111", "Gtr6688", "Xiang0614", "hy9500", "kiss791111", "hp963508", "Aa950831", "Aa991203", "a0906733338", "Sheng5138", "yzlin818", "A42437", "zxc123456", "vn1128", "frank0518", "love0985441113", "Hwc25136792", "zzz930611", "love0985441114", "patrickph", "Fang0524", "Jin021", "Hsiao"];

export function getPool() {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) return null;
  if (!/^postgres(ql)?:\/\//i.test(url)) throw new Error("DATABASE_URL 必須使用 Render PostgreSQL 連線網址");
  if (!pool) pool = new Pool({ connectionString: url, ssl: url.includes("localhost") ? false : { rejectUnauthorized: false } });
  return pool;
}

export function whitelistEnabled() {
  return String(process.env.TZ_WHITELIST_ENABLED ?? "true").toLowerCase() !== "false";
}

export async function ensureWhitelistTables() {
  const db = getPool();
  if (!db) return false;
  if (initialized) return true;

  await db.query(`CREATE TABLE IF NOT EXISTS tz_whitelist (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(128) NOT NULL,
    platform VARCHAR(16) NOT NULL DEFAULT 'TZ',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMPTZ NULL,
    max_devices INTEGER NOT NULL DEFAULT 1,
    note VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await db.query(`ALTER TABLE tz_whitelist ADD COLUMN IF NOT EXISTS platform VARCHAR(16) NOT NULL DEFAULT 'TZ'`);

  // v2.91 account-only migration.
  // Old disabled/expired entries were revoked access, so remove them before
  // changing the meaning to "row exists == allowed".
  await db.query(`DELETE FROM tz_whitelist
    WHERE enabled = FALSE
       OR (expires_at IS NOT NULL AND expires_at <= NOW())`);

  // Same login may previously have existed once for TZ and once for OFA.
  // Account-only whitelist needs only one row.
  await db.query(`DELETE FROM tz_whitelist a
    USING tz_whitelist b
    WHERE LOWER(a.username)=LOWER(b.username)
      AND a.id < b.id`);

  await db.query(`UPDATE tz_whitelist
    SET platform='ACCOUNT',
        enabled=TRUE,
        expires_at=NULL,
        note=NULL,
        updated_at=NOW()
    WHERE platform IS DISTINCT FROM 'ACCOUNT'
       OR enabled IS DISTINCT FROM TRUE
       OR expires_at IS NOT NULL
       OR note IS NOT NULL`);

  await db.query(`DROP INDEX IF EXISTS tz_whitelist_platform_username_ci`);
  await db.query(`DROP INDEX IF EXISTS tz_whitelist_username_lower_idx`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS tz_whitelist_username_ci
    ON tz_whitelist (LOWER(username))`);

  await db.query(`CREATE TABLE IF NOT EXISTS mt_app_meta (
    meta_key VARCHAR(128) PRIMARY KEY,
    meta_value VARCHAR(255) NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS tracker_sessions (
    session_id VARCHAR(64) PRIMARY KEY,
    platform VARCHAR(16) NOT NULL,
    username VARCHAR(128) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS tracker_sessions_platform_username_ci
    ON tracker_sessions (UPPER(platform), LOWER(username))`);

  const seed = await db.query(`SELECT meta_value FROM mt_app_meta WHERE meta_key=$1 LIMIT 1`, ["tz_whitelist_initial_seed_pg_v1"]);
  if (!seed.rowCount) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const username of INITIAL_WHITELIST) {
        await client.query(
          `INSERT INTO tz_whitelist (username, platform, enabled, expires_at, max_devices, note)
           VALUES ($1,'ACCOUNT',TRUE,NULL,1,NULL)
           ON CONFLICT DO NOTHING`,
          [username],
        );
      }
      await client.query(
        `INSERT INTO mt_app_meta (meta_key, meta_value) VALUES ($1,$2)
         ON CONFLICT (meta_key) DO UPDATE SET meta_value=EXCLUDED.meta_value, updated_at=NOW()`,
        ["tz_whitelist_initial_seed_pg_v1", String(INITIAL_WHITELIST.length)],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  initialized = true;
  return true;
}

export async function authorizeWhitelist(usernameRaw: string) {
  if (!whitelistEnabled()) return { allowed: true, reason: "whitelist_disabled" } as const;
  const db = getPool();
  if (!db) return { allowed: false, reason: "database_unavailable" } as const;
  await ensureWhitelistTables();

  const username = usernameRaw.trim();
  if (!username) return { allowed: false, reason: "not_whitelisted" } as const;

  const result = await db.query(
    `SELECT id, username FROM tz_whitelist WHERE LOWER(username)=LOWER($1) LIMIT 1`,
    [username],
  );
  if (!result.rowCount) return { allowed: false, reason: "not_whitelisted" } as const;
  return { allowed: true, reason: "ok" } as const;
}

// Kept for the current client endpoint name.
// It now only checks whether the login account is whitelisted.
// Platform is determined by actual TZ/OFA login, not by the whitelist.
export async function getWhitelistPlatform(usernameRaw: string) {
  const access = await authorizeWhitelist(usernameRaw);
  return {
    found: access.allowed,
    platform: "AUTO",
    reason: access.reason,
  } as const;
}

export async function listWhitelist() {
  const db = getPool();
  if (!db) throw new Error("DATABASE_URL 尚未設定");
  await ensureWhitelistTables();
  const r = await db.query(
    `SELECT id, username, created_at, updated_at
       FROM tz_whitelist
      ORDER BY updated_at DESC, id DESC`,
  );
  return r.rows;
}

export async function upsertWhitelist(input: { username: string }) {
  const db = getPool();
  if (!db) throw new Error("DATABASE_URL 尚未設定");
  await ensureWhitelistTables();

  const username = input.username.trim();
  if (!username) throw new Error("請輸入登入帳號");

  const existing = await db.query(
    `SELECT id FROM tz_whitelist WHERE LOWER(username)=LOWER($1) LIMIT 1`,
    [username],
  );

  if (existing.rowCount) {
    await db.query(
      `UPDATE tz_whitelist
          SET username=$1, platform='ACCOUNT', enabled=TRUE,
              expires_at=NULL, note=NULL, updated_at=NOW()
        WHERE id=$2`,
      [username, existing.rows[0].id],
    );
    return;
  }

  try {
    await db.query(
      `INSERT INTO tz_whitelist
        (username, platform, enabled, expires_at, max_devices, note, updated_at)
       VALUES ($1,'ACCOUNT',TRUE,NULL,1,NULL,NOW())`,
      [username],
    );
  } catch (e: any) {
    if (e?.code !== "23505") throw e;
    await db.query(
      `UPDATE tz_whitelist
          SET username=$1, platform='ACCOUNT', enabled=TRUE,
              expires_at=NULL, note=NULL, updated_at=NOW()
        WHERE LOWER(username)=LOWER($1)`,
      [username],
    );
  }
}

export async function deleteWhitelist(id: number) {
  const db = getPool();
  if (!db) throw new Error("DATABASE_URL 尚未設定");
  await ensureWhitelistTables();
  await db.query(`DELETE FROM tz_whitelist WHERE id=$1`, [id]);
}
