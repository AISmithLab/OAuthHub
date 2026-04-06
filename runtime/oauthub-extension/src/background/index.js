// Right-click context menu on the extension icon → Manifest IDE (developer only)
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'open-manifest-ide',
    title: 'Manifest IDE',
    contexts: ['action']
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'open-manifest-ide') {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') + '#/ide' });
  }
});

// Static imports to avoid chunk loading issues
import TokenManager from './token-manager.js';
import Runtime from './runtime.js';
import Scheduler from './scheduler.js';
import OAuthCrypto from './oauth-crypto.js';

// Module imports
import {
  generateAuthCode,
  authDbReady,
  tokenDbReady,
  getAuthDb,
  getTokenDb,
  cleanupExpiredCodes,
  cleanupExpiredTokens,
  getAllAuthorizations,
  deleteAuthorizationCodes,
  extractStoredGoogleAccessToken,
  reserveAccessToken,
  releaseReservedAccessToken,
  invalidateReservedAccessToken,
  rotateReservedAccessToken
} from './db-manager.js';

import {
  exchangeAuthorizationCode,
  handleAccessTypeBehavior,
  validateRedirectUri,
  redirectToExternalClient,
  processAuthorizationInBackground
} from './auth-flow.js';

import {
  isOAuthHubEnabled,
  assertOAuthHubEnabled,
  enforceConstraints,
  recordConstraintUsage
} from './constraint-engine.js';

import {
  parseScheduleFormat,
  isValidScheduleFormat,
  isValidBasicSchedule,
  setupScheduledExecution
} from './schedule-manager.js';

// Security: crypto utilities and per-session signing key pairs
const oauthCrypto = new OAuthCrypto();
const sessionKeyPairs = new Map();
const tokenExecutionLocks = new Map();
const manifestExecutionLocks = new Map();

// Complete DOM polyfill for GraphQL library in service worker context
if (typeof document === 'undefined') {
  globalThis.document = {
    createElement: () => ({
      setAttribute: () => {},
      getAttribute: () => null,
      appendChild: () => {},
      removeChild: () => {},
      style: {},
      innerHTML: '',
      textContent: ''
    }),
    createElementNS: () => ({
      setAttribute: () => {},
      getAttribute: () => null,
      appendChild: () => {},
      removeChild: () => {},
      style: {},
      innerHTML: '',
      textContent: ''
    }),
    getElementById: () => null,
    getElementsByTagName: () => [],
    getElementsByClassName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    body: { appendChild: () => {}, removeChild: () => {} },
    head: { appendChild: () => {}, removeChild: () => {} },
    documentElement: { style: {} }
  };
}

if (typeof window === 'undefined') {
  globalThis.window = {
    document: globalThis.document,
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { href: '', protocol: 'chrome-extension:' },
    navigator: { userAgent: 'Chrome Extension Service Worker' }
  };
}

const withSerializedLock = async (lockMap, key, fn) => {
  const previous = lockMap.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  lockMap.set(key, queued);

  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (lockMap.get(key) === queued) {
      lockMap.delete(key);
    }
  }
};

const getManifestExecutionKey = (authData) => {
  const provider = authData?.provider || 'unknown';
  const manifestText = typeof authData?.manifest === 'string'
    ? authData.manifest
    : JSON.stringify(authData?.manifest ?? null);
  return `${provider}::${manifestText}`;
};

// Shared deps object for setupScheduledExecution and handleAccessTypeBehavior
const getSetupScheduledExecutionDeps = () => ({
  sessionKeyPairs,
  oauthCrypto,
  withSerializedLock,
  manifestExecutionLocks,
  getManifestExecutionKey,
  recordLog
});

const getHandleAccessTypeBehaviorDeps = () => ({
  sessionKeyPairs,
  oauthCrypto,
  originalTabId,
  setupScheduledExecutionDeps: getSetupScheduledExecutionDeps()
});

let originalTabId = null;

// Listen for messages from external web pages (via externally_connectable)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;

  // --- EXCHANGE_AUTH_CODE: Verify PKCE, issue access token ---
  if (message.type === 'EXCHANGE_AUTH_CODE') {
    const { code, code_verifier } = message;

    (async () => {
      try {
        await authDbReady;
        const authDb = getAuthDb();

        if (!code || !code_verifier) {
          sendResponse({ success: false, error: 'Missing code or code_verifier' });
          return;
        }

        // Look up auth code in IndexedDB
        const authData = await new Promise((resolve, reject) => {
          const tx = authDb.transaction(['authorizations'], 'readonly');
          const store = tx.objectStore('authorizations');
          const req = store.get(code);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });

        if (!authData) {
          sendResponse({ success: false, error: 'Invalid or expired authorization code' });
          return;
        }

        if (new Date(authData.expiresAt) <= new Date()) {
          sendResponse({ success: false, error: 'Authorization code has expired' });
          return;
        }

        // PKCE verification: hash(code_verifier) must match stored code_challenge
        if (!authData.pkce_challenge) {
          sendResponse({ success: false, error: 'Authorization missing PKCE challenge' });
          return;
        }

        const pkceValid = await oauthCrypto.verifyPKCE(code_verifier, authData.pkce_challenge);
        if (!pkceValid) {
          console.error('SECURITY: PKCE verification failed for auth code:', code.substring(0, 8) + '...');
          sendResponse({ success: false, error: 'PKCE verification failed' });
          return;
        }

        // Generate access token
        const accessToken = generateAuthCode();

        // Token lifetime based on access_type
        const tokenLifetimes = {
          'install_time': 5 * 60 * 1000,
          'scheduled_time': 30 * 24 * 60 * 60 * 1000,
          'user_driven': 60 * 60 * 1000
        };
        const expiresIn = tokenLifetimes[authData.access_type] || 60 * 60 * 1000;

        // Create new auth record keyed by access token (carries over signing keys, etc.)
        const tokenRecord = {
          code: accessToken,  // keyPath — now holds the access token
          state: authData.state,
          provider: authData.provider,
          redirectUri: authData.redirectUri,
          expiresAt: new Date(Date.now() + expiresIn),
          createdAt: new Date(),
          manifest: authData.manifest,
          access_type: authData.access_type,
          schedule: authData.schedule,
          googleTokens: authData.googleTokens,
          signingKeyPair: authData.signingKeyPair,
          // Preserve PKCE challenge — verified on every query as well
          pkce_challenge: authData.pkce_challenge,
          // Mark as exchanged so reserveAccessToken rejects raw auth codes
          exchanged: true
        };

        // Migrate in-memory signing key pair to new token key
        const memKeyPair = sessionKeyPairs.get(code);
        if (memKeyPair) {
          sessionKeyPairs.delete(code);
          sessionKeyPairs.set(accessToken, memKeyPair);
        }

        // Store new token record and delete consumed auth code (single transaction)
        await new Promise((resolve, reject) => {
          const tx = authDb.transaction(['authorizations'], 'readwrite');
          const store = tx.objectStore('authorizations');
          store.add(tokenRecord);
          store.delete(code);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });

        console.log('✅ EXCHANGE_AUTH_CODE: PKCE verified, access token issued');
        sendResponse({
          success: true,
          access_token: accessToken,
          expires_in: Math.floor(expiresIn / 1000)
        });
      } catch (error) {
        console.error('EXCHANGE_AUTH_CODE error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true; // async response
  }

  // --- EXECUTE_QUERY: Verify access token, execute manifest pipeline ---
  if (message.type === 'EXECUTE_QUERY') {
    const { token, manifest, operation, data } = message;

    (async () => {
      let authData = null;
      let manifestExecutionStarted = false;
      let newToken = null;

      try {
        await authDbReady;

        if (!token || !manifest) {
          sendResponse({ success: false, error: 'Missing token or manifest' });
          return;
        }

        authData = await withSerializedLock(tokenExecutionLocks, token, async () => {
          return reserveAccessToken(token);
        });

        if (!authData.manifest || JSON.stringify(manifest) !== JSON.stringify(authData.manifest)) {
          throw new Error('Manifest does not match the consented manifest');
        }

        const manifestLockKey = getManifestExecutionKey(authData);

        await withSerializedLock(manifestExecutionLocks, manifestLockKey, async () => {
          const constraintCheck = await enforceConstraints(authData);
          if (!constraintCheck.allowed) {
            throw new Error(constraintCheck.reason);
          }

          // Resolve signing key pair for payload signatures
          let signingPrivateKey = null;
          let signingPublicKeyJWK = null;

          const memKeyPair = sessionKeyPairs.get(token);
          if (memKeyPair) {
            signingPrivateKey = memKeyPair.privateKey;
            signingPublicKeyJWK = memKeyPair.publicKeyJWK;
          } else if (authData.signingKeyPair) {
            try {
              let privateKeyJWK = null;

              // New format: private key is encrypted at rest
              if (authData.signingKeyPair.privateKeyJWK_encrypted) {
                const tm = new TokenManager();
                privateKeyJWK = await tm.decryptToken(authData.signingKeyPair.privateKeyJWK_encrypted);
                if (!privateKeyJWK) {
                  throw new Error('Failed to decrypt signing key — session may have expired');
                }
              }
              // Legacy format: plaintext private key (backward compat)
              else if (authData.signingKeyPair.privateKeyJWK) {
                privateKeyJWK = authData.signingKeyPair.privateKeyJWK;
              }

              if (privateKeyJWK) {
                signingPrivateKey = await crypto.subtle.importKey(
                  'jwk', privateKeyJWK,
                  { name: 'ECDSA', namedCurve: 'P-256' },
                  false, ['sign']
                );
                signingPublicKeyJWK = authData.signingKeyPair.publicKeyJWK;
                sessionKeyPairs.set(token, { privateKey: signingPrivateKey, publicKeyJWK: signingPublicKeyJWK });
              }
            } catch (e) {
              console.warn('Failed to import signing key from auth record:', e.message);
            }
          }

          if (!signingPrivateKey) {
            console.error('⚠️ EXECUTE_QUERY: No signing key found. authData has signingKeyPair:', !!authData.signingKeyPair);
            throw new Error('Signing key not found — please re-authorize');
          }

          const runtime = new Runtime({
            privateKey: signingPrivateKey,
            publicKeyJWK: signingPublicKeyJWK,
            constraints: constraintCheck.manifestEntry?.constraints || null,
            interactive: false
          });

          manifestExecutionStarted = true;
          await runtime.executeManifest(authData.manifest, {
            operation: operation || 'read',
            data: data || undefined
          });

          await recordConstraintUsage(authData);

          newToken = generateAuthCode();
          await rotateReservedAccessToken(token, newToken, authData);

          const rotateKeyPair = sessionKeyPairs.get(token);
          if (rotateKeyPair) {
            sessionKeyPairs.delete(token);
            sessionKeyPairs.set(newToken, rotateKeyPair);
          }
        });

        console.log('✅ EXECUTE_QUERY: Manifest executed, token rotated');
        recordLog({ status: 'approved', type: 'query', manifest: authData.provider || 'unknown', initiator: 'client' });
        sendResponse({ success: true, token: newToken });
      } catch (error) {
        if (authData) {
          try {
            if (manifestExecutionStarted) {
              await invalidateReservedAccessToken(token);
            } else {
              await releaseReservedAccessToken(token);
            }
          } catch (cleanupError) {
            console.warn('Failed to clean up reserved access token:', cleanupError.message);
          }
        }

        console.error('EXECUTE_QUERY error:', error);
        recordLog({
          status: 'rejected',
          type: 'query',
          manifest: authData?.provider || 'unknown',
          initiator: 'client',
          reason: error.message
        });
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true; // async response
  }
});

// ===== LOGGING & STATS HELPERS =====
async function recordLog(entry) {
  const { logs = [] } = await chrome.storage.local.get('logs');
  logs.unshift({ ...entry, time: new Date().toISOString() });
  // Keep last 500 entries
  if (logs.length > 500) logs.length = 500;
  await chrome.storage.local.set({ logs });
}

async function computeStats() {
  // Count manifests from authorizations in IDB
  const authDb = getAuthDb();
  const allAuths = await new Promise((resolve) => {
    try {
      const tx = authDb.transaction(['authorizations'], 'readonly');
      const store = tx.objectStore('authorizations');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch { resolve([]); }
  });

  // Unique manifests by provider+pipeline
  const manifestSet = new Set();
  let disabledCount = 0;
  for (const auth of allAuths) {
    if (auth.manifest) {
      const key = auth.provider + '|' + (typeof auth.manifest === 'string' ? auth.manifest : JSON.stringify(auth.manifest));
      manifestSet.add(key);
    }
  }

  // Get manifests from storage for disabled count
  const { manifests: storedManifests = [] } = await chrome.storage.local.get('manifests');
  disabledCount = storedManifests.filter(m => !m.enabled).length;

  // Count from logs
  const { logs = [] } = await chrome.storage.local.get('logs');
  const total = logs.length;
  const rejected = logs.filter(l => l.status === 'rejected').length;
  const approved = logs.filter(l => l.status === 'approved').length;

  // Calculate recent increase (last 24h vs previous 24h)
  const now = Date.now();
  const recentLogs = logs.filter(l => now - new Date(l.time).getTime() < 24 * 60 * 60 * 1000);
  const olderLogs = logs.filter(l => {
    const age = now - new Date(l.time).getTime();
    return age >= 24 * 60 * 60 * 1000 && age < 48 * 60 * 60 * 1000;
  });
  const increase = recentLogs.length - olderLogs.length;
  const pct = olderLogs.length > 0 ? ((increase / olderLogs.length) * 100).toFixed(1) : 0;

  return {
    manifests: { total: Math.max(manifestSet.size, storedManifests.length), disabled: disabledCount },
    rejected: { total: rejected, percentage: total > 0 ? ((rejected / total) * 100).toFixed(1) : 0 },
    responses: { total: approved, increase: Math.max(0, increase), percentage: Number(pct) }
  };
}

async function getConnectedServices() {
  const allAuths = await getAllAuthorizations().catch(() => []);

  // Only service-manager connections should appear in the Services panel.
  const services = {};
  const now = new Date();
  const activeServiceAuths = allAuths.filter(auth =>
    auth.access_type === 'service_connect' && new Date(auth.expiresAt) > now
  );

  for (const auth of activeServiceAuths) {
    const provider = auth.provider || 'unknown';
    if (!services[provider]) {
      services[provider] = { provider, connections: 0, active: 0, lastUsed: null };
    }
    services[provider].connections++;
    services[provider].active++;
    const created = new Date(auth.createdAt);
    if (!services[provider].lastUsed || created > new Date(services[provider].lastUsed)) {
      services[provider].lastUsed = created.toISOString();
    }
  }
  return Object.values(services);
}

// Listen for OAuth requests (Flow 1 - original implementation)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Guard: ignore messages without a type (e.g. Chrome internals, malformed messages)
  if (!message || typeof message.type !== 'string') return;

  // ===== SENDER VERIFICATION =====
  const isInternalSender = sender.id === chrome.runtime.id;

  // Messages that MUST come from within this extension only
  const internalOnlyMessages = [
    'AUTH_GRANTED', 'AUTH_DENIED',
    'INITIATE_GOOGLE_OAUTH_FOR_EXTERNAL_CLIENT',
    'INITIATE_GOOGLE_OAUTH',
    'EXECUTE_MANIFEST',
    'DEBUG_EXECUTE_MANIFEST',
    'GOOGLE_OAUTH_CALLBACK',
    'GET_GOOGLE_TOKEN',
    'REFRESH_GOOGLE_TOKEN',
    'VALIDATE_CLIENT_ID',
    'GET_STATS',
    'GET_CONNECTED_SERVICES',
    'CONNECT_SERVICE',
    'DISCONNECT_SERVICE',
    'UPDATE_MANIFEST_CONSTRAINTS',
    'GET_MANIFEST_CONSTRAINTS',
    'REVOKE_MANIFEST',
    'UPGRADE_SCOPES'
  ];

  if (internalOnlyMessages.includes(message.type) && !isInternalSender) {
    console.error(`SECURITY: Rejected ${message.type} from unauthorized sender:`, sender.id);
    sendResponse({ success: false, error: 'Unauthorized sender' });
    return;
  }

  // For token-related external messages, reject web page origins
  if ((message.type === 'EXCHANGE_TOKEN' || message.type === 'GET_TOKEN') &&
      (!sender.id || sender.origin?.startsWith('http'))) {
    console.error('SECURITY: Rejected token request from web origin:', sender.origin);
    sendResponse({ success: false, error: 'Unauthorized sender' });
    return;
  }

  // Handle authorization granted (original)
  if (message.type === "AUTH_GRANTED") {
    void (async () => {
      try {
        await assertOAuthHubEnabled();
        await authDbReady;
        const authDb = getAuthDb();
        const { redirectUri, state, provider, manifest, access_type } = message.data;

        const authCode = generateAuthCode();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        const transaction = authDb.transaction(["authorizations"], "readwrite");
        const store = transaction.objectStore("authorizations");

        store.add({
          code: authCode,
          state: state,
          provider: provider,
          redirectUri: redirectUri,
          expiresAt: expiresAt,
          createdAt: new Date(),
          manifest: manifest,
          access_type: access_type,
        });

        const callbackUrl = new URL(redirectUri);
        callbackUrl.searchParams.append('code', authCode);
        callbackUrl.searchParams.append('state', state);

        if (originalTabId) {
          chrome.tabs.update(originalTabId, {
            url: callbackUrl.toString()
          });
        }

        recordLog({
          status: 'approved', type: 'auth_grant', manifest: provider,
          initiator: new URL(redirectUri).hostname
        });
      } catch (error) {
        console.error('Error handling AUTH_GRANTED:', error);
        try {
          const { redirectUri, state } = message.data || {};
          if (redirectUri && originalTabId) {
            const callbackUrl = new URL(redirectUri);
            callbackUrl.searchParams.append('error', 'temporarily_unavailable');
            callbackUrl.searchParams.append('state', state || '');
            chrome.tabs.update(originalTabId, {
              url: callbackUrl.toString()
            });
          }
        } catch {
          // best effort redirect on failure
        }
      }
    })();
    return true;
  }

  // Handle authorization denied (original)
  else if (message.type === "AUTH_DENIED") {
    try {
      const { redirectUri, state } = message.data;

      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.append('error', 'access_denied');
      callbackUrl.searchParams.append('state', state);

      if (originalTabId) {
        chrome.tabs.update(originalTabId, {
          url: callbackUrl.toString()
        });
      }

      recordLog({
        status: 'rejected', type: 'auth_deny', manifest: 'unknown',
        initiator: redirectUri ? new URL(redirectUri).hostname : 'unknown'
      });
    } catch (error) {
      console.error('Error handling AUTH_DENIED:', error);
    }
  }

  // Popup stats & connected services
  else if (message.type === "GET_STATS") {
    (async () => {
      try {
        await authDbReady;
        const stats = await computeStats();
        sendResponse({ success: true, stats });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  else if (message.type === "GET_CONNECTED_SERVICES") {
    (async () => {
      try {
        await authDbReady;
        const services = await getConnectedServices();
        sendResponse({ success: true, services });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  else if (message.type === "CONNECT_SERVICE") {
    (async () => {
      try {
        await authDbReady;
        await assertOAuthHubEnabled();
        const authDb = getAuthDb();
        const { provider, requiredScopes } = message.data;
        const tokenManager = new TokenManager();

        // 1. Trigger real Google OAuth consent via chrome.identity
        const result = await tokenManager.initiateGoogleOAuth(requiredScopes);
        const accessToken = result.token?.access_token || result.token;

        if (!accessToken) {
          sendResponse({ success: false, error: 'No token received from Google' });
          return;
        }

        // 2. Verify the token actually works by hitting a Google API endpoint
        const verifyEndpoints = {
          google_calendar: 'https://www.googleapis.com/calendar/v3/calendars/primary',
          gmail: 'https://www.googleapis.com/gmail/v1/users/me/profile',
          google_drive: 'https://www.googleapis.com/drive/v3/about?fields=user',
          google_forms: 'https://www.googleapis.com/oauth2/v3/userinfo',
        };
        const verifyUrl = verifyEndpoints[provider] || verifyEndpoints.google_forms;
        const verifyRes = await fetch(verifyUrl, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!verifyRes.ok) {
          const errBody = await verifyRes.text();
          console.error('Token verification failed:', verifyRes.status, errBody);
          // Remove the cached token so user can retry
          await tokenManager.clearGoogleCachedToken(accessToken);
          sendResponse({ success: false, error: `Google API returned ${verifyRes.status} — token may not have the required permissions` });
          return;
        }

        console.log(`✅ CONNECT_SERVICE: ${provider} token verified against Google API`);

        // 3. Store authorization record with real token + granted scopes
        const encryptedGoogleTokens = await tokenManager.encryptToken({ access_token: accessToken });
        const tx = authDb.transaction(['authorizations'], 'readwrite');
        const store = tx.objectStore('authorizations');
        const code = generateAuthCode();
        store.add({
          code,
          provider,
          state: 'service_connect',
          redirectUri: '',
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          manifest: null,
          access_type: 'service_connect',
          grantedScopes: requiredScopes,
          googleTokens: encryptedGoogleTokens,
        });
        await new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });

        recordLog({ status: 'approved', type: 'service_connect', manifest: provider, initiator: 'user' });
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  else if (message.type === "DISCONNECT_SERVICE") {
    (async () => {
      try {
        await authDbReady;
        const provider = message.provider;
        const tokenManager = new TokenManager();

        // Only remove long-lived service-manager authorizations for this provider.
        const allAuths = await getAllAuthorizations();
        const matchingAuths = allAuths.filter(a =>
          a.provider === provider && a.access_type === 'service_connect'
        );
        const toDelete = matchingAuths.map(a => a.code);

        if (toDelete.length > 0) {
          await deleteAuthorizationCodes(toDelete);
          for (const code of toDelete) {
            sessionKeyPairs.delete(code);
          }
        }

        const accessTokens = [];
        for (const authRecord of matchingAuths) {
          const accessToken = await extractStoredGoogleAccessToken(tokenManager, authRecord);
          if (accessToken) {
            accessTokens.push(accessToken);
          }
        }

        for (const accessToken of accessTokens) {
          await tokenManager.clearGoogleCachedToken(accessToken);
        }

        recordLog({ status: 'approved', type: 'disconnect', manifest: provider, initiator: 'user' });
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Handle token-related requests (with PKCE verification)
  else if (message.type === "EXCHANGE_TOKEN") {
      const { code, manifest, endpoint, clientId, clientSecret, code_verifier } = message.data;

      if (!code_verifier) {
        sendResponse({ success: false, error: 'PKCE code_verifier is required' });
        return true;
      }

      exchangeAuthorizationCode(code, manifest, endpoint, clientId, clientSecret, code_verifier, oauthCrypto)
        .then(tokenData => {
          sendResponse({ success: true, data: tokenData });
        })
        .catch(error => {
          sendResponse({ success: false, error: error.message });
        });

      return true; // Make response async
  }

  else if (message.type === "GET_TOKEN") {
      const { provider, rotation_token } = message.data;
      const tokenDb = getTokenDb();

      const transaction = tokenDb.transaction(["tokens"], "readonly");
      const store = transaction.objectStore("tokens");
      const request = store.get(provider);

      request.onsuccess = async () => {
        const token = request.result;
        if (!token || new Date(token.expiresAt) <= new Date()) {
          sendResponse({ success: false, error: 'Token not found or expired' });
          return;
        }

        // Token rotation: verify and rotate if rotation_token is present
        if (token.rotation_token) {
          if (!rotation_token) {
            console.error('SECURITY: GET_TOKEN rejected — rotation_token is required');
            sendResponse({ success: false, error: 'Rotation token required' });
            return;
          } else if (rotation_token !== token.rotation_token) {
            console.error('SECURITY: Invalid rotation_token - possible token replay attack');
            sendResponse({ success: false, error: 'Invalid rotation token' });
            return;
          }

          // Issue new rotation token and invalidate the old one
          const newRotationToken = generateAuthCode();
          const updateTx = tokenDb.transaction(["tokens"], "readwrite");
          const updateStore = updateTx.objectStore("tokens");
          updateStore.put({ ...token, rotation_token: newRotationToken });

          sendResponse({
            success: true,
            data: { ...token, rotation_token: newRotationToken }
          });
          return;
        }

        sendResponse({ success: true, data: token });
      };

      request.onerror = () => {
        sendResponse({ success: false, error: 'Failed to retrieve token' });
      };

      return true; // Make response async
  }

  // ===== GOOGLE OAUTH HANDLERS (Flow 2: OAuthHub -> Google) =====

  // Handle Google OAuth initiation for external clients (Flow 1 + Flow 2 combined)
  else if (message.type === "INITIATE_GOOGLE_OAUTH_FOR_EXTERNAL_CLIENT") {
      // Security: Verify sender is from our popup page
      if (!sender.url || !sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`)) {
        sendResponse({ success: false, error: 'Invalid sender context' });
        return;
      }

      const { provider, manifest, redirectUri, state, access_type, schedule, consentNonce, code_challenge } = message.data;

      // Track the tab so we can redirect it back after authorization
      if (sender.tab?.id) {
        originalTabId = sender.tab.id;
      }

      // Security: Validate consent nonce (prevents programmatic triggering without UI)
      if (!consentNonce || consentNonce.length < 32) {
        sendResponse({ success: false, error: 'Missing consent verification' });
        return;
      }

      // Security: Validate redirect URI
      const uriValidation = validateRedirectUri(redirectUri);
      if (!uriValidation.valid) {
        sendResponse({ success: false, error: `Invalid redirect URI: ${uriValidation.reason}` });
        return;
      }

      // Use static imports
      (async () => {
        await assertOAuthHubEnabled();
        const tokenManager = new TokenManager();
        const runtime = new Runtime();

        try {
          // Infer required scopes from manifest if provided
          let requiredScopes = ['https://www.googleapis.com/auth/gmail.readonly']; // default
          if (manifest) {
            const parsedManifest = runtime.parseManifest ? runtime.parseManifest(manifest) : parseManifest(manifest);
            requiredScopes = tokenManager.inferScopes(parsedManifest);
          }

          // Initiate Google OAuth using chrome.identity
          const authResult = await tokenManager.initiateGoogleOAuth(requiredScopes);

          if (authResult.existing || authResult.success) {
            // OAuth completed successfully
            const authCode = generateAuthCode();

            // Differentiated token lifetimes based on access_type
            const tokenLifetimes = {
              'install_time': 5 * 60 * 1000,            // 5 minutes (just enough for execution)
              'scheduled_time': 30 * 24 * 60 * 60 * 1000, // 30 days (long-lived for scheduler)
              'user_driven': 60 * 60 * 1000              // 1 hour (session-based)
            };
            const expiresAt = new Date(Date.now() + (tokenLifetimes[access_type] || 10 * 60 * 1000));

            // Identity verification: generate per-session ECDSA signing key pair
            const sessionKeys = await oauthCrypto.generateDPoPKeyPair();
            sessionKeyPairs.set(authCode, {
              privateKey: sessionKeys.privateKey,
              publicKeyJWK: sessionKeys.jwk
            });

            // Attach signing key to runtime so Post operators sign payloads
            runtime.privateKey = sessionKeys.privateKey;
            runtime.publicKeyJWK = sessionKeys.jwk;

            // Fetch user identity from Google for verification by external apps
            let userInfo = null;
            try {
              const accessToken = authResult.token.access_token;
              const userInfoResponse = await fetch(
                'https://www.googleapis.com/oauth2/v3/userinfo',
                { headers: { 'Authorization': `Bearer ${accessToken}` } }
              );
              if (userInfoResponse.ok) {
                userInfo = await userInfoResponse.json();
              }
            } catch (e) {
              console.warn('Failed to fetch user info:', e.message);
            }

            // Store auth record (with signing key) BEFORE redirecting.
            // This prevents a race where EXCHANGE_AUTH_CODE reads the record
            // before processAuthorizationInBackground has written it.
            console.log('✅ OAuth approved - storing auth record then redirecting');
            const authData = await processAuthorizationInBackground({
              authCode,
              provider,
              redirectUri,
              state,
              manifest,
              access_type,
              schedule,
              expiresAt,
              googleTokens: authResult.token,
              tokenManager,
              runtime,
              codeChallenge: code_challenge,
              skipAccessTypeBehavior: access_type === 'install_time',
              sessionKeyPairs,
              oauthCrypto,
              originalTabId,
              parseManifest,
              handleAccessTypeBehaviorDeps: getHandleAccessTypeBehaviorDeps()
            });

            sendResponse({ success: true, message: 'Authorization approved' });

            // Redirect user back to external client after a short delay
            // so the consent page has time to receive the response
            setTimeout(() => {
              redirectToExternalClient(redirectUri, authCode, state, sessionKeys.jwk, userInfo?.sub, originalTabId);
              if (access_type === 'install_time') {
                void handleAccessTypeBehavior(access_type, {
                  authCode,
                  authData,
                  manifest,
                  redirectUri,
                  state,
                  schedule,
                  tokenManager,
                  runtime,
                  rawGoogleTokens: authResult.token,
                  ...getHandleAccessTypeBehaviorDeps()
                }).catch(error => {
                  console.error('Install-time background execution failed after redirect:', error);
                });
              }
            }, 500);
          } else {
            sendResponse({ success: false, error: 'Google OAuth failed or was cancelled' });
          }
        } catch (error) {
          console.error('Google OAuth for external client failed:', error);
          sendResponse({ success: false, error: error.message });
        }
      })().catch(error => {
        sendResponse({ success: false, error: `Failed to load modules: ${error.message}` });
      });

      return true; // Make response async
  }

  // Handle Google OAuth initiation (internal use)
  else if (message.type === "INITIATE_GOOGLE_OAUTH") {
      const { requiredScopes, useDPoP = false } = message.data;

      // Use static import
      (async () => {
        await assertOAuthHubEnabled();
        const tokenManager = new TokenManager();

        try {
          const result = await tokenManager.initiateGoogleOAuth(requiredScopes, { useDPoP });

          if (result.existing) {
            // Already have valid tokens
            sendResponse({ success: true, data: { existing: true, token: result.token } });
          } else {
            // Need to authorize - store session ID (localStorage is unavailable in MV3 service workers)
            chrome.storage.session.set({ oauth_session_id: result.sessionId });

            // Open Google OAuth URL in new tab
            chrome.tabs.create({ url: result.authUrl }, (tab) => {
              sendResponse({
                success: true,
                data: {
                  authUrl: result.authUrl,
                  sessionId: result.sessionId,
                  tabId: tab.id
                }
              });
            });
          }
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })().catch(error => {
        sendResponse({ success: false, error: `Failed to load TokenManager: ${error.message}` });
      });

      return true; // Make response async
  }

  // Handle Google OAuth callback
  else if (message.type === "GOOGLE_OAUTH_CALLBACK") {
      const { code, state, sessionId } = message.data;

      // Use static import
      (async () => {
        const tokenManager = new TokenManager();

        try {
          const tokenData = await tokenManager.exchangeGoogleAuthCode(code, state, sessionId);
          sendResponse({ success: true, data: tokenData });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })().catch(error => {
        sendResponse({ success: false, error: `Failed to load TokenManager: ${error.message}` });
      });

      return true; // Make response async
  }

  // Handle request for valid Google token
  else if (message.type === "GET_GOOGLE_TOKEN") {
      const { requiredScopes, targetUrl, method = 'GET' } = message.data;

      // Import TokenManager
      (async () => {
        const tokenManager = new TokenManager();

        try {
          const tokenData = await tokenManager.getValidGoogleToken(requiredScopes, targetUrl, method);
          sendResponse({ success: true, data: tokenData });
        } catch (error) {
          if (error.message.includes('reauthorization required') || error.message.includes('Missing required scopes')) {
            // Need to reauthorize
            sendResponse({ success: false, error: error.message, needsAuth: true });
          } else {
            sendResponse({ success: false, error: error.message });
          }
        }
      })().catch(error => {
        sendResponse({ success: false, error: `Failed to load TokenManager: ${error.message}` });
      });

      return true; // Make response async
  }

  // Handle token refresh
  else if (message.type === "REFRESH_GOOGLE_TOKEN") {
      const { refreshToken, sessionId } = message.data;

      // Import TokenManager
      (async () => {
        const tokenManager = new TokenManager();

        try {
          const tokenData = await tokenManager.refreshGoogleToken(refreshToken, sessionId);
          sendResponse({ success: true, data: tokenData });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })().catch(error => {
        sendResponse({ success: false, error: `Failed to load TokenManager: ${error.message}` });
      });

      return true; // Make response async
  }

  // ===== RUNTIME EXECUTION HANDLERS =====

  // Handle manifest execution requests
  else if (message.type === "EXECUTE_MANIFEST") {
      const { manifest } = message.data;

      // Import Runtime with ephemeral signing key so Post operators sign payloads
      (async () => {
        const ephemeralKeys = await oauthCrypto.generateDPoPKeyPair();
        const runtime = new Runtime({
          privateKey: ephemeralKeys.privateKey,
          publicKeyJWK: ephemeralKeys.jwk
        });

        try {
          const result = await runtime.executeManifest(manifest);
          sendResponse({ success: true, data: result });
        } catch (error) {
          if (error.message && error.message.startsWith('GOOGLE_AUTH_REQUIRED:')) {
            // Parse auth info from error message
            const authInfo = JSON.parse(error.message.replace('GOOGLE_AUTH_REQUIRED: ', ''));
            sendResponse({
              success: false,
              error: 'Google authorization required',
              needsAuth: true,
              authUrl: authInfo.authUrl,
              sessionId: authInfo.sessionId
            });
          } else {
            sendResponse({ success: false, error: error.message });
          }
        }
      })().catch(error => {
        sendResponse({ success: false, error: `Failed to load Runtime: ${error.message}` });
      });

      return true; // Make response async
  }

  // Handle debug manifest execution (uses sample data or mock data, captures Debug snapshots)
  else if (message.type === "DEBUG_EXECUTE_MANIFEST") {
    const { manifest, mockData } = message.data;
    try {
      const runtime = new Runtime();
      const result = runtime.executeManifestDebug(manifest, mockData || null);
      sendResponse({ success: true, debugSnapshots: result.debugSnapshots });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return false;
  }

  // Update constraints for a manifest
  else if (message.type === "UPDATE_MANIFEST_CONSTRAINTS") {
    (async () => {
      try {
        const { manifestId, constraints } = message.data;
        const { manifests = [] } = await chrome.storage.local.get('manifests');
        const idx = manifests.findIndex(m => m.id === manifestId);
        if (idx === -1) {
          sendResponse({ success: false, error: 'Manifest not found' });
          return;
        }
        manifests[idx].constraints = constraints;
        await chrome.storage.local.set({ manifests });
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Get constraints for a manifest
  else if (message.type === "GET_MANIFEST_CONSTRAINTS") {
    (async () => {
      try {
        const { manifestId } = message.data;
        const { manifests = [] } = await chrome.storage.local.get('manifests');
        const manifest = manifests.find(m => m.id === manifestId);
        if (!manifest) {
          sendResponse({ success: false, error: 'Manifest not found' });
          return;
        }
        sendResponse({ success: true, constraints: manifest.constraints || {} });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Revoke a manifest completely
  else if (message.type === "REVOKE_MANIFEST") {
    (async () => {
      try {
        await authDbReady;
        const authDb = getAuthDb();
        const { manifestId } = message.data;
        const { manifests = [] } = await chrome.storage.local.get('manifests');
        const manifestEntry = manifests.find(m => m.id === manifestId);

        if (!manifestEntry) {
          sendResponse({ success: false, error: 'Manifest not found' });
          return;
        }

        // 1. Delete all live auth records tied to this manifest, including rotated tokens.
        const matchingAuths = (await getAllAuthorizations()).filter(authRecord =>
          authRecord.manifest === manifestEntry.manifestText
        );
        const authCodesToDelete = matchingAuths.map(authRecord => authRecord.code);

        if (authCodesToDelete.length > 0) {
          try {
            await deleteAuthorizationCodes(authCodesToDelete);
          } catch (e) { console.warn('Failed to delete auth records:', e.message); }
          for (const code of authCodesToDelete) {
            sessionKeyPairs.delete(code);
          }
        }

        // 2. Cancel scheduled alarms for this manifest
        const alarms = await chrome.alarms.getAll();
        for (const alarm of alarms) {
          if (alarm.name.includes(manifestEntry.authCode || manifestId)) {
            await chrome.alarms.clear(alarm.name);
          }
        }

        // 3. Remove scheduled tasks from IndexedDB
        try {
          const allTasks = await new Promise((resolve) => {
            const tx = authDb.transaction(['scheduledTasks'], 'readonly');
            const store = tx.objectStore('scheduledTasks');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
          });
          const tasksToDelete = allTasks.filter(task =>
            task.authCode === manifestEntry.authCode ||
            authCodesToDelete.includes(task.authCode) ||
            task.manifest === manifestEntry.manifestText
          );
          if (tasksToDelete.length > 0) {
            await new Promise((resolve, reject) => {
              const tx = authDb.transaction(['scheduledTasks'], 'readwrite');
              const store = tx.objectStore('scheduledTasks');
              for (const task of tasksToDelete) store.delete(task.taskName);
              tx.oncomplete = () => resolve();
              tx.onerror = () => reject(tx.error);
            });
          }
        } catch (e) { console.warn('Failed to clean up scheduled tasks:', e.message); }

        // 4. Remove manifest from storage
        const updatedManifests = manifests.filter(m => m.id !== manifestId);
        await chrome.storage.local.set({ manifests: updatedManifests });

        recordLog({ status: 'approved', type: 'revoke', manifest: manifestEntry.provider || manifestId, initiator: 'user' });
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Upgrade scopes for on-demand permission granting
  else if (message.type === "UPGRADE_SCOPES") {
    (async () => {
      try {
        const { manifestId, additionalScopes } = message.data;
        const tokenManager = new TokenManager();

        // Request additional scopes interactively
        const result = await tokenManager.initiateGoogleOAuth(additionalScopes);
        if (!result.success) {
          sendResponse({ success: false, error: 'Scope upgrade denied by user' });
          return;
        }

        // Update manifest record with upgraded scopes
        const { manifests = [] } = await chrome.storage.local.get('manifests');
        const idx = manifests.findIndex(m => m.id === manifestId);
        if (idx !== -1) {
          if (!manifests[idx].grantedScopes) manifests[idx].grantedScopes = [];
          manifests[idx].grantedScopes = [...new Set([...manifests[idx].grantedScopes, ...additionalScopes])];
          await chrome.storage.local.set({ manifests });
        }

        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Preview manifest execution with sample data (for consent UI)
  else if (message.type === "PREVIEW_MANIFEST_EXECUTION") {
    const { manifest } = message.data;
    if (!manifest) {
      sendResponse({ success: false, error: 'No manifest provided' });
      return;
    }

    try {
      const runtime = new Runtime();
      const result = runtime.executeManifestPreview(manifest);
      sendResponse({ success: true, data: result });
    } catch (error) {
      console.error('Preview execution error:', error);
      sendResponse({ success: false, error: error.message });
    }
    return; // Synchronous response
  }

  // Validate client ID with Google
  else if (message.type === "VALIDATE_CLIENT_ID") {
    validateClientId().then(result => {
      sendResponse(result);
    }).catch(error => {
      sendResponse({ valid: false, error: error.message });
    });
    return true; // Make response async
  }

});

// Export parseManifest function for external use
function parseManifest(manifestText) {
  const manifest = {
    title: '',
    description: '',
    pipeline: [],
    operators: {}
  };

  const lines = manifestText.split('\n');
  let pipelineStr = '';
  let operatorText = '';
  let collectingPipeline = false;

  // Phase 1: Extract headers and collect operator text
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { collectingPipeline = false; continue; }

    if (line.startsWith('TITLE:')) {
      manifest.title = line.substring(6).trim();
      collectingPipeline = false;
    } else if (line.startsWith('DESCRIPTION:')) {
      manifest.description = line.substring(12).trim();
      collectingPipeline = false;
    } else if (line.startsWith('PIPELINE:')) {
      pipelineStr = line.substring(9);
      collectingPipeline = true;
    } else if (collectingPipeline && line.includes('->')) {
      pipelineStr += ' ' + line;
    } else {
      collectingPipeline = false;
      operatorText += line + ' ';
    }
  }

  // Phase 2: Parse pipeline by splitting on ->
  manifest.pipeline = pipelineStr
    .replace(/\s+/g, '')
    .split('->')
    .filter(Boolean);

  // Phase 3: Parse operators using balanced parentheses
  let i = 0;
  while (i < operatorText.length) {
    const nameMatch = operatorText.substring(i).match(/^(\w+)\s*\(/);
    if (nameMatch) {
      const name = nameMatch[1];
      const bodyStart = i + nameMatch[0].length;
      let depth = 1;
      let j = bodyStart;
      let inStr = false;

      // Walk forward to find the matching closing paren
      while (j < operatorText.length && depth > 0) {
        const ch = operatorText[j];
        if (ch === '"' && (j === 0 || operatorText[j - 1] !== '\\')) {
          inStr = !inStr;
        }
        if (!inStr) {
          if (ch === '(') depth++;
          else if (ch === ')') depth--;
        }
        j++;
      }

      const body = operatorText.substring(bodyStart, j - 1);
      manifest.operators[name] = parseOperatorConfig(body);
      i = j;
    } else {
      i++;
    }
  }

  return manifest;
}

function parseOperatorConfig(configText) {
  const content = configText.trim();

  // Simple improved parsing for arrays with regex patterns
  const config = {};
  const pairs = [];
  let current = '';
  let depth = 0;
  let inString = false;

  // Split by comma but respect brackets and quotes
  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (char === '"' && (i === 0 || content[i-1] !== '\\')) {
      inString = !inString;
    }

    if (!inString) {
      if (char === '[') depth++;
      else if (char === ']') depth--;
    }

    if (char === ',' && depth === 0 && !inString) {
      pairs.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    pairs.push(current.trim());
  }

  // Parse each pair
  for (const pair of pairs) {
    const colonIndex = pair.indexOf(':');
    if (colonIndex === -1) continue;

    const key = pair.substring(0, colonIndex).trim();
    const value = pair.substring(colonIndex + 1).trim();

    if (!key) continue;

    if (value === 'NOW') {
      config[key] = new Date().toISOString();
    } else if (value === 'true' || value === 'false') {
      config[key] = value === 'true';
    } else if (value.startsWith('"') && value.endsWith('"')) {
      config[key] = value.slice(1, -1);
    } else if (value.startsWith('[') && value.endsWith(']')) {
      // Parse array properly
      const arrayContent = value.slice(1, -1);
      const items = [];
      let currentItem = '';
      let itemDepth = 0;
      let itemInString = false;

      for (let i = 0; i < arrayContent.length; i++) {
        const char = arrayContent[i];

        if (char === '"' && (i === 0 || arrayContent[i-1] !== '\\')) {
          itemInString = !itemInString;
          currentItem += char;
        } else if (char === ',' && itemDepth === 0 && !itemInString) {
          if (currentItem.trim()) {
            const item = currentItem.trim();
            items.push(item.startsWith('"') && item.endsWith('"') ? item.slice(1, -1) : item);
          }
          currentItem = '';
        } else {
          currentItem += char;
        }
      }

      if (currentItem.trim()) {
        const item = currentItem.trim();
        items.push(item.startsWith('"') && item.endsWith('"') ? item.slice(1, -1) : item);
      }

      config[key] = items;
    } else if (!isNaN(value) && value !== '') {
      config[key] = Number(value);
    } else {
      config[key] = value.replace(/"/g, '');
    }
  }

  return config;
}

// Global export for external access
if (typeof globalThis !== 'undefined') {
  globalThis.OAuthHubRuntime = {
    parseManifest,
    parseOperatorConfig
  };
}

async function loadOAuthClientConfig() {
  const oauthConfig = chrome.runtime.getManifest().oauth2;
  if (!oauthConfig?.client_id) {
    throw new Error('Invalid manifest.oauth2 configuration: missing client_id');
  }

  return oauthConfig;
}

// Client ID Validation - Tests actual Google authentication
async function validateClientId() {
  console.log('Testing client ID validity with Google...');

  try {
    const clientConfig = await loadOAuthClientConfig();

    console.log('Testing client ID:', clientConfig.client_id);

    // Test Chrome identity with the configured client
    return new Promise((resolve) => {
      chrome.identity.getAuthToken({
        interactive: true
      }, (token) => {
        if (chrome.runtime.lastError) {
          console.error('Client ID validation failed:', chrome.runtime.lastError.message);
          resolve({
            valid: false,
            error: chrome.runtime.lastError.message,
            client_id: clientConfig.client_id
          });
        } else if (token) {
          console.log('✅ Client ID is valid - authentication successful');

          // Clean up the test token
          chrome.identity.removeCachedAuthToken({ token }, () => {
            console.log('Test token cleaned up');
          });

          resolve({
            valid: true,
            client_id: clientConfig.client_id,
            message: 'Client ID successfully authenticated with Google'
          });
        } else {
          resolve({
            valid: false,
            error: 'No token returned by Google',
            client_id: clientConfig.client_id
          });
        }
      });
    });
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

// Function to check current extension configuration
function checkExtensionConfig() {
  const currentExtensionId = chrome.runtime.id;
  const expectedExtensionId = 'hgdiehopbnpjmlihljcbllngkmohmfjh';
  const currentRedirectUri = chrome.identity.getRedirectURL();
  const expectedRedirectUri = `https://${expectedExtensionId}.chromiumapp.org/`;

  console.log('=== Extension Configuration Check ===');
  console.log('Current Extension ID:', currentExtensionId);
  console.log('Expected Extension ID:', expectedExtensionId);
  console.log('Current Redirect URI:', currentRedirectUri);
  console.log('Expected Redirect URI:', expectedRedirectUri);
  console.log('Extension IDs Match:', currentExtensionId === expectedExtensionId);

  if (currentExtensionId !== expectedExtensionId) {
    console.warn('⚠️ EXTENSION ID MISMATCH!');
    console.warn('You are using an unpacked extension with a temporary ID.');
    console.warn('Your Google OAuth client is configured for the published extension ID.');
    console.warn('Solutions:');
    console.warn('1. Publish the extension to Chrome Web Store to get the stable ID');
    console.warn('2. OR create a new OAuth client for development with your current extension ID');
  } else {
    console.log('✅ Extension IDs match - configuration should work');
  }

  return {
    currentExtensionId,
    expectedExtensionId,
    currentRedirectUri,
    expectedRedirectUri,
    idsMatch: currentExtensionId === expectedExtensionId
  };
}

// Detailed Chrome Identity Diagnostic
function diagnoseChromeIdentity() {
  console.log('=== Chrome Identity API Diagnostic ===');

  // Check API availability
  console.log('Chrome identity API available:', !!chrome?.identity);
  if (!chrome?.identity) {
    console.error('Chrome identity API not available');
    return { error: 'Chrome identity API not available' };
  }

  // Check methods
  console.log('Available methods:', Object.keys(chrome.identity));

  // Check manifest permissions
  console.log('Extension ID:', chrome.runtime.id);
  console.log('Extension URL:', chrome.runtime.getURL(''));

  // Test getAuthToken with different parameters
  console.log('Testing getAuthToken with minimal parameters...');

  return new Promise((resolve) => {
    // Test 1: Non-interactive to check cached tokens
    chrome.identity.getAuthToken({ interactive: false }, (token1) => {
      console.log('Non-interactive result:', {
        token: token1 ? 'GOT_TOKEN' : 'NO_TOKEN',
        error: chrome.runtime.lastError?.message
      });

      // Clear any lastError
      const error1 = chrome.runtime.lastError?.message;

      // Test 2: Interactive with basic scopes
      setTimeout(() => {
        chrome.identity.getAuthToken({
          interactive: true,
          scopes: ['openid', 'email', 'profile']
        }, (token2) => {
          const error2 = chrome.runtime.lastError?.message;
          console.log('Interactive with scopes result:', {
            token: token2 ? 'GOT_TOKEN' : 'NO_TOKEN',
            error: error2
          });

          // Test 3: Interactive without scopes
          setTimeout(() => {
            chrome.identity.getAuthToken({ interactive: true }, (token3) => {
              const error3 = chrome.runtime.lastError?.message;
              console.log('Interactive without scopes result:', {
                token: token3 ? 'GOT_TOKEN' : 'NO_TOKEN',
                error: error3
              });

              resolve({
                nonInteractive: { token: !!token1, error: error1 },
                withScopes: { token: !!token2, error: error2 },
                withoutScopes: { token: !!token3, error: error3 },
                extensionId: chrome.runtime.id,
                redirectUrl: chrome.identity.getRedirectURL()
              });
            });
          }, 1000);
        });
      }, 1000);
    });
  });
}

// Check current OAuth configuration
async function checkOAuthConfig() {
  try {
    const clientConfig = await loadOAuthClientConfig();
    const redirectUri = chrome.identity.getRedirectURL();

    console.log('=== OAuth Configuration Check ===');
    console.log('Client ID:', clientConfig.client_id);
    console.log('Configured scopes:', clientConfig.scopes || []);
    console.log('Extension ID:', chrome.runtime.id);
    console.log('Derived redirect URI:', redirectUri);

    return {
      client_id: clientConfig.client_id,
      scopes: clientConfig.scopes || [],
      redirect_uri: redirectUri,
      extension_id: chrome.runtime.id,
      expected_redirect: redirectUri
    };
  } catch (error) {
    console.error('Failed to check OAuth config:', error);
    return { error: error.message };
  }
}

// Export for console testing
if (typeof globalThis !== 'undefined') {
  globalThis.validateClientId = validateClientId;
  globalThis.checkExtensionConfig = checkExtensionConfig;
  globalThis.diagnoseChromeIdentity = diagnoseChromeIdentity;
  globalThis.checkOAuthConfig = checkOAuthConfig;
}

// ===== TOP-LEVEL ALARM HANDLER (survives service-worker restarts) =====
// When MV3 restarts the worker, in-memory Scheduler callbacks are lost.
// This listener reads the task config from IndexedDB and re-executes.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Handle cleanup alarms (replaces setInterval which doesn't survive MV3 suspension)
  if (alarm.name === 'cleanupExpiredCodes') {
    try {
      await authDbReady;
      cleanupExpiredCodes();
    } catch (e) {
      console.warn('cleanupExpiredCodes alarm error:', e.message);
    }
    return;
  }
  if (alarm.name === 'cleanupExpiredTokens') {
    try {
      await tokenDbReady;
      cleanupExpiredTokens();
    } catch (e) {
      console.warn('cleanupExpiredTokens alarm error:', e.message);
    }
    return;
  }

  // Only handle our scheduled tasks
  if (!alarm.name.startsWith('scheduled_')) return;

  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('OAuthHubDB', 3);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const taskData = await new Promise((resolve, reject) => {
      const tx = db.transaction(['scheduledTasks'], 'readonly');
      const store = tx.objectStore('scheduledTasks');
      const req = store.get(alarm.name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });

    if (!taskData) {
      console.warn(`Alarm ${alarm.name} fired but no task config found in DB`);
      return;
    }

    console.log(`⏰ Executing scheduled task from IndexedDB: ${alarm.name}`);
    let runtimeOpts = null;
    let result = null;

    await withSerializedLock(
      manifestExecutionLocks,
      getManifestExecutionKey(taskData),
      async () => {
        const constraintCheck = await enforceConstraints(taskData);
        if (!constraintCheck.allowed) {
          console.warn(`Scheduled task ${alarm.name} blocked: ${constraintCheck.reason}`);
          recordLog({ status: 'rejected', type: 'scheduled', manifest: taskData.provider || alarm.name, initiator: 'scheduler', reason: constraintCheck.reason });
          return;
        }

        runtimeOpts = {
          constraints: constraintCheck.manifestEntry?.constraints || null
        };
        const memKeyPair = sessionKeyPairs.get(taskData.authCode);
        if (memKeyPair) {
          runtimeOpts = {
            ...runtimeOpts,
            privateKey: memKeyPair.privateKey,
            publicKeyJWK: memKeyPair.publicKeyJWK
          };
        } else if (taskData.signingKeyPair) {
          try {
            let privateKeyJWK = null;

            // New format: private key encrypted at rest
            if (taskData.signingKeyPair.privateKeyJWK_encrypted) {
              const tm = new TokenManager();
              privateKeyJWK = await tm.decryptToken(taskData.signingKeyPair.privateKeyJWK_encrypted);
              if (!privateKeyJWK) {
                throw new Error('Failed to decrypt signing key — session may have expired');
              }
            }
            // Legacy format: plaintext private key
            else if (taskData.signingKeyPair.privateKeyJWK) {
              privateKeyJWK = taskData.signingKeyPair.privateKeyJWK;
            }

            if (privateKeyJWK) {
              const privKey = await crypto.subtle.importKey(
                'jwk', privateKeyJWK,
                { name: 'ECDSA', namedCurve: 'P-256' },
                false, ['sign']
              );
              runtimeOpts = {
                ...runtimeOpts,
                privateKey: privKey,
                publicKeyJWK: taskData.signingKeyPair.publicKeyJWK
              };
            }
          } catch (e) {
            console.warn('Failed to import signing key for alarm Runtime:', e.message);
          }
        }

        const runtime = new Runtime(runtimeOpts);
        result = await runtime.executeManifest(taskData.manifest);
        await recordConstraintUsage(taskData);
      }
    );

    if (!result || !runtimeOpts) {
      return;
    }

    // Build payload
    const timestamp = new Date().toISOString();
    const payload = {
      type: 'scheduled_data',
      data: result,
      timestamp: timestamp,
      taskName: alarm.name,
      scheduleSpec: JSON.parse(taskData.schedule)
    };
    const bodyStr = JSON.stringify(payload);

    // Reuse the signing key already resolved for Runtime
    let signatureHeader = '';
    const signingKey = runtimeOpts.privateKey || null;

    if (signingKey) {
      try {
        const bodyHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bodyStr));
        const bodyHashB64 = oauthCrypto.base64URLEncode(new Uint8Array(bodyHash));
        signatureHeader = await oauthCrypto.signJWT(
          { alg: 'ES256', typ: 'oauthub+jwt' },
          { body_hash: bodyHashB64, iat: Math.floor(Date.now() / 1000) },
          signingKey
        );
      } catch (e) { /* best effort */ }
    }

    await fetch(taskData.redirectUri, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${taskData.authCode}`,
        'X-OAuthHub-Type': 'scheduled_data',
        'X-OAuthHub-Timestamp': timestamp,
        'X-OAuthHub-Signature': signatureHeader
      },
      body: bodyStr
    }).catch(err => {
      console.error(`Failed to send scheduled data for ${alarm.name}:`, err);
    });

  } catch (error) {
    console.error(`Alarm handler error for ${alarm.name}:`, error);
  }
});

// Listen for tab updates (original implementation)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    try {
      const url = new URL(tab.url);
      const extensionId = chrome.runtime.id;

      if (url.protocol === 'chrome-extension:' &&
          url.hostname === extensionId &&
          url.pathname === '/authorize') {
        originalTabId = tabId;

        const params = {
          provider: url.searchParams.get('provider'),
          redirect_uri: url.searchParams.get('redirect_uri'),
          access_type: url.searchParams.get('access_type'),
          state: url.searchParams.get('state'),
          manifest: url.searchParams.get('manifest'),
          schedule: url.searchParams.get('schedule'), // For scheduled_time access
          code_challenge: url.searchParams.get('code_challenge'), // Client PKCE challenge
          code_challenge_method: url.searchParams.get('code_challenge_method') // S256
        };

        // Validate required parameters
        if (!params.provider || !params.redirect_uri || !params.access_type) {
          console.error('Missing required OAuth parameters');
          return;
        }

        // Security: Validate redirect URI
        const redirectValidation = validateRedirectUri(params.redirect_uri);
        if (!redirectValidation.valid) {
          console.error(`SECURITY: Invalid redirect_uri: ${redirectValidation.reason}`);
          return;
        }

        // Validate access_type
        const validAccessTypes = ['install_time', 'user_driven', 'scheduled_time'];
        if (!validAccessTypes.includes(params.access_type)) {
          console.error(`Invalid access_type: ${params.access_type}. Must be one of: ${validAccessTypes.join(', ')}`);
          return;
        }

        // For scheduled_time, validate schedule format if provided
        if (params.access_type === 'scheduled_time' && params.schedule) {
          if (!isValidScheduleFormat(params.schedule)) {
            console.error('Invalid schedule format. Use: interval:5min, daily:09:00, or cron:0 */5 * * * *');
            return;
          }
        }

        chrome.tabs.update(tabId, {
          url: `${chrome.runtime.getURL('index.html')}#/authorize?provider=${
            encodeURIComponent(params.provider)
          }&redirect_uri=${
            encodeURIComponent(params.redirect_uri)
          }&access_type=${
            encodeURIComponent(params.access_type)
          }&state=${
            encodeURIComponent(params.state)
          }${params.manifest ? `&manifest=${encodeURIComponent(params.manifest)}` : ''}${
            params.schedule ? `&schedule=${encodeURIComponent(params.schedule)}` : ''
          }${params.code_challenge ? `&code_challenge=${encodeURIComponent(params.code_challenge)}` : ''}${
            params.code_challenge_method ? `&code_challenge_method=${encodeURIComponent(params.code_challenge_method)}` : ''
          }`
        }, () => {
          if (chrome.runtime.lastError) {
            console.error('Error updating tab to consent UI:', chrome.runtime.lastError);
            return;
          }

          const sendMessage = () => {
            chrome.runtime.sendMessage({
              type: 'AUTH_REQUEST',
              params: params
            }, (response) => {
              if (chrome.runtime.lastError) {
                setTimeout(sendMessage, 100);
              }
            });
          };
          sendMessage();
        });
      }
    } catch (error) {
      console.error('Error processing navigation:', error);
    }
  }
});
