/**
 * SQLite storage wrapper matching IndexedDB usage patterns.
 * Replaces IndexedDB for Android with expo-sqlite.
 */
import * as SQLite from 'expo-sqlite';

// Allowlists for SQL injection prevention
const ALLOWED_TABLES = new Set(['authorizations', 'tokens', 'manifests', 'scheduledTasks', 'settings', 'logs']);
const ALLOWED_COLUMNS = new Set(['code', 'provider', 'id', 'taskName', 'key', 'expiresAt', 'timestamp', 'createdAt']);

function validateTableName(table) {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
}

function validateColumnName(column) {
  if (!ALLOWED_COLUMNS.has(column)) {
    throw new Error(`Invalid column name: ${column}`);
  }
}

class Storage {
  constructor() {
    this.db = null;
    this._ready = null;
  }

  async init() {
    if (this._ready) return this._ready;
    this._ready = this._initDB();
    return this._ready;
  }

  async _initDB() {
    this.db = await SQLite.openDatabaseAsync('oauthub.db');

    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS authorizations (
        code TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expiresAt TEXT,
        provider TEXT,
        accessType TEXT,
        createdAt TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_auth_expires ON authorizations(expiresAt);
      CREATE INDEX IF NOT EXISTS idx_auth_provider ON authorizations(provider);

      CREATE TABLE IF NOT EXISTS tokens (
        provider TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expiresAt TEXT,
        timestamp INTEGER,
        createdAt TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_token_expires ON tokens(expiresAt);

      CREATE TABLE IF NOT EXISTS manifests (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        provider TEXT,
        accessType TEXT,
        createdAt TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_manifest_provider ON manifests(provider);

      CREATE TABLE IF NOT EXISTS scheduledTasks (
        taskName TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        authCode TEXT,
        createdAt TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_task_auth ON scheduledTasks(authCode);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT,
        message TEXT,
        data TEXT,
        timestamp TEXT
      );
    `);
  }

  // Generic CRUD matching IndexedDB patterns

  async put(table, data) {
    await this.init();
    validateTableName(table);
    const key = this._getKeyField(table);
    const keyVal = data[key];
    const json = JSON.stringify(data);

    if (table === 'authorizations') {
      await this.db.runAsync(
        `INSERT OR REPLACE INTO authorizations (code, data, expiresAt, provider, accessType) VALUES (?, ?, ?, ?, ?)`,
        keyVal, json, data.expiresAt || null, data.provider || null, data.access_type || data.accessType || null
      );
    } else if (table === 'tokens') {
      await this.db.runAsync(
        `INSERT OR REPLACE INTO tokens (provider, data, expiresAt, timestamp) VALUES (?, ?, ?, ?)`,
        keyVal, json, data.expiresAt || null, data.timestamp || Date.now()
      );
    } else if (table === 'manifests') {
      await this.db.runAsync(
        `INSERT OR REPLACE INTO manifests (id, data, provider, accessType) VALUES (?, ?, ?, ?)`,
        keyVal, json, data.provider || null, data.accessType || null
      );
    } else if (table === 'scheduledTasks') {
      await this.db.runAsync(
        `INSERT OR REPLACE INTO scheduledTasks (taskName, data, authCode) VALUES (?, ?, ?)`,
        keyVal, json, data.authCode || null
      );
    } else if (table === 'settings') {
      await this.db.runAsync(
        `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
        data.key, JSON.stringify(data.value)
      );
    } else if (table === 'logs') {
      const ts = new Date().toISOString();
      await this.db.runAsync(
        `INSERT INTO logs (type, message, data, timestamp) VALUES (?, ?, ?, ?)`,
        data.type || 'info', data.message || '', JSON.stringify(data.data || null), ts
      );
    }
  }

  async get(table, key) {
    await this.init();
    validateTableName(table);
    const keyField = this._getKeyField(table);
    validateColumnName(keyField);
    const row = await this.db.getFirstAsync(
      `SELECT data FROM ${table} WHERE ${keyField} = ?`, key
    );
    return row ? JSON.parse(row.data) : null;
  }

  async getAll(table) {
    await this.init();
    validateTableName(table);
    const rows = await this.db.getAllAsync(`SELECT data FROM ${table}`);
    return rows.map(r => JSON.parse(r.data));
  }

  async delete(table, key) {
    await this.init();
    validateTableName(table);
    const keyField = this._getKeyField(table);
    validateColumnName(keyField);
    await this.db.runAsync(`DELETE FROM ${table} WHERE ${keyField} = ?`, key);
  }

  async getAllKeys(table) {
    await this.init();
    validateTableName(table);
    const keyField = this._getKeyField(table);
    validateColumnName(keyField);
    const rows = await this.db.getAllAsync(`SELECT ${keyField} FROM ${table}`);
    return rows.map(r => r[keyField]);
  }

  async clearExpired(table, timeField = 'expiresAt') {
    await this.init();
    validateTableName(table);
    validateColumnName(timeField);
    const now = new Date().toISOString();
    await this.db.runAsync(
      `DELETE FROM ${table} WHERE ${timeField} IS NOT NULL AND ${timeField} < ?`, now
    );
  }

  async getSetting(key) {
    await this.init();
    const row = await this.db.getFirstAsync(`SELECT value FROM settings WHERE key = ?`, key);
    return row ? JSON.parse(row.value) : null;
  }

  async setSetting(key, value) {
    await this.init();
    await this.db.runAsync(
      `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
      key, JSON.stringify(value)
    );
  }

  async addLog(type, message, data = null) {
    await this.init();
    const ts = new Date().toISOString();
    await this.db.runAsync(
      `INSERT INTO logs (type, message, data, timestamp) VALUES (?, ?, ?, ?)`,
      type, message, JSON.stringify(data), ts
    );
  }

  async getLogs(limit = 100) {
    await this.init();
    const rows = await this.db.getAllAsync(
      `SELECT * FROM logs ORDER BY id DESC LIMIT ?`, limit
    );
    return rows.map(r => ({ ...r, data: r.data ? JSON.parse(r.data) : null }));
  }

  async clearLogs() {
    await this.init();
    await this.db.runAsync(`DELETE FROM logs`);
  }

  _getKeyField(table) {
    const keys = {
      authorizations: 'code',
      tokens: 'provider',
      manifests: 'id',
      scheduledTasks: 'taskName',
      settings: 'key',
      logs: 'id',
    };
    return keys[table] || 'id';
  }
}

// Singleton
export const storage = new Storage();
export default Storage;
