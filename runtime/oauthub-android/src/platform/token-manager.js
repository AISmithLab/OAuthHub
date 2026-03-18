/**
 * TokenManager for Android — same class API as Chrome version.
 * Uses @react-native-google-signin for OAuth (native Google Play Services).
 * Uses react-native-keychain (Android KeyStore) for per-service encryption keys.
 *   - SECURITY_LEVEL.SECURE_HARDWARE ensures keys are backed by TEE/StrongBox.
 *   - Keys are generated in JS (AES-256-GCM) but stored encrypted-at-rest by KeyStore.
 * Uses expo-sqlite (via storage.js) for token persistence.
 */
import * as Keychain from 'react-native-keychain';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { storage } from './storage';

const KEYSTORE_OPTIONS = {
  // Forces hardware-backed Android KeyStore (TEE or StrongBox)
  securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
  // Encrypted storage accessible only while the device is unlocked
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  // Additional data protection via Android EncryptedSharedPreferences
  storage: Keychain.STORAGE_TYPE.AES,
};

const SHARED_GOOGLE_AUTH_CONFIG = {
  clientId: '',
  scopes: ['openid', 'email', 'profile'],
};

const GOOGLE_TOKEN_PROVIDER_KEYS = ['google', 'gmail', 'google_calendar', 'google_drive', 'google_forms'];

export function configureGoogleOAuth({ clientId }) {
  if (typeof clientId === 'string') {
    SHARED_GOOGLE_AUTH_CONFIG.clientId = clientId;
  }
}

class TokenManager {
  constructor(options = {}) {
    this.DB_NAME = 'OAuthTokenDB';
    this.STORE_NAME = 'tokens';
    // Ephemeral in-memory store (cleared on app kill, replaces chrome.storage.session)
    this._ephemeral = new Map();

    this.scopeMap = {
      gmail: {
        read: 'https://www.googleapis.com/auth/gmail.readonly',
        write: 'https://www.googleapis.com/auth/gmail.send',
      },
      google_calendar: {
        read: 'https://www.googleapis.com/auth/calendar.events.readonly',
        write: 'https://www.googleapis.com/auth/calendar.events',
      },
      google_drive: {
        read: 'https://www.googleapis.com/auth/drive.readonly',
        write: 'https://www.googleapis.com/auth/drive',
      },
      google_forms: {
        read: 'https://www.googleapis.com/auth/forms.responses.readonly',
        write: 'https://www.googleapis.com/auth/forms.body',
      },
    };

    // AppAuth config for Google OAuth (RFC 8252)
    this.googleAuthConfig = SHARED_GOOGLE_AUTH_CONFIG;

    if (options.initialGoogleTokens?.access_token) {
      this._ephemeral.set('google_session_token', {
        ...options.initialGoogleTokens,
        storedAt: Date.now(),
      });
    }
  }

  configure({ clientId }) {
    configureGoogleOAuth({ clientId });
  }

  // ===== PER-SERVICE ENCRYPTION KEYS (Android KeyStore) =====

  async getOrCreateEncryptionKey(service = '_default') {
    const alias = `oauthub_key_${service}`;
    const stored = await this._getKeyFromKeyStore(alias);
    if (stored) {
      return await crypto.subtle.importKey(
        'jwk', stored, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
      );
    }

    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );
    const jwk = await crypto.subtle.exportKey('jwk', key);
    await this._setKeyInKeyStore(alias, jwk);
    return key;
  }

  async _getKeyFromKeyStore(alias) {
    try {
      const creds = await Keychain.getGenericPassword({
        service: alias,
        ...KEYSTORE_OPTIONS,
      });
      if (creds) return JSON.parse(creds.password);
      return null;
    } catch (error) {
      // Fall back to SECURE_SOFTWARE if hardware KeyStore unavailable (emulators)
      console.warn(`KeyStore hardware unavailable for ${alias}, falling back to SECURE_SOFTWARE:`, error.message);
      try {
        const creds = await Keychain.getGenericPassword({
          service: alias,
          securityLevel: Keychain.SECURITY_LEVEL.SECURE_SOFTWARE,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          storage: Keychain.STORAGE_TYPE.AES,
        });
        if (creds) return JSON.parse(creds.password);
        return null;
      } catch { return null; }
    }
  }

  async _setKeyInKeyStore(alias, jwk) {
    try {
      await Keychain.setGenericPassword(alias, JSON.stringify(jwk), {
        service: alias,
        ...KEYSTORE_OPTIONS,
      });
    } catch (error) {
      // Fall back to SECURE_SOFTWARE if hardware KeyStore unavailable (emulators)
      await Keychain.setGenericPassword(alias, JSON.stringify(jwk), {
        service: alias,
        securityLevel: Keychain.SECURITY_LEVEL.SECURE_SOFTWARE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        storage: Keychain.STORAGE_TYPE.AES,
      });
    }
  }

  async deleteKeyFromKeyStore(service = '_default') {
    const alias = `oauthub_key_${service}`;
    try {
      await Keychain.resetGenericPassword({ service: alias });
    } catch {}
  }

  // ===== ENCRYPTION (AES-256-GCM, per-service keys) =====

  async encryptToken(tokenData, service = '_default') {
    const key = await this.getOrCreateEncryptionKey(service);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const plaintext = encoder.encode(JSON.stringify(tokenData));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, plaintext
    );

    return {
      encrypted: true,
      iv: Array.from(iv),
      ciphertext: Array.from(new Uint8Array(ciphertext)),
      encryptedAt: Date.now(),
    };
  }

  async decryptToken(encryptedData, service = '_default') {
    if (!encryptedData || !encryptedData.encrypted) return encryptedData;

    const key = await this.getOrCreateEncryptionKey(service);
    const iv = new Uint8Array(encryptedData.iv);
    const ciphertext = new Uint8Array(encryptedData.ciphertext);

    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv }, key, ciphertext
      );
      return JSON.parse(new TextDecoder().decode(plaintext));
    } catch (error) {
      console.warn('Token decryption failed:', error.message);
      return null;
    }
  }

  // ===== STORAGE (expo-sqlite via storage.js) =====

  async storeTokens(provider, tokenData, scopes = []) {
    const sensitiveFields = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      id_token: tokenData.id_token,
    };
    const encryptedSensitive = await this.encryptToken(sensitiveFields, provider);

    // Compute expiresAt from expires_in if available
    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : tokenData.expiresAt || null;

    // Destructure to omit sensitive fields instead of setting undefined
    // (undefined values serialize to "undefined" in JSON.stringify)
    const { access_token, refresh_token, id_token, ...safeFields } = tokenData;

    const data = {
      ...safeFields,
      provider,
      _encrypted: encryptedSensitive,
      grantedScopes: scopes,
      expiresAt,
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
    };

    await storage.put('tokens', data);
  }

  async getTokens(provider) {
    const data = await storage.get('tokens', provider);
    if (!data) return null;

    if (data._encrypted) {
      const decrypted = await this.decryptToken(data._encrypted, provider);
      if (!decrypted) return null;
      return {
        ...data,
        access_token: decrypted.access_token,
        refresh_token: decrypted.refresh_token,
        id_token: decrypted.id_token,
        _encrypted: undefined,
      };
    }
    return data;
  }

  async deleteStoredTokens(provider) {
    await storage.delete('tokens', provider);
  }

  // ===== EPHEMERAL SESSION STORAGE (in-memory Map) =====

  async storeTokensEphemeral(key, data) {
    this._ephemeral.set(key, data);
  }

  async getTokensEphemeral(key) {
    return this._ephemeral.get(key) || null;
  }

  async clearTokensEphemeral(key) {
    this._ephemeral.delete(key);
  }

  // ===== GOOGLE OAUTH (@react-native-google-signin / Google Play Services) =====

  _configureGoogleSignIn(scopes) {
    const cid = this.googleAuthConfig.clientId;
    if (!cid) throw new Error('Google OAuth client ID not configured.');

    const apiScopes = scopes.filter(
      s => s !== 'openid' && s !== 'email' && s !== 'profile'
    );

    GoogleSignin.configure({
      webClientId: cid,
      offlineAccess: false,
      scopes: apiScopes,
    });
  }

  async _doGoogleSignIn(scopes) {
    this._configureGoogleSignIn(scopes);
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    await GoogleSignin.signIn();
    const tokens = await GoogleSignin.getTokens();
    return {
      accessToken: tokens.accessToken,
      idToken: tokens.idToken,
      expiresIn: 3600,
    };
  }

  async getGoogleToken(requiredScopes) {
    const scopes = [...new Set([...this.googleAuthConfig.scopes, ...requiredScopes])];
    try {
      const result = await this._doGoogleSignIn(scopes);
      return result.accessToken;
    } catch (error) {
      throw new Error(`Google OAuth failed: ${error.message}`);
    }
  }

  async initiateGoogleOAuth(requiredScopes) {
    const scopesWithIdentity = [...new Set(['openid', 'email', 'profile', ...requiredScopes])];

    try {
      const result = await this._doGoogleSignIn(scopesWithIdentity);
      const tokenData = {
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        id_token: result.idToken,
        token_type: 'Bearer',
        scope: requiredScopes.join(' '),
        expires_in: result.expiresIn || 3600,
      };

      await this.storeTokensEphemeral('google_session_token', {
        ...tokenData,
        storedAt: Date.now(),
      });

      return { success: true, token: tokenData };
    } catch (error) {
      throw new Error(`Google OAuth failed: ${error.message}`);
    }
  }

  isTokenExpired(tokenData) {
    if (!tokenData) return true;
    if (tokenData.expiresAt) {
      // Add 60s buffer to avoid using a token that's about to expire
      return new Date(tokenData.expiresAt).getTime() - 60000 < Date.now();
    }
    if (tokenData.expires_in && tokenData.storedAt) {
      return tokenData.storedAt + (tokenData.expires_in * 1000) - 60000 < Date.now();
    }
    return false;
  }

  async getValidGoogleToken(requiredScopes, _targetUrl = null, _method = 'GET', options = {}) {
    const { interactive = true } = options;

    // Try cached token first
    const cached = await this.getTokensEphemeral('google_session_token');
    if (this._hasRequiredScopes(cached, requiredScopes) && !this.isTokenExpired(cached)) {
      return { access_token: cached.access_token, token_type: 'Bearer', scope: requiredScopes.join(' ') };
    }

    // Try stored token
    const stored = await this._findStoredGoogleToken(requiredScopes);
    if (stored && stored.access_token) {
      // Check expiry and attempt refresh if expired
      if (this.isTokenExpired(stored) && stored.refresh_token) {
        try {
          const refreshed = await this.refreshGoogleToken(stored.refresh_token);
          return { access_token: refreshed.access_token, token_type: 'Bearer', scope: requiredScopes.join(' ') };
        } catch {
          // Refresh failed, fall through to interactive
        }
      } else if (!this.isTokenExpired(stored)) {
        return { access_token: stored.access_token, token_type: 'Bearer', scope: requiredScopes.join(' ') };
      }
    }

    if (!interactive) {
      throw new Error('Not authorized with Google. Please sign in first.');
    }

    // Interactive: use AppAuth
    return await this.getGoogleToken(requiredScopes).then(token => ({
      access_token: token, token_type: 'Bearer', scope: requiredScopes.join(' '),
    }));
  }

  async clearGoogleCachedToken() {
    this._ephemeral.delete('google_session_token');
    try { await this.deleteStoredTokens('google'); } catch {}
  }

  async _findStoredGoogleToken(requiredScopes) {
    for (const provider of GOOGLE_TOKEN_PROVIDER_KEYS) {
      const stored = await this.getTokens(provider);
      if (this._hasRequiredScopes(stored, requiredScopes)) {
        return stored;
      }
    }

    return null;
  }

  _hasRequiredScopes(tokenData, requiredScopes = []) {
    if (!tokenData?.access_token) {
      return false;
    }

    if (!requiredScopes.length) {
      return true;
    }

    const grantedScopes = Array.isArray(tokenData.grantedScopes)
      ? tokenData.grantedScopes
      : typeof tokenData.scope === 'string'
        ? tokenData.scope.split(' ').filter(Boolean)
        : [];

    return requiredScopes.every(scope => grantedScopes.includes(scope));
  }

  // ===== SCOPE INFERENCE (pure logic, identical to Chrome version) =====

  inferMinimalScopes(manifest) {
    const scopes = new Set();
    if (typeof manifest === 'string') throw new Error('inferMinimalScopes requires a parsed manifest object');
    for (const opName of manifest.pipeline) {
      const op = manifest.operators[opName];
      if (!op || !op.type) continue;
      if (op.type.toLowerCase() === 'pull' && this.scopeMap[op.resourceType]) {
        scopes.add(this.scopeMap[op.resourceType].read);
      }
    }
    return Array.from(scopes);
  }

  inferWriteScopes(manifest) {
    const scopes = new Set();
    if (typeof manifest === 'string') throw new Error('inferWriteScopes requires a parsed manifest object');
    for (const opName of manifest.pipeline) {
      const op = manifest.operators[opName];
      if (!op || !op.type) continue;
      if (op.type.toLowerCase() === 'write' && this.scopeMap[op.resourceType]) {
        scopes.add(this.scopeMap[op.resourceType].write);
      }
    }
    return Array.from(scopes);
  }

  inferScopes(manifest) {
    const scopes = new Set();
    if (typeof manifest === 'string') throw new Error('inferScopes requires a parsed manifest object');
    for (const opName of manifest.pipeline) {
      const op = manifest.operators[opName];
      if (!op || !op.type) continue;
      if (op.type.toLowerCase() === 'pull') scopes.add(this.scopeMap[op.resourceType]?.read);
      else if (op.type.toLowerCase() === 'write') scopes.add(this.scopeMap[op.resourceType]?.write);
    }
    scopes.delete(undefined);
    return Array.from(scopes);
  }

  async getGrantedScopes(token) {
    try {
      const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
      const data = await response.json();
      return data.scope ? data.scope.split(' ') : [];
    } catch { return []; }
  }

  async getMissingScopes(provider, requiredScopes) {
    const tokens = await this.getTokens(provider);
    if (!tokens || !tokens.access_token) return requiredScopes;
    const grantedScopes = await this.getGrantedScopes(tokens.access_token);
    return requiredScopes.filter(scope => !grantedScopes.includes(scope));
  }

  async getValidToken(provider, scopes) {
    if (provider === 'google') return await this.getGoogleToken(scopes);
    throw new Error(`Provider '${provider}' not supported.`);
  }

  async clearExpiredTokens() {
    await storage.clearExpired('tokens', 'expiresAt');
  }

  async getAllProviders() {
    return await storage.getAllKeys('tokens');
  }

  async refreshGoogleToken(refreshToken) {
    const config = { ...this.googleAuthConfig };
    try {
      const result = await refresh(config, { refreshToken });
      const tokenData = {
        access_token: result.accessToken,
        refresh_token: result.refreshToken || refreshToken,
        token_type: 'Bearer',
      };
      const existing = await this.getTokens('google');
      await this.storeTokens('google', { ...existing, ...tokenData }, existing?.grantedScopes || []);
      return tokenData;
    } catch (error) {
      throw new Error(`Token refresh failed: ${error.message}`);
    }
  }

  async exchangeGoogleAuthCode(_code, _state, _sessionId) {
    const requiredScopes = ['https://www.googleapis.com/auth/gmail.readonly'];
    return await this.getValidGoogleToken(requiredScopes);
  }
}

export default TokenManager;
