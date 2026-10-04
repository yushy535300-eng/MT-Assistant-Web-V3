import pg from "pg";

const { Pool } = pg;
let cmsPool: pg.Pool | null = null;

function getCmsPool() {
  const url = String(process.env.CMS_DATABASE_URL || process.env.DATABASE_URL || "").trim();
  if (!url) throw new Error("CMS_DATABASE_URL 尚未設定");
  if (!/^postgres(ql)?:\/\//i.test(url)) throw new Error("CMS_DATABASE_URL 必須是 PostgreSQL 連線網址");
  if (!cmsPool) {
    cmsPool = new Pool({
      connectionString: url,
      ssl: url.includes("localhost") ? false : { rejectUnauthorized: false },
    });
  }
  return cmsPool;
}

export async function ensureCmsTable() {
  const db = getCmsPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS cms_settings (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function readCmsSettings() {
  const db = getCmsPool();
  await ensureCmsTable();
  const result = await db.query("SELECT data FROM cms_settings WHERE id=1 LIMIT 1");
  return result.rows[0]?.data || { site: {}, products: [], features: [], links: [] };
}

export async function saveCmsSettings(data: any) {
  const db = getCmsPool();
  await ensureCmsTable();
  await db.query(
    `INSERT INTO cms_settings(id,data,updated_at)
     VALUES(1,$1::jsonb,NOW())
     ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()`,
    [JSON.stringify(data)],
  );
}
