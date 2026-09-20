import { ensureWhitelistTables, getPool } from "./whitelist";

export type TrackerSession = { sessionId: string; platform: string; username: string };

const memory = new Map<string, TrackerSession>();

function userKey(platform: string, username: string) {
  return `${String(platform || "TZ").toUpperCase()}:${String(username || "").trim().toLowerCase()}`;
}

function remember(session: TrackerSession) {
  memory.set(userKey(session.platform, session.username), session);
}

export function hasActiveTrackerSession(sessionId: string) {
  if (!sessionId) return false;
  for (const value of memory.values()) if (value.sessionId === sessionId) return true;
  return false;
}

export async function saveTrackerSession(session: TrackerSession) {
  remember(session);
  const db = getPool();
  if (!db) return;
  await ensureWhitelistTables();
  await db.query(`DELETE FROM tracker_sessions WHERE UPPER(platform)=UPPER($1) AND LOWER(username)=LOWER($2)`, [
    session.platform,
    session.username,
  ]);
  await db.query(
    `INSERT INTO tracker_sessions (session_id, platform, username, updated_at) VALUES ($1,$2,$3,NOW())`,
    [session.sessionId, session.platform, session.username],
  );
}

export async function loadTrackerSession(sessionId: string): Promise<TrackerSession | null> {
  if (!sessionId) return null;
  for (const value of memory.values()) if (value.sessionId === sessionId) return value;
  const db = getPool();
  if (!db) return null;
  await ensureWhitelistTables();
  const result = await db.query(
    `SELECT session_id, platform, username FROM tracker_sessions WHERE session_id=$1 LIMIT 1`,
    [sessionId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const session = { sessionId: String(row.session_id), platform: String(row.platform), username: String(row.username) };
  remember(session);
  return session;
}

export async function deleteTrackerSession(sessionId: string) {
  for (const [key, value] of memory.entries()) {
    if (value.sessionId === sessionId) memory.delete(key);
  }
  const db = getPool();
  if (!db) return;
  await ensureWhitelistTables();
  await db.query(`DELETE FROM tracker_sessions WHERE session_id=$1`, [sessionId]);
}

export async function requireTrackerSession(sessionId: string) {
  return !!(await loadTrackerSession(sessionId));
}
