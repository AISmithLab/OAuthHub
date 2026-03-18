/**
 * OAuthHub Client Library
 *
 * Core APIs for integrating with OAuthHub (PKCE flow):
 *   1. generateAuthUrl  – Build the authorization URL and return it
 *   2. exchangeToken    – Exchange auth code for access token (PKCE verified internally)
 *   3. query            – Execute manifest pipeline (token rotated on each use)
 *
 * The library manages PKCE state (state + codeVerifier) in sessionStorage.
 * Credential persistence (access_token, publicKey, userSub) is the app's responsibility.
 *
 *   // 1. Start sign-in
 *   const url = await OAuthHubClient.generateAuthUrl({ ... });
 *   location.href = url;
 *
 *   // 2. On callback page
 *   const { access_token } = await OAuthHubClient.exchangeToken({
 *     code: params.get('code'), state: params.get('state')
 *   });
 *   // App stores access_token; POSTs publicKey/userSub to server
 *
 *   // 3. Execute manifest
 *   const { token } = await OAuthHubClient.query({ token: access_token, manifest });
 *   // App stores rotated token for next query
 *
 * Signature verification:
 *   verifyJWT({ jwt, publicKeyJwk, body }) — works in browser and Node 16+.
 *   verifySignedPayload({ headers, rawBody, publicKeyJwk }) — header lookup + JWT verify + JSON parse.
 *
 * Usage (browser):  <script src="oauthub-lib.js"></script>
 * Usage (Node):     const OAuthHubClient = require('oauthub-lib');
 */
(function (root) {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────
  var OAUTHUB_EXTENSION_ID = 'hgdiehopbnpjmlihljcbllngkmohmfjh';
  var OAUTHUB_AUTH_ENDPOINT =
    'chrome-extension://' + OAUTHUB_EXTENSION_ID + '/index.html#/authorize';
  var SIGNATURE_HEADER = 'X-OAuthHub-Signature';

  // ─── PKCE Session Storage ──────────────────────────────────────────
  var PKCE_STATE_KEY = 'oauthub_state';
  var PKCE_VERIFIER_KEY = 'oauthub_code_verifier';

  function _hasSessionStorage() {
    return typeof sessionStorage !== 'undefined';
  }

  function _savePKCE(state, codeVerifier) {
    if (!_hasSessionStorage()) return;
    sessionStorage.setItem(PKCE_STATE_KEY, state);
    sessionStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);
  }

  function _loadAndClearPKCE(state) {
    if (!_hasSessionStorage()) {
      throw new Error('sessionStorage not available');
    }
    var savedState = sessionStorage.getItem(PKCE_STATE_KEY);
    if (!savedState || savedState !== state) {
      throw new Error('State mismatch — possible CSRF');
    }
    var codeVerifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
    if (!codeVerifier) {
      throw new Error('Missing PKCE code_verifier');
    }
    sessionStorage.removeItem(PKCE_STATE_KEY);
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    return codeVerifier;
  }

  // ─── Internal helpers ───────────────────────────────────────────────

  function _randomHex(bytes) {
    bytes = bytes || 32;
    var buf = new Uint8Array(bytes);
    (typeof crypto !== 'undefined' ? crypto : require('crypto').webcrypto)
      .getRandomValues(buf);
    return Array.from(buf, function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }

  function _base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    var bin = atob(str);
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf;
  }

  function _getSubtle() {
    if (typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle;
    return require('crypto').webcrypto.subtle;
  }

  function _getEncoder() {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder();
    return new (require('util').TextEncoder)();
  }

  function _base64URLEncode(buf) {
    var binary = '';
    for (var i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  function _sha256(str) {
    var data = _getEncoder().encode(str);
    return _getSubtle().digest('SHA-256', data).then(function (hash) {
      return _base64URLEncode(new Uint8Array(hash));
    });
  }

  function _getHeaderValue(headers, name) {
    if (!headers || !name) return null;

    if (typeof headers.get === 'function') {
      return headers.get(name) || headers.get(name.toLowerCase()) || null;
    }

    var normalizedName = name.toLowerCase();
    var value = headers[normalizedName];

    if (value == null) {
      var keys = Object.keys(headers);
      for (var i = 0; i < keys.length; i++) {
        if (String(keys[i]).toLowerCase() === normalizedName) {
          value = headers[keys[i]];
          break;
        }
      }
    }

    if (Array.isArray(value)) {
      for (var j = 0; j < value.length; j++) {
        if (value[j]) return value[j];
      }
      return null;
    }

    return typeof value === 'string' && value ? value : null;
  }

  function _generatePKCE() {
    var buf = new Uint8Array(32);
    (typeof crypto !== 'undefined' ? crypto : require('crypto').webcrypto)
      .getRandomValues(buf);
    var codeVerifier = _base64URLEncode(buf);
    return _sha256(codeVerifier).then(function (codeChallenge) {
      return { codeVerifier: codeVerifier, codeChallenge: codeChallenge };
    });
  }

  // ─── 1. Generate Authorization URL ─────────────────────────────────

  /**
   * Build the OAuthHub authorization URL with a fresh PKCE pair.
   * Stores state + codeVerifier in sessionStorage automatically.
   *
   * @param {Object} opts
   * @param {string} opts.provider   – e.g. "google_calendar"
   * @param {string} opts.manifest   – Fine-grained data-access manifest
   * @param {string} opts.redirect   – Callback URL after authorization
   * @param {string} opts.accessType – "user_driven" | "install_time" | "scheduled_time"
   * @param {string} [opts.schedule] – Schedule spec for "scheduled_time"
   * @returns {Promise<string>} Authorization URL
   */
  function generateAuthUrl(opts) {
    if (!opts || !opts.provider || !opts.manifest || !opts.redirect || !opts.accessType) {
      return Promise.reject(new Error(
        'OAuthHubClient.generateAuthUrl requires: provider, manifest, redirect, accessType'
      ));
    }

    var state = _randomHex(32);

    return _generatePKCE().then(function (pkce) {
      _savePKCE(state, pkce.codeVerifier);

      var params = new URLSearchParams({
        provider:              opts.provider,
        manifest:              opts.manifest,
        redirect_uri:          opts.redirect,
        access_type:           opts.accessType,
        state:                 state,
        code_challenge:        pkce.codeChallenge,
        code_challenge_method: 'S256'
      });

      if (opts.schedule) params.set('schedule', opts.schedule);

      return OAUTHUB_AUTH_ENDPOINT + '?' + params.toString();
    });
  }

  // ─── 2. Exchange Auth Code for Access Token ──────────────────────

  /**
   * Exchange authorization code for an access token.
   * Validates state and retrieves code_verifier from sessionStorage automatically.
   *
   * @param {Object} opts
   * @param {string} opts.code  – Authorization code from callback URL
   * @param {string} opts.state – State parameter from callback URL (CSRF check)
   * @returns {Promise<{ access_token: string, expires_in: number }>}
   */
  function exchangeToken(opts) {
    if (!opts || !opts.code || !opts.state) {
      return Promise.reject(new Error(
        'OAuthHubClient.exchangeToken requires: code, state'
      ));
    }

    var codeVerifier;
    try {
      codeVerifier = _loadAndClearPKCE(opts.state);
    } catch (e) {
      return Promise.reject(e);
    }

    return new Promise(function (resolve, reject) {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error('Chrome extension messaging not available'));
        return;
      }

      chrome.runtime.sendMessage(
        OAUTHUB_EXTENSION_ID,
        {
          type: 'EXCHANGE_AUTH_CODE',
          code: opts.code,
          code_verifier: codeVerifier
        },
        function (response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response || !response.success) {
            reject(new Error(response ? response.error : 'Token exchange failed'));
            return;
          }
          resolve({ access_token: response.access_token, expires_in: response.expires_in });
        }
      );
    });
  }

  // ─── 3. Query / Write Data Through OAuthHub ────────────────────────

  /**
   * Execute a manifest pipeline. Token is rotated on each use — the caller
   * must store the returned token for subsequent calls.
   *
   * @param {Object} opts
   * @param {string} opts.token         – Access token from exchangeToken or previous query
   * @param {string} opts.manifest      – The data-access manifest
   * @param {string} [opts.operation]   – "read" (default) or "write"
   * @param {Object} [opts.data]        – Payload for write operations
   * @returns {Promise<{ success: boolean, token: string }>}
   */
  function query(opts) {
    if (!opts || !opts.token || !opts.manifest) {
      return Promise.reject(new Error('OAuthHubClient.query requires: token, manifest'));
    }

    return new Promise(function (resolve, reject) {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error('Chrome extension messaging not available'));
        return;
      }

      chrome.runtime.sendMessage(
        OAUTHUB_EXTENSION_ID,
        {
          type: 'EXECUTE_QUERY',
          token: opts.token,
          manifest: opts.manifest,
          operation: opts.operation || 'read',
          data: opts.data || undefined
        },
        function (response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response || !response.success) {
            reject(new Error(response ? response.error : 'Query failed'));
            return;
          }
          resolve({ success: true, token: response.token });
        }
      );
    });
  }

  // ─── Payload Signature Verification (JWT / ES256) ───────────────────

  /**
   * Verify a JWT signature from the local hub (ES256).
   *
   * @param {Object} opts
   * @param {string} opts.jwt          – The signed JWT (header.payload.signature)
   * @param {Object} opts.publicKeyJwk – JWK public key (stored from OAuth redirect)
   * @param {string} [opts.body]       – Raw request body to verify against body_hash
   * @param {number} [opts.maxAge]     – Max age in seconds (default 300)
   * @returns {Promise<boolean>}
   */
  function verifyJWT(opts) {
    if (!opts || !opts.jwt || !opts.publicKeyJwk) {
      return Promise.resolve(false);
    }

    var parts = opts.jwt.split('.');
    if (parts.length !== 3) return Promise.resolve(false);

    var payload;
    try {
      var payloadStr = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (payloadStr.length % 4) payloadStr += '=';
      payload = JSON.parse(atob(payloadStr));
    } catch (e) {
      return Promise.resolve(false);
    }

    var maxAge = (opts.maxAge || 300) * 1000;
    if (payload.iat) {
      var iatMs = payload.iat * 1000;
      if (Math.abs(Date.now() - iatMs) > maxAge) {
        return Promise.resolve(false);
      }
    }

    var headerPayload = parts[0] + '.' + parts[1];
    var sigBytes = _base64UrlDecode(parts[2]);

    return _getSubtle().importKey(
      'jwk', opts.publicKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false, ['verify']
    ).then(function (key) {
      return _getSubtle().verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        sigBytes,
        _getEncoder().encode(headerPayload)
      );
    }).then(function (sigValid) {
      if (!sigValid) return false;

      if (opts.body && payload.body_hash) {
        return _getSubtle().digest(
          'SHA-256',
          _getEncoder().encode(opts.body)
        ).then(function (hash) {
          var computed = _base64URLEncode(new Uint8Array(hash));
          return computed === payload.body_hash;
        });
      }

      return true;
    });
  }

  /**
   * Verify a signed payload and parse the JSON body.
   *
   * @param {Object} opts
   * @param {Headers|Object} opts.headers     – Request headers
   * @param {string} opts.rawBody             – Raw request body string
   * @param {Object} opts.publicKeyJwk        – JWK public key
   * @param {boolean} [opts.requireSignature] – Whether signature is mandatory (default true)
   * @returns {Promise<{ body: any, signature: string | null }>}
   */
  function verifySignedPayload(opts) {
    if (!opts || !opts.headers || typeof opts.rawBody !== 'string' || !opts.publicKeyJwk) {
      return Promise.reject(new Error(
        'OAuthHubClient.verifySignedPayload requires: headers, rawBody, publicKeyJwk'
      ));
    }

    var signature = _getHeaderValue(opts.headers, SIGNATURE_HEADER);
    var requireSignature = opts.requireSignature !== false;

    if (!signature) {
      if (requireSignature) {
        return Promise.reject(new Error('Missing OAuthHub signature'));
      }

      try {
        return Promise.resolve({ body: JSON.parse(opts.rawBody), signature: null });
      } catch (e) {
        return Promise.reject(new Error('Invalid JSON payload'));
      }
    }

    return verifyJWT({
      jwt: signature,
      publicKeyJwk: opts.publicKeyJwk,
      body: opts.rawBody,
      maxAge: opts.maxAge
    }).then(function (valid) {
      if (!valid) {
        throw new Error('Invalid signature');
      }

      try {
        return { body: JSON.parse(opts.rawBody), signature: signature };
      } catch (e) {
        throw new Error('Invalid JSON payload');
      }
    });
  }

  // ─── Public API ────────────────────────────────────────────────────

  var OAuthHubClient = {
    generateAuthUrl: generateAuthUrl,
    exchangeToken:   exchangeToken,
    query:           query,
    verifyJWT:       verifyJWT,
    verifySignedPayload: verifySignedPayload,
    SIGNATURE_HEADER: SIGNATURE_HEADER,
    EXTENSION_ID:    OAUTHUB_EXTENSION_ID
  };

  // ─── Module export (UMD) ───────────────────────────────────────────
  if (typeof define === 'function' && define.amd) {
    define([], function () { return OAuthHubClient; });
  } else if (typeof module === 'object' && module.exports) {
    module.exports = OAuthHubClient;
  } else {
    root.OAuthHubClient = OAuthHubClient;
  }

})(typeof window !== 'undefined' ? window : this);
