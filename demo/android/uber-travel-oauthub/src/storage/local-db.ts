import * as SQLite from 'expo-sqlite';

let db: any = null;

async function getDB() {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('uber-travel-demo.db');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS auth (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS flights (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, createdAt TEXT DEFAULT (datetime('now')));
  `);
  return db;
}

export async function getAuthToken(): Promise<string | null> {
  const database = await getDB();
  const row = await database.getFirstAsync('SELECT value FROM auth WHERE key = ?', 'token');
  return row ? row.value : null;
}

export async function setAuthToken(token: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('INSERT OR REPLACE INTO auth (key, value) VALUES (?, ?)', 'token', token);
}

export async function setPublicKey(key: any): Promise<void> {
  const database = await getDB();
  await database.runAsync('INSERT OR REPLACE INTO auth (key, value) VALUES (?, ?)', 'publicKey', JSON.stringify(key));
}

export async function clearAuth(): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM auth');
  await database.runAsync('DELETE FROM flights');
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getAuthToken()) !== null;
}

export async function storeFlights(flights: any[]): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM flights');
  for (const f of flights) {
    await database.runAsync('INSERT INTO flights (data) VALUES (?)', JSON.stringify(f));
  }
}

export async function getFlights(): Promise<any[]> {
  const database = await getDB();
  const rows = await database.getAllAsync('SELECT data FROM flights ORDER BY id');
  return rows.map((r: any) => JSON.parse(r.data));
}
