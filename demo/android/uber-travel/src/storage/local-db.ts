import * as SQLite from 'expo-sqlite';

let db: any = null;

async function getDB() {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('uber-travel-baseline.db');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS auth (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS emails (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, createdAt TEXT DEFAULT (datetime('now')));
  `);
  return db;
}

// ── Auth token helpers ──────────────────────────────────────────────

export async function getAuthToken(): Promise<string | null> {
  const database = await getDB();
  const row = await database.getFirstAsync('SELECT value FROM auth WHERE key = ?', 'accessToken');
  return row ? row.value : null;
}

export async function getRefreshToken(): Promise<string | null> {
  const database = await getDB();
  const row = await database.getFirstAsync('SELECT value FROM auth WHERE key = ?', 'refreshToken');
  return row ? row.value : null;
}

export async function getTokenExpiry(): Promise<string | null> {
  const database = await getDB();
  const row = await database.getFirstAsync('SELECT value FROM auth WHERE key = ?', 'expirationDate');
  return row ? row.value : null;
}

export async function setAuthTokens(
  accessToken: string,
  refreshToken: string | null,
  expirationDate: string,
): Promise<void> {
  const database = await getDB();
  await database.runAsync('INSERT OR REPLACE INTO auth (key, value) VALUES (?, ?)', 'accessToken', accessToken);
  if (refreshToken) {
    await database.runAsync('INSERT OR REPLACE INTO auth (key, value) VALUES (?, ?)', 'refreshToken', refreshToken);
  }
  await database.runAsync('INSERT OR REPLACE INTO auth (key, value) VALUES (?, ?)', 'expirationDate', expirationDate);
}

export async function clearAuth(): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM auth');
  await database.runAsync('DELETE FROM emails');
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getAuthToken()) !== null;
}

// ── Email storage ───────────────────────────────────────────────────

export async function storeEmails(emails: any[]): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM emails');
  for (const e of emails) {
    await database.runAsync('INSERT INTO emails (data) VALUES (?)', JSON.stringify(e));
  }
}

export async function getEmails(): Promise<any[]> {
  const database = await getDB();
  const rows = await database.getAllAsync('SELECT data FROM emails ORDER BY id');
  return rows.map((r: any) => JSON.parse(r.data));
}
