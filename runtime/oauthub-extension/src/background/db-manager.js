// Database for authorization codes
let authDb;
// Separate database for tokens
let tokenDb;

const TOKEN_EXECUTION_RESERVATION_MS = 5 * 60 * 1000;

// Function to generate a secure random authorization code (original)
export const generateAuthCode = () => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
};

const buildUnlockedAuthRecord = (authData) => {
  if (!authData) return authData;
  const next = { ...authData };
  delete next.executionStatus;
  delete next.executionStartedAt;
  return next;
};

// Promises that resolve when DBs are ready -- await before any IDB access
// This prevents crashes when the MV3 service worker restarts and receives
// a message before the async IndexedDB open completes.
export const authDbReady = new Promise((resolve, reject) => {
  const authDbRequest = indexedDB.open("OAuthHubDB", 3);

  authDbRequest.onerror = (event) => {
    console.error("Auth Database error:", event.target.error);
    reject(event.target.error);
  };

  authDbRequest.onupgradeneeded = (event) => {
    authDb = event.target.result;
    const oldVersion = event.oldVersion;

    if (!authDb.objectStoreNames.contains("authorizations")) {
      const authStore = authDb.createObjectStore("authorizations", { keyPath: "code" });
      authStore.createIndex("expiresAt", "expiresAt");
      authStore.createIndex("manifest", "manifest");
      authStore.createIndex("provider", "provider");
      authStore.createIndex("accessType", "accessType");
    }

    if (!authDb.objectStoreNames.contains("manifests")) {
      const manifestStore = authDb.createObjectStore("manifests", { keyPath: "id" });
      manifestStore.createIndex("provider", "provider");
      manifestStore.createIndex("accessType", "accessType");
    }

    if (oldVersion < 3 && !authDb.objectStoreNames.contains("scheduledTasks")) {
      const scheduledStore = authDb.createObjectStore("scheduledTasks", { keyPath: "taskName" });
      scheduledStore.createIndex("authCode", "authCode");
      scheduledStore.createIndex("createdAt", "createdAt");
      scheduledStore.createIndex("schedule", "schedule");
    }
  };

  authDbRequest.onsuccess = (event) => {
    authDb = event.target.result;
    // Use chrome.alarms instead of setInterval -- setInterval does not survive
    // MV3 service worker suspension.
    chrome.alarms.create('cleanupExpiredCodes', { periodInMinutes: 5 });
    resolve();
  };
});

export const tokenDbReady = new Promise((resolve, reject) => {
  const tokenDbRequest = indexedDB.open("OAuthTokenDB", 1);

  tokenDbRequest.onerror = (event) => {
    console.error("Token Database error:", event.target.error);
    reject(event.target.error);
  };

  tokenDbRequest.onupgradeneeded = (event) => {
    tokenDb = event.target.result;

    if (!tokenDb.objectStoreNames.contains("tokens")) {
      const tokenStore = tokenDb.createObjectStore("tokens", { keyPath: "provider" });
      tokenStore.createIndex("expiresAt", "expiresAt");
      tokenStore.createIndex("manifest", "manifest");
    }
  };

  tokenDbRequest.onsuccess = (event) => {
    tokenDb = event.target.result;
    // Use chrome.alarms instead of setInterval -- setInterval does not survive
    // MV3 service worker suspension.
    chrome.alarms.create('cleanupExpiredTokens', { periodInMinutes: 5 });
    resolve();
  };
});

/** Returns the module-level authDb handle. Must await authDbReady first. */
export const getAuthDb = () => authDb;

/** Returns the module-level tokenDb handle. Must await tokenDbReady first. */
export const getTokenDb = () => tokenDb;

// Function to clean up expired authorization codes (original)
export const cleanupExpiredCodes = async () => {
  const transaction = authDb.transaction(["authorizations"], "readwrite");
  const store = transaction.objectStore("authorizations");
  const now = new Date();

  const index = store.index("expiresAt");
  const range = IDBKeyRange.upperBound(now);

  try {
    const request = index.openCursor(range);
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
  } catch (error) {
    console.error('Error cleaning up expired codes:', error);
  }
};

// Function to clean up expired tokens (original)
export const cleanupExpiredTokens = async () => {
  const transaction = tokenDb.transaction(["tokens"], "readwrite");
  const store = transaction.objectStore("tokens");
  const now = new Date();

  const index = store.index("expiresAt");
  const range = IDBKeyRange.upperBound(now);

  try {
    const request = index.openCursor(range);
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
  } catch (error) {
    console.error('Error cleaning up expired tokens:', error);
  }
};

export const getAllAuthorizations = async () => {
  await authDbReady;

  return await new Promise((resolve, reject) => {
    const tx = authDb.transaction(['authorizations'], 'readonly');
    const store = tx.objectStore('authorizations');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
};

export const deleteAuthorizationCodes = async (codes) => {
  const uniqueCodes = [...new Set((codes || []).filter(Boolean))];
  if (uniqueCodes.length === 0) return;

  await authDbReady;

  await new Promise((resolve, reject) => {
    const tx = authDb.transaction(['authorizations'], 'readwrite');
    const store = tx.objectStore('authorizations');
    for (const code of uniqueCodes) {
      store.delete(code);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const extractStoredGoogleAccessToken = async (tokenManager, authRecord) => {
  if (!authRecord || !authRecord.googleTokens) {
    return null;
  }

  const storedTokens = authRecord.googleTokens;
  if (storedTokens.access_token) {
    return storedTokens.access_token;
  }

  if (storedTokens.encrypted) {
    try {
      const decrypted = await tokenManager.decryptToken(storedTokens);
      return decrypted?.access_token || null;
    } catch (error) {
      console.warn('Failed to decrypt stored Google token:', error.message);
    }
  }

  return null;
};

export const reserveAccessToken = async (token) => {
  await authDbReady;

  let reservationError = null;
  let reservedAuthData = null;

  await new Promise((resolve, reject) => {
    const tx = authDb.transaction(['authorizations'], 'readwrite');
    const store = tx.objectStore('authorizations');
    const req = store.get(token);

    req.onsuccess = () => {
      const authData = req.result;
      const now = Date.now();

      if (!authData) {
        reservationError = new Error('Invalid or expired access token');
        tx.abort();
        return;
      }

      // Reject raw auth codes that were never exchanged via PKCE
      if (!authData.exchanged) {
        reservationError = new Error('Token has not been exchanged — use EXCHANGE_AUTH_CODE first');
        tx.abort();
        return;
      }

      if (new Date(authData.expiresAt).getTime() <= now) {
        reservationError = new Error('Access token has expired');
        tx.abort();
        return;
      }

      const startedAt = authData.executionStartedAt
        ? new Date(authData.executionStartedAt).getTime()
        : 0;
      const isExecuting = authData.executionStatus === 'executing'
        && Number.isFinite(startedAt)
        && now - startedAt < TOKEN_EXECUTION_RESERVATION_MS;

      if (isExecuting) {
        reservationError = new Error('Access token has already been used');
        tx.abort();
        return;
      }

      reservedAuthData = buildUnlockedAuthRecord(authData);
      store.put({
        ...reservedAuthData,
        executionStatus: 'executing',
        executionStartedAt: new Date(now).toISOString(),
      });
    };

    req.onerror = () => {
      reservationError = req.error;
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(reservationError || tx.error || new Error('Failed to reserve access token'));
    tx.onabort = () => reject(reservationError || tx.error || new Error('Failed to reserve access token'));
  });

  return reservedAuthData;
};

export const releaseReservedAccessToken = async (token) => {
  await authDbReady;

  await new Promise((resolve, reject) => {
    const tx = authDb.transaction(['authorizations'], 'readwrite');
    const store = tx.objectStore('authorizations');
    const req = store.get(token);

    req.onsuccess = () => {
      const authData = req.result;
      if (!authData) return;
      if (authData.executionStatus !== 'executing') return;
      store.put(buildUnlockedAuthRecord(authData));
    };

    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const invalidateReservedAccessToken = async (token) => {
  await authDbReady;

  await new Promise((resolve, reject) => {
    const tx = authDb.transaction(['authorizations'], 'readwrite');
    const store = tx.objectStore('authorizations');
    store.delete(token);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const rotateReservedAccessToken = async (oldToken, newToken, authData) => {
  await authDbReady;

  await new Promise((resolve, reject) => {
    const tx = authDb.transaction(['authorizations'], 'readwrite');
    const store = tx.objectStore('authorizations');
    const req = store.get(oldToken);

    req.onsuccess = () => {
      const currentRecord = req.result;
      if (!currentRecord || currentRecord.executionStatus !== 'executing') {
        tx.abort();
        return;
      }

      store.add({
        ...buildUnlockedAuthRecord(authData),
        code: newToken,
        expiresAt: new Date(authData.expiresAt),
      });
      store.delete(oldToken);
    };

    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to rotate access token'));
    tx.onabort = () => reject(tx.error || new Error('Failed to rotate access token'));
  });
};
