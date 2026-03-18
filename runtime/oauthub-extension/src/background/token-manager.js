/**
 * TokenManager using Chrome Identity API with manifest-based OAuth config.
 * Google auth is handled through chrome.identity.getAuthToken.
 * Clean interface for Google OAuth token management.
 */
class TokenManager {
  constructor() {
    this.DB_NAME = 'OAuthTokenDB';
    this.DB_VERSION = 1;
    this.STORE_NAME = 'tokens';
    
    this.scopeMap = {
      'gmail': {
        read: 'https://www.googleapis.com/auth/gmail.readonly',
        write: 'https://www.googleapis.com/auth/gmail.send'
      },
      'google_calendar': {
        read: 'https://www.googleapis.com/auth/calendar.events.readonly',
        write: 'https://www.googleapis.com/auth/calendar.events'
      },
      'google_drive': {
        read: 'https://www.googleapis.com/auth/drive.readonly',
        write: 'https://www.googleapis.com/auth/drive'
      },
      'google_forms': {
        read: 'https://www.googleapis.com/auth/forms.responses.readonly',
        write: 'https://www.googleapis.com/auth/forms.body'
      }
    };
  }
  // ===== ENCRYPTION FOR AT-REST TOKEN PROTECTION =====

  /**
   * Get or create the ephemeral encryption key stored in chrome.storage.session.
   * This key is automatically destroyed when the browser closes,
   * rendering all encrypted IndexedDB tokens unreadable.
   */
  async getOrCreateEncryptionKey() {
    const stored = await this.getTokensEphemeral('_encryption_key_jwk');

    if (stored) {
      return await crypto.subtle.importKey(
        'jwk',
        stored,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
    }

    // Generate new AES-256-GCM key
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    // Export and store in ephemeral session storage
    const jwk = await crypto.subtle.exportKey('jwk', key);
    await this.storeTokensEphemeral('_encryption_key_jwk', jwk);

    return key;
  }

  /**
   * Encrypt a token object before IndexedDB storage.
   * Uses AES-256-GCM with a random IV per encryption.
   */
  async encryptToken(tokenData) {
    const key = await this.getOrCreateEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const plaintext = encoder.encode(JSON.stringify(tokenData));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      plaintext
    );

    return {
      encrypted: true,
      iv: Array.from(iv),
      ciphertext: Array.from(new Uint8Array(ciphertext)),
      encryptedAt: Date.now()
    };
  }

  /**
   * Decrypt a token object read from IndexedDB.
   * Returns null if decryption fails (e.g., browser restarted and key was lost).
   */
  async decryptToken(encryptedData) {
    if (!encryptedData || !encryptedData.encrypted) {
      return encryptedData;
    }

    const key = await this.getOrCreateEncryptionKey();
    const iv = new Uint8Array(encryptedData.iv);
    const ciphertext = new Uint8Array(encryptedData.ciphertext);

    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        ciphertext
      );

      const decoder = new TextDecoder();
      return JSON.parse(decoder.decode(plaintext));
    } catch (error) {
      console.warn('Token decryption failed (key may have been rotated):', error.message);
      return null;
    }
  }

  // ===== DATABASE METHODS =====
  async getDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'provider' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  async storeTokens(provider, tokenData, scopes = []) {
    const db = await this.getDB();

    // Encrypt sensitive token fields before storage
    const sensitiveFields = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      id_token: tokenData.id_token
    };
    const encryptedSensitive = await this.encryptToken(sensitiveFields);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);

      const data = {
        provider,
        ...tokenData,
        // Replace plaintext tokens with encrypted blob
        access_token: undefined,
        refresh_token: undefined,
        id_token: undefined,
        _encrypted: encryptedSensitive,
        grantedScopes: scopes,
        timestamp: Date.now(),
        createdAt: new Date()
      };

      const request = store.put(data);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      transaction.oncomplete = () => db.close();
    });
  }

  async getTokens(provider) {
    const db = await this.getDB();
    const data = await new Promise((resolve, reject) => {
      const transaction = db.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.get(provider);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      transaction.oncomplete = () => db.close();
    });

    if (!data) return null;

    // Decrypt sensitive fields if they were encrypted
    if (data._encrypted) {
      const decrypted = await this.decryptToken(data._encrypted);
      if (!decrypted) {
        // Encryption key was lost (browser restarted) — token is invalid
        return null;
      }
      return {
        ...data,
        access_token: decrypted.access_token,
        refresh_token: decrypted.refresh_token,
        id_token: decrypted.id_token,
        _encrypted: undefined
      };
    }

    // Legacy unencrypted data
    return data;
  }

  async deleteStoredTokens(provider) {
    const db = await this.getDB();

    return await new Promise((resolve, reject) => {
      const transaction = db.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.delete(provider);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();

      transaction.oncomplete = () => db.close();
    });
  }

  // ===== EPHEMERAL SESSION STORAGE =====
  // Uses chrome.storage.session which is cleared when browser closes.
  // Ideal for sensitive token material that shouldn't persist across browser restarts.

  async storeTokensEphemeral(key, data) {
    return new Promise((resolve, reject) => {
      chrome.storage.session.set({ [key]: data }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  async getTokensEphemeral(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.session.get(key, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result[key] || null);
        }
      });
    });
  }

  async clearTokensEphemeral(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.session.remove(key, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  async clearGoogleCachedToken(token) {
    if (token) {
      await new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken({ token }, () => {
          if (chrome.runtime.lastError) {
            console.warn('Failed to clear cached Google token:', chrome.runtime.lastError.message);
          }
          resolve();
        });
      });
    }

    try {
      await this.clearTokensEphemeral('google_session_token');
    } catch (error) {
      console.warn('Failed to clear session Google token cache:', error.message);
    }

    try {
      await this.deleteStoredTokens('google');
    } catch (error) {
      console.warn('Failed to clear persisted Google token cache:', error.message);
    }
  }

  // ===== CHROME IDENTITY API METHODS =====
  async getGoogleToken(requiredScopes) {
    console.log('🔑 Requesting token for scopes:', requiredScopes);
    
    return new Promise((resolve, reject) => {
      // First try non-interactive (cached token)
      chrome.identity.getAuthToken({
        interactive: false,
        scopes: requiredScopes
      }, (token) => {
        if (chrome.runtime.lastError) {
          // No cached token, try interactive
          console.log('💬 No cached token, requesting interactive auth');
          chrome.identity.getAuthToken({
            interactive: true,
            scopes: requiredScopes
          }, (interactiveToken) => {
            if (chrome.runtime.lastError) {
              console.error('❌ Interactive auth failed:', chrome.runtime.lastError.message);
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              console.log('✅ Token obtained via interactive auth');
              resolve(interactiveToken);
            }
          });
        } else {
          console.log('✅ Token obtained from cache');
          resolve(token);
        }
      });
    });
  }

  // Helper method to validate token and get granted scopes
  async getGrantedScopes(token) {
    try {
      const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${token}`
      );
      const data = await response.json();
      return data.scope ? data.scope.split(' ') : [];
    } catch (error) {
      console.error('Token validation failed:', error);
      return [];
    }
  }

  // Optional: Get full token info (for debugging)
  async getTokenInfo(token) {
    try {
      const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${token}`
      );
      const data = await response.json();
      return {
        scope: data.scope ? data.scope.split(' ') : [],
        expires_in: data.expires_in,
        email: data.email,
        valid: !data.error
      };
    } catch (error) {
      console.error('Token validation failed:', error);
      return { valid: false, error: error.message };
    }
  }
  // ===== SCOPE AND TOKEN MANAGEMENT =====
  
  /**
   * Infer minimal (read-only) scopes from manifest for on-demand permission granting.
   * Only returns read scopes initially; write scopes can be upgraded later.
   */
  inferMinimalScopes(manifest) {
    const scopes = new Set();
    if (typeof manifest === 'string') {
      throw new Error('inferMinimalScopes requires a parsed manifest object, not a string');
    }

    for (const opName of manifest.pipeline) {
      const op = manifest.operators[opName];
      if (!op || !op.type) continue;
      const type = op.type.toLowerCase();
      // Only grant read scopes initially — write requires explicit upgrade
      if (type === 'pull' && this.scopeMap[op.resourceType]) {
        scopes.add(this.scopeMap[op.resourceType].read);
      }
    }

    return Array.from(scopes);
  }

  /**
   * Get the write scopes that would be needed for a manifest's Write operators.
   * Used for on-demand scope upgrade when the manifest tries to write.
   */
  inferWriteScopes(manifest) {
    const scopes = new Set();
    if (typeof manifest === 'string') {
      throw new Error('inferWriteScopes requires a parsed manifest object, not a string');
    }

    for (const opName of manifest.pipeline) {
      const op = manifest.operators[opName];
      if (!op || !op.type) continue;
      if (op.type.toLowerCase() === 'write' && this.scopeMap[op.resourceType]) {
        scopes.add(this.scopeMap[op.resourceType].write);
      }
    }

    return Array.from(scopes);
  }

  // Scope inference from manifest (still needed by runtime)
  inferScopes(manifest) {
    const scopes = new Set();
    if (typeof manifest === 'string') {
      throw new Error('inferScopes requires a parsed manifest object, not a string');
    }
    const parsedManifest = manifest;

    for (const opName of parsedManifest.pipeline) {
      const op = parsedManifest.operators[opName];
      if (!op || !op.type) continue;
      if (op.type.toLowerCase() === 'pull') {
        scopes.add(this.scopeMap[op.resourceType].read);
      } else if (op.type.toLowerCase() === 'write') {
        scopes.add(this.scopeMap[op.resourceType].write);
      }
    }

    return Array.from(scopes);
  }

  async getMissingScopes(provider, requiredScopes) {
    const tokens = await this.getTokens(provider);
    if (!tokens || !tokens.access_token) {
      return requiredScopes;
    }

    const grantedScopes = await this.getGrantedScopes(tokens.access_token);
    return requiredScopes.filter(scope => !grantedScopes.includes(scope));
  }

  // Main method for getting valid tokens (simplified)
  async getValidToken(provider, scopes) {
    if (provider === 'google') {
      return await this.getGoogleToken(scopes);
    }
    
    throw new Error(`Provider '${provider}' not supported. Only 'google' is supported.`);
  }
  
  // ===== UTILITY METHODS =====
  
  async clearExpiredTokens() {
    const db = await this.getDB();
    const hourAgo = Date.now() - 3600000;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const index = store.index('timestamp');
      const range = IDBKeyRange.upperBound(hourAgo);
      const request = index.openCursor(range);

      const deletedItems = [];

      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          deletedItems.push(cursor.value.provider);
          cursor.delete();
          cursor.continue();
        }
      };

      transaction.oncomplete = () => {
        db.close();
        resolve(deletedItems);
      };
    });
  }

  async getAllProviders() {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.getAllKeys();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      transaction.oncomplete = () => db.close();
    });
  }

  /**
   * Load Google client configuration from the extension manifest.
   */
  async loadClientConfig() {
    try {
      const manifest = chrome.runtime.getManifest();
      const oauthConfig = manifest.oauth2;
      
      // For Chrome extensions, we only need client_id and should NOT use client_secret
      // The redirect_uri should be the Chrome extension redirect URL
      if (!oauthConfig?.client_id) {
        throw new Error('Invalid manifest.oauth2 configuration: missing client_id');
      }

      return {
        client_id: oauthConfig.client_id,
        redirect_uri: chrome.identity.getRedirectURL()
      };
    } catch (error) {
      console.error('Failed to load client configuration:', error);
      // Fallback: return null so caller can handle the error
      return null;
    }
  }

  /**
   * Initiate Google OAuth using Chrome's built-in Identity API
   * Much simpler - Chrome handles all token management automatically
   */
  async initiateGoogleOAuth(requiredScopes, options = {}) {
    try {
      console.log('🔵 Starting Google OAuth with Chrome Identity API...');
      console.log('Requested scopes:', requiredScopes);

      // Ensure identity scopes are always included for user identity verification
      const scopesWithIdentity = [...new Set([
        'openid',
        'email',
        'profile',
        ...requiredScopes
      ])];

      // Use Chrome's built-in OAuth
      return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({
          interactive: true,
          scopes: scopesWithIdentity
        }, async (token) => {
          if (chrome.runtime.lastError) {
            console.error('❌ Chrome Identity OAuth failed:', chrome.runtime.lastError.message);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          
          if (!token) {
            reject(new Error('No token received from Chrome Identity API'));
            return;
          }
          
          // Chrome handles token storage automatically
          const tokenData = {
            access_token: token,
            token_type: 'Bearer',
            scope: requiredScopes.join(' ')
          };

          // Store in ephemeral session storage (cleared when browser closes)
          try {
            await this.storeTokensEphemeral('google_session_token', {
              ...tokenData,
              storedAt: Date.now()
            });
          } catch (e) {
            console.warn('Failed to store token in session storage:', e.message);
          }

          console.log('✅ Google OAuth completed successfully with Chrome Identity API!');
          resolve({ success: true, token: tokenData });
        });
      });
    } catch (error) {
      console.error('❌ Google OAuth failed:', error);
      throw new Error(`Google OAuth failed: ${error.message}`);
    }
  }
  
  /**
   * Get a valid Google token using Chrome's Identity API.
   * Chrome manages the interactive flow and cached tokens.
   */
  async getValidGoogleToken(requiredScopes, targetUrl = null, method = 'GET', options = {}) {
    const { interactive = true } = options;
    try {
      console.log('🔍 Getting valid Google token for scopes:', requiredScopes, '(interactive:', interactive, ')');

      return new Promise((resolve, reject) => {
        // First try to get token non-interactively (cached)
        chrome.identity.getAuthToken({
          interactive: false,
          scopes: requiredScopes
        }, (token) => {
          if (chrome.runtime.lastError || !token) {
            if (!interactive) {
              // Non-interactive mode: fail if no cached token
              reject(new Error('Not authorized with Google. Please sign in first.'));
              return;
            }

            console.log('⚠️ No cached token, requesting interactive auth...');

            // No cached token, request interactive auth
            chrome.identity.getAuthToken({
              interactive: true,
              scopes: requiredScopes
            }, async (newToken) => {
              if (chrome.runtime.lastError) {
                console.error('❌ Interactive auth failed:', chrome.runtime.lastError.message);
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }

              if (!newToken) {
                reject(new Error('No token received from Chrome Identity API'));
                return;
              }

              // Chrome handles token storage automatically
              const tokenData = {
                access_token: newToken,
                token_type: 'Bearer',
                scope: requiredScopes.join(' ')
              };

              resolve(tokenData);
            });
          } else {
            // Got cached token - Chrome handles storage automatically
            console.log('✅ Using cached token from Chrome Identity API');

            const tokenData = {
              access_token: token,
              token_type: 'Bearer',
              scope: requiredScopes.join(' ')
            };

            resolve(tokenData);
          }
        });
      });
    } catch (error) {
      throw new Error(`Failed to get valid Google token: ${error.message}`);
    }
  }
  
  /**
   * Exchange a Google OAuth authorization code for tokens.
   * Validates the state parameter to prevent CSRF attacks.
   */
  async exchangeGoogleAuthCode(code, state, sessionId) {
    if (!code) {
      throw new Error('Missing authorization code');
    }
    if (!state) {
      throw new Error('Missing state parameter — possible CSRF attack');
    }

    // Validate state against the stored session state
    const storedState = await this.getTokensEphemeral(`oauth_state_${sessionId}`);
    if (storedState && storedState !== state) {
      throw new Error('State mismatch — possible CSRF attack');
    }

    // Clean up stored state after validation
    if (storedState) {
      await this.clearTokensEphemeral(`oauth_state_${sessionId}`);
    }

    // Use Chrome Identity API to get a valid token for the required scopes
    // The authorization code from the Google callback has already been consumed
    // by Chrome's identity flow; we obtain the token via the cached auth.
    const requiredScopes = ['https://www.googleapis.com/auth/gmail.readonly'];
    return await this.getValidGoogleToken(requiredScopes);
  }

  /**
   * Simple token refresh method (for compatibility)
   */
  async refreshGoogleToken(refreshToken, sessionId) {
    try {
      const clientConfig = await this.loadClientConfig();
      if (!clientConfig) {
        throw new Error('Could not load client configuration');
      }

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: new URLSearchParams({
          client_id: clientConfig.client_id,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
          // Chrome extension OAuth uses a public client ID here.
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
      }

      const tokenData = await response.json();
      
      // Update stored tokens
      const existingToken = await this.getTokens('google');
      const updatedTokenData = {
        ...existingToken,
        ...tokenData,
        expiresAt: new Date(Date.now() + (tokenData.expires_in * 1000)),
        timestamp: Date.now()
      };

      await this.storeTokens('google', updatedTokenData, existingToken?.grantedScopes || []);
      
      return updatedTokenData;
    } catch (error) {
      throw new Error(`Token refresh failed: ${error.message}`);
    }
  }
}

export default TokenManager;
