import * as SQLite from 'expo-sqlite';

let db: any = null;

async function getDB() {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('notability-baseline.db');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS auth (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, createdAt TEXT DEFAULT (datetime('now')));
  `);
  return db;
}

export async function getAuthToken(): Promise<string | null> {
  const database = await getDB();
  const row = await database.getFirstAsync('SELECT value FROM auth WHERE key = ?', 'access_token');
  return row ? row.value : null;
}

export async function setAuthToken(token: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('INSERT OR REPLACE INTO auth (key, value) VALUES (?, ?)', 'access_token', token);
}

export async function getRefreshToken(): Promise<string | null> {
  const database = await getDB();
  const row = await database.getFirstAsync('SELECT value FROM auth WHERE key = ?', 'refresh_token');
  return row ? row.value : null;
}

export async function setRefreshToken(token: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('INSERT OR REPLACE INTO auth (key, value) VALUES (?, ?)', 'refresh_token', token);
}

export async function getTokenExpiry(): Promise<string | null> {
  const database = await getDB();
  const row = await database.getFirstAsync('SELECT value FROM auth WHERE key = ?', 'token_expiry');
  return row ? row.value : null;
}

export async function setTokenExpiry(expiry: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('INSERT OR REPLACE INTO auth (key, value) VALUES (?, ?)', 'token_expiry', expiry);
}

export async function clearAuth(): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM auth');
  await database.runAsync('DELETE FROM files');
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getAuthToken()) !== null;
}

export async function storeFiles(files: any[]): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM files');
  for (const f of files) {
    await database.runAsync('INSERT INTO files (data) VALUES (?)', JSON.stringify(f));
  }
}

export async function getFiles(): Promise<any[]> {
  const database = await getDB();
  const rows = await database.getAllAsync('SELECT data FROM files ORDER BY id');
  return rows.map((r: any) => JSON.parse(r.data));
}
