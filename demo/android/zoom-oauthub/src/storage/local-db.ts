/**
 * On-device storage for the Zoom demo app.
 * Replaces tRPC + JsonDB server with expo-sqlite.
 */
import * as SQLite from 'expo-sqlite';

let db: any = null;

async function getDB() {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('zoom-demo.db');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS auth (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL,
      createdAt TEXT DEFAULT (datetime('now'))
    );
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

export async function getPublicKey(): Promise<any> {
  const database = await getDB();
  const row = await database.getFirstAsync('SELECT value FROM auth WHERE key = ?', 'publicKey');
  return row ? JSON.parse(row.value) : null;
}

export async function setPublicKey(key: any): Promise<void> {
  const database = await getDB();
  await database.runAsync('INSERT OR REPLACE INTO auth (key, value) VALUES (?, ?)', 'publicKey', JSON.stringify(key));
}

export async function clearAuth(): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM auth');
  await database.runAsync('DELETE FROM events');
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getAuthToken();
  return token !== null;
}

export async function storeEvents(events: any[]): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM events');
  for (const event of events) {
    await database.runAsync('INSERT INTO events (data) VALUES (?)', JSON.stringify(event));
  }
}

export async function getEvents(): Promise<any[]> {
  const database = await getDB();
  const rows = await database.getAllAsync('SELECT data FROM events ORDER BY id');
  return rows.map((r: any) => JSON.parse(r.data));
}
