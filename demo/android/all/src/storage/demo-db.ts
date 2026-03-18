/**
 * Unified SQLite storage for all six demo versions.
 * One database, one auth table, one data table — keyed by version ID.
 */
import * as SQLite from 'expo-sqlite';
import type { VersionId, StoredDemoData } from '../lib/demo-config';

let db: any = null;

async function getDB() {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('oauthhub-demo.db');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS auth (
      version TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (version, key)
    );
    CREATE TABLE IF NOT EXISTS demo_data (
      version TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

async function getAuthValue(version: string, key: string): Promise<string | null> {
  const database = await getDB();
  const row = await database.getFirstAsync(
    'SELECT value FROM auth WHERE version = ? AND key = ?',
    version,
    key,
  );
  return row ? row.value : null;
}

async function setAuthValue(version: string, key: string, value: string): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    'INSERT OR REPLACE INTO auth (version, key, value) VALUES (?, ?, ?)',
    version,
    key,
    value,
  );
}

async function deleteAuthValue(version: string, key: string): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    'DELETE FROM auth WHERE version = ? AND key = ?',
    version,
    key,
  );
}

// ── Google OAuth tokens ───────────────────────────────────────────────

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpirationDate: string;
}

export async function getGoogleTokens(version: VersionId): Promise<GoogleTokens | null> {
  const accessToken = await getAuthValue(version, 'accessToken');
  if (!accessToken) return null;
  const refreshToken = await getAuthValue(version, 'refreshToken');
  const accessTokenExpirationDate =
    (await getAuthValue(version, 'expirationDate')) ?? new Date().toISOString();
  return { accessToken, refreshToken, accessTokenExpirationDate };
}

export async function setGoogleTokens(version: VersionId, tokens: GoogleTokens): Promise<void> {
  await setAuthValue(version, 'accessToken', tokens.accessToken);
  if (tokens.refreshToken) {
    await setAuthValue(version, 'refreshToken', tokens.refreshToken);
  }
  await setAuthValue(version, 'expirationDate', tokens.accessTokenExpirationDate);
}

// ── OAuthHub token ────────────────────────────────────────────────────

export async function getOAuthHubToken(version: VersionId): Promise<string | null> {
  return getAuthValue(version, 'token');
}

export async function setOAuthHubToken(version: VersionId, token: string): Promise<void> {
  await setAuthValue(version, 'token', token);
}

export async function setPublicKey(version: VersionId, key: unknown): Promise<void> {
  await setAuthValue(version, 'publicKey', JSON.stringify(key));
}

// ── Pending version (for OAuthHub callback) ───────────────────────────

const PENDING_SLOT = '__pending__';

export async function setPendingVersion(version: VersionId): Promise<void> {
  await setAuthValue(PENDING_SLOT, 'version', version);
}

export async function getPendingVersion(): Promise<VersionId | null> {
  return (await getAuthValue(PENDING_SLOT, 'version')) as VersionId | null;
}

export async function clearPendingVersion(): Promise<void> {
  await deleteAuthValue(PENDING_SLOT, 'version');
}

// ── PKCE state (survives process death) ───────────────────────────────

const PKCE_SLOT = '__pkce__';

export async function savePKCE(state: string, codeVerifier: string): Promise<void> {
  await setAuthValue(PKCE_SLOT, 'state', state);
  await setAuthValue(PKCE_SLOT, 'codeVerifier', codeVerifier);
}

export async function loadPKCE(): Promise<{ state: string | null; codeVerifier: string | null }> {
  const state = await getAuthValue(PKCE_SLOT, 'state');
  const codeVerifier = await getAuthValue(PKCE_SLOT, 'codeVerifier');
  return { state, codeVerifier };
}

export async function clearPKCE(): Promise<void> {
  await deleteAuthValue(PKCE_SLOT, 'state');
  await deleteAuthValue(PKCE_SLOT, 'codeVerifier');
}

// ── Auth status ───────────────────────────────────────────────────────

export async function isAuthenticated(version: VersionId): Promise<boolean> {
  // OAuthHub versions store a single opaque token
  const oauthubToken = await getAuthValue(version, 'token');
  if (oauthubToken !== null) return true;
  // Google versions store separate access/refresh tokens
  const googleToken = await getAuthValue(version, 'accessToken');
  return googleToken !== null;
}

export async function clearAuth(version: VersionId): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM auth WHERE version = ?', version);
  await database.runAsync('DELETE FROM demo_data WHERE version = ?', version);
}

// ── Demo data ─────────────────────────────────────────────────────────

export async function getData(version: VersionId): Promise<StoredDemoData | null> {
  const database = await getDB();
  const row = await database.getFirstAsync(
    'SELECT json FROM demo_data WHERE version = ?',
    version,
  );
  return row ? JSON.parse(row.json) : null;
}

export async function setData(version: VersionId, data: StoredDemoData): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    "INSERT OR REPLACE INTO demo_data (version, json, updated_at) VALUES (?, ?, datetime('now'))",
    version,
    JSON.stringify(data),
  );
}
