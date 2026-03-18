/**
 * Message handler — framework-agnostic functions extracted from Chrome's index.js.
 * Singleton pattern: import { messageHandler } from './message-handler'.
 */
import Runtime from '../core/runtime';
import OAuthCrypto from '../core/oauth-crypto';
import TokenManager from '../platform/token-manager';
import { storage } from '../platform/storage';
import { parseManifest } from '../core/manifest-parser';

const oauthCrypto = new OAuthCrypto();
const tokenManager = new TokenManager();
const sessionKeyPairs = new Map();
const pendingAuthCodeExchanges = new Set();

// O(1) rotation token -> provider lookup
const rotationTokenIndex = new Map();

// Simple promise-based mutex for preventing race conditions
class Mutex {
  constructor() { this._locks = new Map(); }
  async acquire(key) {
    while (this._locks.has(key)) {
      await this._locks.get(key);
    }
    let release;
    const promise = new Promise(r => { release = r; });
    this._locks.set(key, promise);
    return () => { this._locks.delete(key); release(); };
  }
}
const mutex = new Mutex();

function generateAuthCode() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// Validate redirect URIs to prevent open redirect attacks
function isValidRedirectUri(uri) {
  if (!uri) return false;
  try {
    const url = new URL(uri);
    const scheme = url.protocol.toLowerCase();
    // Block dangerous schemes
    if (['javascript:', 'data:', 'blob:', 'file:', 'vbscript:'].includes(scheme)) return false;
    // Allow https, custom app schemes, and localhost http
    if (scheme === 'https:') return true;
    if (scheme === 'http:') {
      const host = url.hostname;
      return host === 'localhost' || host === '127.0.0.1';
    }
    // Allow custom app schemes (e.g. com.myapp://, myapp://)
    return true;
  } catch { return false; }
}

let _instance = null;
let _cleanupInterval = null;

export class MessageHandler {
  constructor() {
    if (_instance) return _instance;
    _instance = this;
    this.tokenManager = tokenManager;
    this.oauthCrypto = oauthCrypto;

    // Start periodic cleanup (once only)
    if (!_cleanupInterval) {
      _cleanupInterval = setInterval(() => this._cleanupExpired(), 5 * 60 * 1000);
    }
  }

  dispose() {
    if (_cleanupInterval) {
      clearInterval(_cleanupInterval);
      _cleanupInterval = null;
    }
    _instance = null;
  }

  // ===== EXCHANGE_AUTH_CODE =====
  async handleExchangeAuthCode({ code, code_verifier }) {
    if (!code) return { success: false, error: 'Missing authorization code' };
    if (pendingAuthCodeExchanges.has(code)) {
      return { success: false, error: 'Invalid or expired authorization code' };
    }

    const release = await mutex.acquire(`exchange_${code}`);
    pendingAuthCodeExchanges.add(code);
    try {
      const authData = await storage.get('authorizations', code);
      if (!authData) return { success: false, error: 'Invalid or expired authorization code' };

      // Delete auth code immediately (single-use) before any further processing
      await storage.delete('authorizations', code);

      if (new Date(authData.expiresAt) <= new Date()) {
        sessionKeyPairs.delete(code);
        return { success: false, error: 'Authorization code has expired' };
      }

      // PKCE verification
      if (authData.pkce_challenge) {
        if (!code_verifier) {
          return { success: false, error: 'Missing PKCE code verifier' };
        }
        const pkceValid = await this.oauthCrypto.verifyPKCE(code_verifier, authData.pkce_challenge);
        if (!pkceValid) return { success: false, error: 'PKCE verification failed' };
      }

      // Generate access token with rotation
      const accessToken = generateAuthCode();
      const rotationToken = generateAuthCode();
      const expiresAt = new Date(Date.now() + 3600 * 1000);

      // Decrypt stored Google tokens
      let decryptedGoogleTokens = authData.googleTokens;
      if (authData.googleTokens && authData.googleTokens.encrypted) {
        decryptedGoogleTokens = await this.tokenManager.decryptToken(authData.googleTokens, authData.provider);
        if (!decryptedGoogleTokens) return { success: false, error: 'Token decryption failed' };
      }

      let actualAccessToken = accessToken;
      if (decryptedGoogleTokens && decryptedGoogleTokens.access_token) {
        actualAccessToken = decryptedGoogleTokens.access_token;
      }

      // Store token
      const tokenData = {
        provider: `client_${code}`,
        authCode: code,
        access_token: actualAccessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        expiresAt: expiresAt.toISOString(),
        manifest: authData.manifest,
        googleTokens: decryptedGoogleTokens,
        oauthProvider: authData.provider,
        rotation_token: rotationToken,
        timestamp: Date.now(),
      };

      await storage.put('tokens', tokenData);

      // Update rotation token index
      rotationTokenIndex.set(rotationToken, tokenData.provider);

      await storage.addLog('exchange', 'Token exchanged', {});

      // Return signing public key if available
      let publicKeyJWK = null;
      const keyPair = sessionKeyPairs.get(code);
      if (keyPair) publicKeyJWK = keyPair.publicKeyJWK;

      return {
        success: true,
        // NOTE: This is the rotation token, not the Google access token.
        // Clients use this to authenticate subsequent /api/query calls.
        access_token: rotationToken,
        expires_in: 3600,
        publicKeyJWK,
      };
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      pendingAuthCodeExchanges.delete(code);
      release();
    }
  }

  // ===== EXECUTE_QUERY =====
  async handleExecuteQuery({ token, manifest, operation = 'read', data }) {
    if (!token || !manifest) return { success: false, error: 'Missing token or manifest' };

    const release = await mutex.acquire(`query_${token}`);
    try {
      // O(1) lookup via rotation token index, with fallback to full scan
      let tokenRecord = null;
      const indexedProvider = rotationTokenIndex.get(token);
      if (indexedProvider) {
        const candidate = await storage.get('tokens', indexedProvider);
        if (candidate && candidate.rotation_token === token) {
          tokenRecord = candidate;
        }
      }
      if (!tokenRecord) {
        const allTokens = await storage.getAll('tokens');
        tokenRecord = allTokens.find(t => t.rotation_token === token);
      }

      if (!tokenRecord) return { success: false, error: 'Invalid or expired token' };
      if (tokenRecord.expiresAt && new Date(tokenRecord.expiresAt) <= new Date()) {
        rotationTokenIndex.delete(token);
        await storage.delete('tokens', tokenRecord.provider);
        return { success: false, error: 'Token has expired' };
      }

      const authCode = tokenRecord.authCode || this._getAuthCodeFromTokenRecord(tokenRecord);
      const approvedManifest = tokenRecord.manifest;
      if (!authCode || !approvedManifest) {
        return { success: false, error: 'Token is missing approved authorization context' };
      }
      if (manifest !== approvedManifest) {
        return { success: false, error: 'Manifest does not match the approved authorization' };
      }
      if (operation === 'write' && typeof data === 'undefined') {
        return { success: false, error: 'Missing write payload' };
      }

      // Check manifest constraints
      const manifests = await storage.getAll('manifests');
      const manifestEntry = manifests.find(
        m => m.id === authCode || m.authCode === authCode
      );
      if (!manifestEntry || manifestEntry.manifestText !== approvedManifest) {
        return { success: false, error: 'Approved manifest not found' };
      }
      if (!manifestEntry.enabled) {
        return { success: false, error: 'Manifest is disabled' };
      }

      if (manifestEntry.constraints) {
        const constraintError = this._checkConstraints(manifestEntry.constraints);
        if (constraintError) return { success: false, error: constraintError };
      }

      // Refresh Google token if expired
      let googleTokens = tokenRecord.googleTokens || null;
      if (googleTokens && googleTokens.expires_in && googleTokens.access_token) {
        const storedAt = tokenRecord.timestamp || Date.now();
        const elapsed = (Date.now() - storedAt) / 1000;
        if (elapsed > (googleTokens.expires_in * 0.9)) {
          if (googleTokens.refresh_token) {
            try {
              const refreshed = await this.tokenManager.refreshGoogleToken(googleTokens.refresh_token);
              googleTokens = { ...googleTokens, ...refreshed };
              tokenRecord.googleTokens = googleTokens;
              tokenRecord.timestamp = Date.now();
            } catch (refreshErr) {
              console.warn('Token refresh failed:', refreshErr.message);
            }
          }
        }
      }

      // Get signing key pair for Runtime
      let runtimeOpts = {
        interactive: false,
        googleTokens,
      };
      const keyPair = sessionKeyPairs.get(authCode);
      if (keyPair) {
        runtimeOpts = {
          ...runtimeOpts,
          privateKey: keyPair.privateKey,
          publicKeyJWK: keyPair.publicKeyJWK,
        };
      }

      // Execute pipeline
      const runtime = new Runtime(runtimeOpts);
      const result = await runtime.executeManifest(
        approvedManifest,
        operation === 'write'
          ? { operation: 'write', data }
          : { operation: 'read' }
      );

      // Token rotation: invalidate old token, generate new one
      rotationTokenIndex.delete(token);
      const newRotationToken = generateAuthCode();
      tokenRecord.rotation_token = newRotationToken;
      await storage.put('tokens', tokenRecord);
      rotationTokenIndex.set(newRotationToken, tokenRecord.provider);

      // Update constraint usage
      if (manifestEntry && manifestEntry.constraints) {
        manifestEntry.constraints.usage.currentUses = (manifestEntry.constraints.usage.currentUses || 0) + 1;
        manifestEntry.constraints.usage.usageLog = [
          ...(manifestEntry.constraints.usage.usageLog || []),
          { timestamp: new Date().toISOString(), operation },
        ];
        await storage.put('manifests', manifestEntry);
      }

      await storage.addLog('query', 'Pipeline executed', { operation });

      return { success: true, token: newRotationToken, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      release();
    }
  }

  // ===== GET_STATS =====
  async handleGetStats() {
    try {
      const manifests = await storage.getAll('manifests');
      const logs = await storage.getLogs(1000);

      const total = manifests.length;
      const disabled = manifests.filter(m => !m.enabled).length;
      const rejectedLogs = logs.filter(l => l.type === 'rejected');
      const responseLogs = logs.filter(l => l.type === 'query' || l.type === 'exchange');

      return {
        success: true,
        stats: {
          manifests: { total, disabled },
          rejected: { total: rejectedLogs.length, percentage: total ? Math.round((rejectedLogs.length / logs.length) * 100) : 0 },
          responses: { total: responseLogs.length, increase: 0, percentage: 0 },
        },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ===== GET_CONNECTED_SERVICES =====
  async handleGetConnectedServices() {
    try {
      const providers = await storage.getAllKeys('tokens');
      const manifests = await storage.getAll('manifests');

      const services = providers
        .filter(p => p !== 'google' && !p.startsWith('client_'))
        .map(provider => {
          const related = manifests.filter(m => m.provider === provider);
          return {
            provider,
            active: related.filter(m => m.enabled).length,
            connections: related.length,
            lastUsed: related[0]?.grantedAt,
          };
        });

      return { success: true, services };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ===== CONNECT_SERVICE =====
  async handleConnectService({ provider, requiredScopes }) {
    try {
      const result = await this.tokenManager.initiateGoogleOAuth(requiredScopes);
      if (result.success) {
        await this.tokenManager.storeTokens('google', result.token, requiredScopes);
        await this.tokenManager.storeTokens(provider, result.token, requiredScopes);
      }
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ===== DISCONNECT_SERVICE =====
  async handleDisconnectService({ provider }) {
    try {
      await this.tokenManager.deleteStoredTokens(provider);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ===== GET_MANIFESTS =====
  async handleGetManifests() {
    try {
      const manifests = await storage.getAll('manifests');
      return { success: true, manifests };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ===== PREVIEW_MANIFEST =====
  async handlePreviewManifest({ manifest }) {
    if (!manifest) return { success: false, error: 'No manifest provided' };
    try {
      const runtime = new Runtime();
      const result = await runtime.executeManifestPreview(manifest);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ===== AUTHORIZE (consent flow) =====
  async handleAuthorize({ provider, manifest, redirectUri, state, accessType, schedule, codeChallenge }) {
    try {
      // Validate redirect URI
      if (redirectUri && !isValidRedirectUri(redirectUri)) {
        return { success: false, error: 'Invalid redirect URI' };
      }

      const parsed = parseManifest(manifest);
      const requiredScopes = this.tokenManager.inferScopes(parsed);

      const oauthResult = await this.tokenManager.initiateGoogleOAuth(requiredScopes);
      if (!oauthResult.success) return { success: false, error: 'Google OAuth failed' };

      // Generate auth code
      const authCode = generateAuthCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Generate signing key pair
      const keyPairData = await this.oauthCrypto.generateDPoPKeyPair();
      sessionKeyPairs.set(authCode, {
        privateKey: keyPairData.privateKey,
        publicKeyJWK: keyPairData.jwk,
      });

      // Encrypt Google tokens before storage
      let encryptedGoogleTokens = oauthResult.token;
      try {
        encryptedGoogleTokens = await this.tokenManager.encryptToken(oauthResult.token, provider);
      } catch (encryptError) {
        console.error('Token encryption failed, storing unencrypted:', encryptError.message);
      }

      // Store authorization
      const authData = {
        code: authCode,
        state,
        provider,
        redirectUri,
        expiresAt: expiresAt.toISOString(),
        manifest,
        access_type: accessType,
        schedule,
        googleTokens: encryptedGoogleTokens,
        pkce_challenge: codeChallenge || null,
        createdAt: new Date().toISOString(),
      };
      await storage.put('authorizations', authData);

      // Store manifest entry directly (no unnecessary getAll)
      const manifestEntry = {
        id: authCode,
        provider,
        title: parsed.title || provider,
        enabled: true,
        manifestText: manifest,
        accessType,
        authCode,
        grantedAt: new Date().toISOString(),
        constraints: {
          usage: { maxTotalUses: null, maxUsesPerPeriod: null, period: 'day', currentUses: 0, usageLog: [] },
          resource: { allowedFolders: [], allowedFileTypes: [], allowedLabels: [], obfuscateFields: [] },
          time: { expiresAt: null, durationMs: null, grantedAt: new Date().toISOString(), allowedWindows: [] },
        },
      };
      await storage.put('manifests', manifestEntry);

      await storage.addLog('authorize', 'Authorization granted', {});

      return {
        success: true,
        authCode,
        publicKeyJWK: keyPairData.jwk,
        redirectUri,
        state,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ===== REVOKE MANIFEST (cascade delete) =====
  async revokeManifest(manifestId) {
    await storage.delete('manifests', manifestId);
    await storage.delete('tokens', `client_${manifestId}`);
    await storage.delete('authorizations', manifestId);
    sessionKeyPairs.delete(manifestId);
    // Clean rotation token index
    for (const [token, provider] of rotationTokenIndex) {
      if (provider === `client_${manifestId}`) {
        rotationTokenIndex.delete(token);
      }
    }
  }

  // ===== CONSTRAINT CHECKING =====
  _checkConstraints(constraints) {
    if (!constraints) return null;
    const { usage, time } = constraints;

    if (usage) {
      if (usage.maxTotalUses !== null && (usage.currentUses || 0) >= usage.maxTotalUses) {
        return 'Usage limit reached';
      }
    }

    if (time) {
      if (time.expiresAt && new Date(time.expiresAt) < new Date()) {
        return 'Manifest has expired';
      }
      if (time.durationMs && time.grantedAt) {
        const elapsed = Date.now() - new Date(time.grantedAt).getTime();
        if (elapsed > time.durationMs) return 'Duration limit exceeded';
      }
    }

    return null;
  }

  _getAuthCodeFromTokenRecord(tokenRecord) {
    if (tokenRecord.authCode) {
      return tokenRecord.authCode;
    }
    const providerKey = typeof tokenRecord.provider === 'string' ? tokenRecord.provider : '';
    if (providerKey.startsWith('client_')) {
      return providerKey.slice('client_'.length);
    }
    return null;
  }

  async _cleanupExpired() {
    try {
      await storage.clearExpired('authorizations');
      await storage.clearExpired('tokens');
      const [authorizations, tokens] = await Promise.all([
        storage.getAll('authorizations'),
        storage.getAll('tokens'),
      ]);
      const activeAuthCodes = new Set();

      for (const authorization of authorizations) {
        if (authorization?.code) activeAuthCodes.add(authorization.code);
      }

      // Rebuild rotation token index
      rotationTokenIndex.clear();
      for (const token of tokens) {
        const authCode = this._getAuthCodeFromTokenRecord(token);
        if (authCode) activeAuthCodes.add(authCode);
        if (token.rotation_token && token.provider) {
          rotationTokenIndex.set(token.rotation_token, token.provider);
        }
      }

      for (const authCode of sessionKeyPairs.keys()) {
        if (!activeAuthCodes.has(authCode)) {
          sessionKeyPairs.delete(authCode);
        }
      }
    } catch (err) {
      console.warn('Cleanup error:', err.message);
    }
  }
}

// Singleton export
export const messageHandler = new MessageHandler();
