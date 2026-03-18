/**
 * OAuthHub Client Library — Android / Cross-platform Edition
 *
 * Works in both React Native apps and browser web apps.
 * Uses localhost HTTP (127.0.0.1:19876) instead of Chrome extension messaging.
 * Uses oauthub:// deep links instead of chrome-extension:// URLs.
 *
 * Core APIs:
 *   1. generateAuthUrl  – Build oauthub:// authorization URL
 *   2. exchangeToken    – Exchange auth code via localhost HTTP
 *   3. query            – Execute manifest pipeline via localhost HTTP
 *
 * Usage (React Native): import OAuthHubClient from './oauthub-lib.android';
 * Usage (browser):      <script src="oauthub-lib.android.js"></script>
 * Usage (Node):         const OAuthHubClient = require('./oauthub-lib.android');
 */
(function (root) {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────
  var OAUTHUB_API_BASE = 'http://127.0.0.1:19876';
  var OAUTHUB_AUTH_ENDPOINT = 'oauthub://authorize';
  var SIGNATURE_HEADER = 'X-OAuthHub-Signature';

  // ─── PKCE State Storage (auto-detect environment) ────────────────────
  var PKCE_STATE_KEY = 'oauthub_state';
  var PKCE_VERIFIER_KEY = 'oauthub_code_verifier';

  // In-memory fallback for React Native (no sessionStorage)
  var _memoryStore = {};

  function _hasSessionStorage() {
    try {
      return typeof sessionStorage !== 'undefined' && sessionStorage !== null;
    } catch (e) {
      return false;
    }
  }

  function _savePKCE(state, codeVerifier) {
    if (_hasSessionStorage()) {
      sessionStorage.setItem(PKCE_STATE_KEY, state);
      sessionStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);
    } else {
      _memoryStore[PKCE_STATE_KEY] = state;
      _memoryStore[PKCE_VERIFIER_KEY] = codeVerifier;
    }
  }

  function _loadAndClearPKCE(state) {
    var savedState, codeVerifier;

    if (_hasSessionStorage()) {
      savedState = sessionStorage.getItem(PKCE_STATE_KEY);
      codeVerifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
      sessionStorage.removeItem(PKCE_STATE_KEY);
      sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    } else {
      savedState = _memoryStore[PKCE_STATE_KEY];
      codeVerifier = _memoryStore[PKCE_VERIFIER_KEY];
      delete _memoryStore[PKCE_STATE_KEY];
      delete _memoryStore[PKCE_VERIFIER_KEY];
    }

    if (!savedState || savedState !== state) {
      throw new Error('State mismatch — possible CSRF');
    }
    if (!codeVerifier) {
      throw new Error('Missing PKCE code_verifier');
    }
    return codeVerifier;
  }

  // ─── Internal helpers ───────────────────────────────────────────────

  // Get crypto object — works in browser and React Native (with polyfill)
  function _getCrypto() {
    if (typeof crypto !== 'undefined') return crypto;
    if (typeof globalThis !== 'undefined' && globalThis.crypto) return globalThis.crypto;
    throw new Error('Web Crypto API not available. Ensure crypto polyfill is loaded.');
  }

  function _randomHex(bytes) {
    bytes = bytes || 32;
    var buf = new Uint8Array(bytes);
    _getCrypto().getRandomValues(buf);
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
    var c = _getCrypto();
    if (c && c.subtle) return c.subtle;
    throw new Error('crypto.subtle not available');
  }

  function _getEncoder() {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder();
    if (typeof globalThis !== 'undefined' && globalThis.TextEncoder) return new globalThis.TextEncoder();
    throw new Error('TextEncoder not available. Ensure polyfill is loaded.');
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
    _getCrypto().getRandomValues(buf);
    var codeVerifier = _base64URLEncode(buf);
    return _sha256(codeVerifier).then(function (codeChallenge) {
      return { codeVerifier: codeVerifier, codeChallenge: codeChallenge };
    });
  }

  // ─── Environment detection ──────────────────────────────────────────

  function _isReactNative() {
    return typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
  }

  function _openURL(url) {
    if (_isReactNative()) {
      // In React Native, use Linking API
      try {
        var Linking = require('expo-linking');
        Linking.openURL(url);
      } catch (e) {
        try {
          var RNLinking = require('react-native').Linking;
          RNLinking.openURL(url);
        } catch (e2) {
          console.error('Cannot open URL:', url);
        }
      }
    } else if (typeof window !== 'undefined') {
      window.location.href = url;
    }
  }

  // ─── 1. Generate Authorization URL ─────────────────────────────────

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

    return fetch(OAUTHUB_API_BASE + '/api/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: opts.code,
        code_verifier: codeVerifier
      })
    }).then(function (response) {
      return response.json();
    }).then(function (data) {
      if (!data || !data.success) {
        throw new Error(data ? data.error : 'Token exchange failed');
      }
      return {
        access_token: data.access_token,
        expires_in: data.expires_in,
        publicKeyJWK: data.publicKeyJWK || null
      };
    });
  }

  // ─── 3. Query / Write Data Through OAuthHub ────────────────────────

  function query(opts) {
    if (!opts || !opts.token || !opts.manifest) {
      return Promise.reject(new Error('OAuthHubClient.query requires: token, manifest'));
    }

    return fetch(OAUTHUB_API_BASE + '/api/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + opts.token
      },
      body: JSON.stringify({
        token: opts.token,
        manifest: opts.manifest,
        operation: opts.operation || 'read',
        data: opts.data || undefined
      })
    }).then(function (response) {
      return response.json();
    }).then(function (data) {
      if (!data || !data.success) {
        throw new Error(data ? data.error : 'Query failed');
      }
      return { success: true, token: data.token, data: data.data };
    });
  }

  // ─── Payload Signature Verification (JWT / ES256) ───────────────────

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

  // ─── Utility: Open auth URL ───────────────────────────────────────

  function openAuthUrl(opts) {
    return generateAuthUrl(opts).then(function (url) {
      _openURL(url);
      return url;
    });
  }

  // ─── Utility: Check if OAuthHub server is running ──────────────────

  function checkHealth() {
    return fetch(OAUTHUB_API_BASE + '/api/health')
      .then(function (r) { return r.json(); })
      .then(function (data) { return data && data.success; })
      .catch(function () { return false; });
  }

  // ─── Public API ────────────────────────────────────────────────────

  // Persist/restore PKCE state for React Native (survives process death)
  function getPKCEState() {
    return {
      state: _memoryStore[PKCE_STATE_KEY] || null,
      codeVerifier: _memoryStore[PKCE_VERIFIER_KEY] || null
    };
  }

  function restorePKCE(state, codeVerifier) {
    if (state) _memoryStore[PKCE_STATE_KEY] = state;
    if (codeVerifier) _memoryStore[PKCE_VERIFIER_KEY] = codeVerifier;
  }

  var OAuthHubClient = {
    generateAuthUrl:     generateAuthUrl,
    exchangeToken:       exchangeToken,
    query:               query,
    verifyJWT:           verifyJWT,
    verifySignedPayload: verifySignedPayload,
    openAuthUrl:         openAuthUrl,
    checkHealth:         checkHealth,
    getPKCEState:        getPKCEState,
    restorePKCE:         restorePKCE,
    SIGNATURE_HEADER:    SIGNATURE_HEADER,
    API_BASE:            OAUTHUB_API_BASE
  };

  // ─── Module export (UMD) ───────────────────────────────────────────
  if (typeof define === 'function' && define.amd) {
    define([], function () { return OAuthHubClient; });
  } else if (typeof module === 'object' && module.exports) {
    module.exports = OAuthHubClient;
  } else {
    root.OAuthHubClient = OAuthHubClient;
  }

})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
