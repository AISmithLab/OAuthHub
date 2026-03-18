/**
 * OAuth Security Utilities for PKCE, DPoP, and enhanced security
 * Implements OAuth 2.1 and related security best practices
 */

class OAuthCrypto {
  constructor() {
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
  }

  generateSecureRandom(length = 32) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return this.base64URLEncode(array);
  }

  generateState() {
    return this.generateSecureRandom(32);
  }

  generateNonce() {
    return this.generateSecureRandom(32);
  }

  async generatePKCE() {
    const verifier = this.generateSecureRandom(32);
    const challenge = await this.generateCodeChallenge(verifier);
    return { verifier, challenge, method: 'S256' };
  }

  async generateCodeChallenge(verifier) {
    const data = this.encoder.encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return this.base64URLEncode(new Uint8Array(hash));
  }

  /**
   * Verify PKCE code challenge using constant-time comparison
   */
  async verifyPKCE(verifier, challenge) {
    const computedChallenge = await this.generateCodeChallenge(verifier);
    return this._constantTimeEqual(computedChallenge, challenge);
  }

  async generateDPoPKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );

    const publicKeyJWK = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    publicKeyJWK.use = 'sig';
    publicKeyJWK.alg = 'ES256';

    return {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      jwk: publicKeyJWK
    };
  }

  async createDPoPProof(privateKey, publicKeyJWK, method, url, accessToken = null) {
    const now = Math.floor(Date.now() / 1000);
    const jti = this.generateSecureRandom(16);

    const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: publicKeyJWK };
    const payload = { jti, htm: method.toUpperCase(), htu: url, iat: now, exp: now + 300 };

    if (accessToken) {
      const tokenHash = await crypto.subtle.digest('SHA-256', this.encoder.encode(accessToken));
      payload.ath = this.base64URLEncode(new Uint8Array(tokenHash));
    }

    return await this.signJWT(header, payload, privateKey);
  }

  async signJWT(header, payload, privateKey) {
    const headerB64 = this.base64URLEncode(this.encoder.encode(JSON.stringify(header)));
    const payloadB64 = this.base64URLEncode(this.encoder.encode(JSON.stringify(payload)));

    const message = `${headerB64}.${payloadB64}`;
    const messageBytes = this.encoder.encode(message);

    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      messageBytes
    );

    const signatureB64 = this.base64URLEncode(new Uint8Array(signature));
    return `${message}.${signatureB64}`;
  }

  /**
   * Base64URL encode (RFC 4648 Section 5)
   * Uses loop-based approach to avoid stack overflow on large arrays
   */
  base64URLEncode(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Base64URL decode with correct padding
   */
  base64URLDecode(str) {
    // Add correct padding: (4 - len%4) % 4 gives 0 when already aligned
    str += '='.repeat((4 - (str.length % 4)) % 4);
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  generateAuthorizationCode() {
    return this.generateSecureRandom(32);
  }

  generateTokens() {
    return {
      access_token: this.generateSecureRandom(32),
      refresh_token: this.generateSecureRandom(32)
    };
  }

  /**
   * Validate state using constant-time comparison
   */
  validateState(receivedState, storedState) {
    if (!receivedState || !storedState) return false;
    return this._constantTimeEqual(receivedState, storedState);
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   */
  _constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  generateSessionId() {
    return this.generateSecureRandom(24);
  }

  async sha256Hash(value) {
    const data = this.encoder.encode(value);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return this.base64URLEncode(new Uint8Array(hash));
  }

  async createTokenFingerprint(accessToken, publicKeyJWK) {
    const combined = accessToken + JSON.stringify(publicKeyJWK);
    return await this.sha256Hash(combined);
  }
}

export default OAuthCrypto;
