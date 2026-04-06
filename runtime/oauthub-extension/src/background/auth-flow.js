import TokenManager from './token-manager.js';
import { generateAuthCode, authDbReady, getAuthDb } from './db-manager.js';
import { setupScheduledExecution } from './schedule-manager.js';

// Function to exchange authorization code for tokens (original version)
// Handle different access_type behaviors after OAuth completion
export const handleAccessTypeBehavior = async (access_type, { authCode, authData, manifest, redirectUri, state, schedule, tokenManager, runtime, rawGoogleTokens, sessionKeyPairs, oauthCrypto, originalTabId, setupScheduledExecutionDeps }) => {
  switch (access_type) {
    case 'install_time':
      // Execute manifest immediately and send data to API endpoint
      if (manifest) {
        try {
          console.log('🔵 INSTALL_TIME: Starting manifest execution');

          const result = await runtime.executeManifest(manifest);
          console.log('✅ INSTALL_TIME: Manifest execution completed');
          console.log('📊 Processed data:', JSON.stringify(result, null, 2));

          // Send data to the API endpoint immediately
          if (authData.redirectUri) {
            console.log('🚀 INSTALL_TIME: Sending data to API endpoint');
            console.log('🎯 Destination:', authData.redirectUri);

            const payload = {
              type: 'install_time_data',
              data: result,
              timestamp: new Date().toISOString(),
              state: state,
              manifest_title: manifest.includes('TITLE:') ? manifest.split('TITLE:')[1].split('\n')[0].trim() : 'Unknown'
            };

            const bodyStr = JSON.stringify(payload);

            // Sign a SHA-256 digest of the body (not the full payload)
            let signatureJWT = '';
            const keyPair = sessionKeyPairs.get(authCode);
            if (keyPair) {
              try {
                const bodyHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bodyStr));
                const bodyHashB64 = oauthCrypto.base64URLEncode(new Uint8Array(bodyHash));
                signatureJWT = await oauthCrypto.signJWT(
                  { alg: 'ES256', typ: 'oauthub+jwt' },
                  { body_hash: bodyHashB64, iat: Math.floor(Date.now() / 1000) },
                  keyPair.privateKey
                );
              } catch (signErr) {
                console.warn('Failed to sign payload:', signErr.message);
              }
            }

            const response = await fetch(authData.redirectUri, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authCode}`,
                'X-OAuthHub-Type': 'install_time_data',
                'X-OAuthHub-State': state,
                'X-OAuthHub-Timestamp': payload.timestamp,
                'X-OAuthHub-Signature': signatureJWT
              },
              body: bodyStr
            });

            console.log('📡 API Response Status:', response.status);
            console.log('📡 API Response Headers:', Object.fromEntries(response.headers.entries()));

            if (!response.ok) {
              const errorText = await response.text();
              console.error('❌ API call failed:', response.status, errorText);
            } else {
              const responseData = await response.json();
              console.log('✅ API call successful:', responseData);
            }
          }
        } catch (error) {
          console.error('❌ INSTALL_TIME execution failed:', error);
          console.error('Stack trace:', error.stack);
        }
      } else {
        console.warn('⚠️ INSTALL_TIME: No manifest provided');
      }

      // Security: Clear tokens immediately after install_time use -- minimal exposure window
      try {
        // Use the raw (unencrypted) token for cache clearing; authData.googleTokens is encrypted
        const tokenToClear = rawGoogleTokens && rawGoogleTokens.access_token;
        if (tokenToClear) {
          await tokenManager.clearGoogleCachedToken(tokenToClear);
          console.log('install_time: Google token cleared from cache');
        }
      } catch (cleanupError) {
        console.error('install_time cleanup error:', cleanupError);
      }

      console.log('install_time: auth code remains valid until exchanged or expiry');

      // Skip redirect - already handled in background flow
      break;

    case 'scheduled_time':
      // Set up background scheduler
      try {
        console.log('Setting up scheduled_time background process');

        // Use provided manifest or default Gmail manifest
        const effectiveManifest = manifest || `
TITLE: Default Gmail Data
DESCRIPTION: Extract Gmail messages data
PIPELINE: Gmail->SelectMessages

Gmail(
  type: "pull",
  resourceType: "gmail",
  query: "{messages(userId: \"me\") { id threadId snippet }}"
)

SelectMessages(
  type: "select",
  field: "messages"
)`;

        await setupScheduledExecution({
          authCode,
          manifest: effectiveManifest,
          schedule,
          redirectUri,
          tokenManager,
          ...setupScheduledExecutionDeps
        });
      } catch (error) {
        console.error('Scheduled setup failed:', error);
      }

      // Skip redirect - already handled in background flow
      break;

    case 'user_driven':
      // Just store the authorization for later use
      console.log('User-driven access stored for later API requests');

      // Skip redirect - already handled in background flow
      break;

    default:
      console.error(`Unknown access_type: ${access_type}`);
      redirectToExternalClient(redirectUri, authCode, state, null, null, originalTabId);
  }
};

// Security: Validate redirect URI to prevent open redirects and data exfiltration
export const validateRedirectUri = (uri) => {
  try {
    const url = new URL(uri);
    // Must be HTTPS (except for localhost development)
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return { valid: false, reason: 'redirect_uri must use HTTPS' };
    }
    // Must not contain fragments
    if (url.hash) {
      return { valid: false, reason: 'redirect_uri must not contain fragments' };
    }
    // Block dangerous protocols
    const blockedProtocols = ['javascript:', 'data:', 'blob:', 'file:'];
    if (blockedProtocols.some(p => uri.toLowerCase().startsWith(p))) {
      return { valid: false, reason: 'redirect_uri uses blocked protocol' };
    }
    return { valid: true };
  } catch (e) {
    return { valid: false, reason: 'Invalid redirect_uri format' };
  }
};

// Helper function to redirect to external client
export const redirectToExternalClient = (redirectUri, authCode, state, publicKeyJWK = null, userSub = null, originalTabId = null) => {
  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.append('code', authCode);
  callbackUrl.searchParams.append('state', state);
  // Identity verification: share public key so app can verify signed payloads
  if (publicKeyJWK) {
    callbackUrl.searchParams.append('oauthub_public_key', JSON.stringify(publicKeyJWK));
  }
  // Identity verification: share Google user subject identifier
  if (userSub) {
    callbackUrl.searchParams.append('oauthub_user_sub', userSub);
  }

  if (originalTabId) {
    chrome.tabs.update(originalTabId, {
      url: callbackUrl.toString()
    });
  }
};

// Background processing function - runs async after user is redirected
export const processAuthorizationInBackground = async ({
  authCode,
  provider,
  redirectUri,
  state,
  manifest,
  access_type,
  schedule,
  expiresAt,
  googleTokens,
  tokenManager,
  runtime,
  codeChallenge,
  skipAccessTypeBehavior = false,
  sessionKeyPairs,
  oauthCrypto,
  originalTabId,
  parseManifest,
  handleAccessTypeBehaviorDeps
}) => {
  console.log('🔄 Starting background processing for access_type:', access_type);

  try {
    await authDbReady;
    const authDb = getAuthDb();

    // Export the signing key pair so it survives service worker restarts.
    // EXECUTE_QUERY needs these to sign Post operator payloads.
    // SECURITY: Encrypt the private key at rest using the same ephemeral
    // AES-GCM key used for token encryption -- the private key is sensitive
    // and should not be stored in plaintext in IndexedDB.
    let exportedSigningKeyPair = null;
    const keyPair = sessionKeyPairs.get(authCode);
    if (keyPair) {
      try {
        const exportedPrivateKey = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
        const encryptedPrivateKey = await tokenManager.encryptToken(exportedPrivateKey);
        exportedSigningKeyPair = {
          privateKeyJWK_encrypted: encryptedPrivateKey,
          publicKeyJWK: keyPair.publicKeyJWK
        };
      } catch (e) {
        console.warn('Failed to export/encrypt signing key pair for auth record:', e.message);
      }
    }

    // Encrypt Google tokens BEFORE opening the IDB transaction.
    // Encryption is async (chrome.storage.session + crypto.subtle) and would
    // cause the transaction to auto-commit if done after opening it.
    let encryptedGoogleTokens = googleTokens;
    if (googleTokens) {
      try {
        encryptedGoogleTokens = await tokenManager.encryptToken(googleTokens);
      } catch (encErr) {
        console.warn('Failed to encrypt Google tokens, storing as-is:', encErr.message);
      }
    }

    const authData = {
      code: authCode,
      state: state,
      provider: provider,
      redirectUri: redirectUri,
      expiresAt: expiresAt,
      createdAt: new Date(),
      manifest: manifest,
      access_type: access_type,
      schedule: schedule,
      googleTokens: encryptedGoogleTokens,
      pkce_challenge: codeChallenge || null,
      signingKeyPair: exportedSigningKeyPair
    };

    // Open the IDB transaction only after all async work is done
    const transaction = authDb.transaction(["authorizations"], "readwrite");
    const store = transaction.objectStore("authorizations");

    await new Promise((resolve, reject) => {
      const request = store.add(authData);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log('💾 Authorization data stored in background');

    // Store manifest entry in chrome.storage.local for the ManifestsPanel UI
    if (manifest) {
      const parsedM = parseManifest(manifest);
      const manifestId = authCode;
      const { manifests: existingManifests = [] } = await chrome.storage.local.get('manifests');

      const existingIdx = existingManifests.findIndex(m =>
        m.provider === provider && m.manifestText === manifest
      );

      if (existingIdx === -1) {
        existingManifests.push({
          id: manifestId,
          provider: provider,
          title: parsedM.title || provider,
          enabled: true,
          manifestText: manifest,
          accessType: access_type,
          authCode: authCode,
          grantedAt: new Date().toISOString(),
          constraints: {
            usage: { maxTotalUses: null, maxUsesPerPeriod: null, period: 'day', currentUses: 0, usageLog: [] },
            resource: { allowedFolders: [], allowedFileTypes: [], allowedLabels: [], obfuscateFields: [] },
            time: { expiresAt: null, durationMs: null, grantedAt: new Date().toISOString(), allowedWindows: [] }
          }
        });
      } else {
        existingManifests[existingIdx].authCode = authCode;
      }

      await chrome.storage.local.set({ manifests: existingManifests });
    }

    // Handle different access_type behaviors in background
    // Pass raw (unencrypted) googleTokens so install_time cleanup can clear the cache
    if (!skipAccessTypeBehavior) {
      await handleAccessTypeBehavior(access_type, {
        authCode,
        authData,
        manifest,
        redirectUri,
        state,
        schedule,
        tokenManager,
        runtime,
        rawGoogleTokens: googleTokens,
        ...handleAccessTypeBehaviorDeps
      });
    }

    console.log('✅ Background processing completed successfully');
    return authData;

  } catch (error) {
    console.error('❌ Background processing error:', error);

    // Optionally, you could send an error notification to the external client
    // But the user has already been redirected, so this runs silently
    // Notify the client of the background error.
    // SECURITY: Never include the authCode in error notifications -- it could
    // be used to bypass PKCE if the flow has not completed validation.
    try {
      await fetch(redirectUri, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OAuthHub-Type': 'background_error'
        },
        body: JSON.stringify({
          type: 'background_error',
          error: error.message,
          timestamp: new Date().toISOString()
        })
      });
    } catch (notifyError) {
      console.error('Failed to notify client of background error:', notifyError);
    }
    throw error;
  }
};

export const exchangeAuthorizationCode = async (code, manifest, endpoint, clientId, clientSecret, code_verifier = null, oauthCrypto) => {
  try {
    await authDbReady;
    const authDb = getAuthDb();

    // Get the stored authorization data
    const authTransaction = authDb.transaction(["authorizations"], "readonly");
    const authStore = authTransaction.objectStore("authorizations");
    const authRequest = authStore.get(code);

    return new Promise((resolve, reject) => {
      authRequest.onsuccess = async () => {
        const authData = authRequest.result;

        if (!authData) {
          reject(new Error('Invalid or expired authorization code'));
          return;
        }

        // Verify the manifest matches
        if (JSON.stringify(authData.manifest) !== JSON.stringify(manifest)) {
          reject(new Error('Manifest mismatch'));
          return;
        }

        // Check if the code has expired
        if (new Date(authData.expiresAt) <= new Date()) {
          reject(new Error('Authorization code has expired'));
          return;
        }

        // PKCE verification: if a challenge was stored, verifier is REQUIRED
        if (authData.pkce_challenge) {
          if (!code_verifier) {
            reject(new Error('PKCE code_verifier is required but was not provided'));
            return;
          }
          const pkceValid = await oauthCrypto.verifyPKCE(code_verifier, authData.pkce_challenge);
          if (!pkceValid) {
            reject(new Error('PKCE verification failed: code_verifier does not match'));
            return;
          }
        }

        try {
          // Generate access token
          const accessToken = generateAuthCode(); // Reusing the secure random generator

          // Calculate token expiration (1 hour from now)
          const expiresAt = new Date(Date.now() + 3600 * 1000);

          // Decrypt Google tokens if encrypted
          let decryptedGoogleTokens = authData.googleTokens;
          if (authData.googleTokens && authData.googleTokens.encrypted) {
            const tokenManager = new TokenManager();
            decryptedGoogleTokens = await tokenManager.decryptToken(authData.googleTokens);
            if (!decryptedGoogleTokens) {
              reject(new Error('Token decryption failed - session may have expired'));
              return;
            }
          }

          // If we have stored Google tokens, use their access token
          let actualAccessToken = accessToken;
          if (decryptedGoogleTokens && decryptedGoogleTokens.access_token) {
            actualAccessToken = decryptedGoogleTokens.access_token;
          }

          // Token rotation: generate a rotation token that must be presented for subsequent access
          const rotationToken = generateAuthCode();

          const tokenData = {
            provider: authData.provider,
            access_token: actualAccessToken,
            refresh_token: decryptedGoogleTokens ? decryptedGoogleTokens.refresh_token : generateAuthCode(),
            token_type: 'Bearer',
            expires_in: 3600,
            expiresAt: expiresAt,
            manifest: manifest,
            createdAt: new Date(),
            googleTokens: decryptedGoogleTokens,
            rotation_token: rotationToken
          };

          // SECURITY: Strip raw Google tokens from the payload sent to the
          // third-party endpoint.  Third-party apps must never receive
          // unfiltered Google API tokens -- they should only get the OAuthHub
          // access token and use EXECUTE_QUERY to access data through the
          // manifest pipeline.
          const { googleTokens: _gStripped, ...safeTokenData } = tokenData;

          // Send token to the specified endpoint
          // SECURITY: Chrome extensions are public clients per OAuth 2.1 --
          // do not send client_secret. Use only the client_id for identification.
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              code: code,
              client_id: clientId,
              token: safeTokenData,
              redirect_uri: authData.redirectUri
            })
          });

          if (!response.ok) {
            throw new Error(`Failed to send token to endpoint: ${response.statusText}`);
          }

          // Store token data locally via TokenManager (handles encryption)
          const storeTm = new TokenManager();
          // Strip the raw googleTokens before storing -- they're already
          // encrypted in the authorizations DB and shouldn't be duplicated
          // in plaintext in the token DB.
          const { googleTokens: _stripped, ...tokenDataToStore } = tokenData;
          await storeTm.storeTokens(
            tokenDataToStore.provider,
            tokenDataToStore,
            decryptedGoogleTokens ? Object.keys(decryptedGoogleTokens) : []
          );

          // Clean up used authorization code
          const cleanupTransaction = authDb.transaction(["authorizations"], "readwrite");
          const cleanupStore = cleanupTransaction.objectStore("authorizations");
          await new Promise((resolve, reject) => {
            const deleteRequest = cleanupStore.delete(code);
            deleteRequest.onsuccess = () => resolve();
            deleteRequest.onerror = () => reject(new Error('Failed to delete authorization code'));
          });

          // Return token response with rotation token for subsequent access
          resolve({
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            token_type: tokenData.token_type,
            expires_in: tokenData.expires_in,
            rotation_token: rotationToken
          });
        } catch (error) {
          reject(error);
        }
      };

      authRequest.onerror = () => {
        reject(new Error('Failed to retrieve authorization data'));
      };
    });
  } catch (error) {
    throw new Error(`Token exchange failed: ${error.message}`);
  }
};
