/**
 * Localhost HTTP server on port 19876.
 * Replaces chrome.runtime.sendMessage for client library communication.
 * Binds to 127.0.0.1 only (device-local) for security.
 *
 * Uses a local Expo native module (modules/expo-http-server) which wraps
 * Java's ServerSocket — reliable and properly linked via Expo autolinking.
 */
import * as ExpoHttpServer from 'expo-http-server';
import { messageHandler } from './message-handler';

const PORT = 19876;
const HOST = '127.0.0.1';

// Generate a per-session server secret for IPC authentication
function generateSecret() {
  const array = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

export class HttpServer {
  constructor() {
    this._running = false;
    this._messageHandler = messageHandler;
    this.serverSecret = null;
    this._subscription = null;
  }

  getSecret() {
    if (!this.serverSecret) {
      this.serverSecret = generateSecret();
    }
    return this.serverSecret;
  }

  isRunning() {
    return this._running;
  }

  async start() {
    if (this._running) return;

    // Listen for incoming HTTP requests from the native module
    this._subscription = ExpoHttpServer.addRequestListener((event) => {
      this._handleRequest(event);
    });

    await ExpoHttpServer.start(PORT, HOST);
    this._running = true;
    console.log(`OAuthHub HTTP server listening on ${HOST}:${PORT}`);

    // Start foreground service to keep the process alive when backgrounded
    try {
      await ExpoHttpServer.startForegroundService();
      console.log('Foreground service started');
    } catch (err) {
      console.warn('Foreground service failed to start:', err?.message);
    }
  }

  _authenticateRequest(headers) {
    const authHeader = headers['authorization'] || '';
    const match = authHeader.match(/^Bearer\s+(\S+)$/i);
    if (!match) return false;
    const provided = match[1];
    if (!this.serverSecret || provided.length !== this.serverSecret.length) return false;
    let result = 0;
    for (let i = 0; i < provided.length; i++) {
      result |= provided.charCodeAt(i) ^ this.serverSecret.charCodeAt(i);
    }
    return result === 0;
  }

  async _handleRequest(event) {
    const { requestId, method, path, headers, body } = event;

    try {
      // Handle OPTIONS preflight
      if (method === 'OPTIONS') {
        ExpoHttpServer.respond(requestId, 204, {}, '');
        return;
      }

      // Health check — no auth required
      if (path === '/api/health') {
        const json = JSON.stringify({ success: true, version: '1.0.0', platform: 'android' });
        ExpoHttpServer.respond(requestId, 200, {}, json);
        return;
      }

      // Exchange endpoint — no bearer auth (protected by PKCE code_verifier)
      if (path === '/api/exchange' && method === 'POST') {
        try {
          const jsonBody = body ? JSON.parse(body) : {};
          const responseBody = await this._messageHandler.handleExchangeAuthCode(jsonBody);
          ExpoHttpServer.respond(requestId, 200, {}, JSON.stringify(responseBody));
        } catch (err) {
          ExpoHttpServer.respond(requestId, 500, {}, JSON.stringify({ success: false, error: 'Exchange failed' }));
        }
        return;
      }

      // Query endpoint — Bearer = OAuthHub access token (validated by handler)
      if (path === '/api/query' && method === 'POST') {
        const authHeader = headers['authorization'] || '';
        const tokenMatch = authHeader.match(/^Bearer\s+(\S+)$/i);
        if (!tokenMatch) {
          ExpoHttpServer.respond(requestId, 401, {}, JSON.stringify({ success: false, error: 'Unauthorized' }));
          return;
        }
        try {
          const jsonBody = body ? JSON.parse(body) : {};
          jsonBody.token = tokenMatch[1]; // ensure token from header is used
          const responseBody = await this._messageHandler.handleExecuteQuery(jsonBody);
          ExpoHttpServer.respond(requestId, 200, {}, JSON.stringify(responseBody));
        } catch (err) {
          ExpoHttpServer.respond(requestId, 500, {}, JSON.stringify({ success: false, error: 'Query failed' }));
        }
        return;
      }

      // Authenticate all other (internal) requests — Bearer = server secret
      if (!this._authenticateRequest(headers)) {
        ExpoHttpServer.respond(requestId, 401, {}, JSON.stringify({ success: false, error: 'Unauthorized' }));
        return;
      }

      let responseBody;
      let statusCode = 200;

      try {
        const jsonBody = body ? JSON.parse(body) : {};

        switch (path) {
          case '/api/stats':
            responseBody = await this._messageHandler.handleGetStats();
            break;
          case '/api/services':
            if (method === 'GET') {
              responseBody = await this._messageHandler.handleGetConnectedServices();
            } else if (method === 'POST') {
              responseBody = await this._messageHandler.handleConnectService(jsonBody);
            } else if (method === 'DELETE') {
              responseBody = await this._messageHandler.handleDisconnectService(jsonBody);
            }
            break;
          case '/api/manifests':
            responseBody = await this._messageHandler.handleGetManifests();
            break;
          case '/api/preview':
            responseBody = await this._messageHandler.handlePreviewManifest(jsonBody);
            break;
          default:
            statusCode = 404;
            responseBody = { success: false, error: 'Not found' };
        }
      } catch (err) {
        console.error('Handler error:', err);
        statusCode = 500;
        responseBody = { success: false, error: 'Internal server error' };
      }

      const json = JSON.stringify(responseBody);
      ExpoHttpServer.respond(requestId, statusCode, {}, json);
    } catch (err) {
      console.error('Request handling error:', err);
      try {
        ExpoHttpServer.respond(requestId, 500, {}, JSON.stringify({ success: false, error: 'Internal server error' }));
      } catch (e) { /* ignore */ }
    }
  }

  async stop() {
    if (this._subscription) {
      this._subscription.remove();
      this._subscription = null;
    }
    if (this._running) {
      try {
        await ExpoHttpServer.stopForegroundService();
      } catch (err) {
        console.warn('Foreground service stop failed:', err?.message);
      }
      await ExpoHttpServer.stop();
      this._running = false;
    }
  }
}
