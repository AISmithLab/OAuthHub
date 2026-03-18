/**
 * OAuth Security Utilities for PKCE, DPoP, and enhanced security
 * Implements OAuth 2.1 and related security best practices
 */

class OAuthCrypto {
  constructor() {
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
  }

  /**
   * Generate a cryptographically secure random string
   * @param {number} length - Length of the random string
   * @returns {string} Base64URL encoded random string
   */
  generateSecureRandom(length = 32) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return this.base64URLEncode(array);
  }

  /**
   * Generate a secure state parameter
   * @returns {string} Cryptographically secure state parameter
   */
  generateState() {
    return this.generateSecureRandom(32);
  }

  /**
   * Generate a secure nonce for replay protection
   * @returns {string} Cryptographically secure nonce
   */
  generateNonce() {
    return this.generateSecureRandom(32);
  }

  /**
   * Generate PKCE code verifier and challenge
   * @returns {Promise<{verifier: string, challenge: string, method: string}>}
   */
  async generatePKCE() {
    // Generate code verifier (43-128 characters, base64url-encoded)
    const verifier = this.generateSecureRandom(32);
    
    // Generate code challenge using SHA256
    const challenge = await this.generateCodeChallenge(verifier);
    
    return {
      verifier,
      challenge,
      method: 'S256'
    };
  }

  /**
   * Generate PKCE code challenge from verifier
   * @param {string} verifier - Code verifier
   * @returns {Promise<string>} Base64URL encoded SHA256 hash of verifier
   */
  async generateCodeChallenge(verifier) {
    const data = this.encoder.encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return this.base64URLEncode(new Uint8Array(hash));
  }

  /**
   * Verify PKCE code challenge
   * @param {string} verifier - Code verifier
   * @param {string} challenge - Code challenge to verify against
   * @returns {Promise<boolean>} True if challenge matches verifier
   */
  async verifyPKCE(verifier, challenge) {
    const computedChallenge = await this.generateCodeChallenge(verifier);
    return computedChallenge === challenge;
  }

  /**
   * Generate DPoP key pair for demonstration of proof of possession
   * @returns {Promise<{publicKey: CryptoKey, privateKey: CryptoKey, jwk: object}>}
   */
  async generateDPoPKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256'
      },
      true, // extractable
      ['sign', 'verify']
    );

    // Export public key as JWK for DPoP proof
    const publicKeyJWK = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    
    // Add required JWK parameters for DPoP
    publicKeyJWK.use = 'sig';
    publicKeyJWK.alg = 'ES256';
    
    return {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      jwk: publicKeyJWK
    };
  }

  /**
   * Create DPoP proof JWT
   * @param {CryptoKey} privateKey - Private key for signing
   * @param {object} publicKeyJWK - Public key JWK
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @param {string} url - Target URL
   * @param {string} accessToken - Access token (optional, for token-bound requests)
   * @returns {Promise<string>} DPoP proof JWT
   */
  async createDPoPProof(privateKey, publicKeyJWK, method, url, accessToken = null) {
    const now = Math.floor(Date.now() / 1000);
    const jti = this.generateSecureRandom(16); // Unique identifier for this proof

    // DPoP JWT header
    const header = {
      typ: 'dpop+jwt',
      alg: 'ES256',
      jwk: publicKeyJWK
    };

    // DPoP JWT payload
    const payload = {
      jti,
      htm: method.toUpperCase(),
      htu: url,
      iat: now,
      exp: now + 300 // 5 minutes expiry
    };

    // Add access token hash if provided
    if (accessToken) {
      const tokenHash = await crypto.subtle.digest('SHA-256', this.encoder.encode(accessToken));
      payload.ath = this.base64URLEncode(new Uint8Array(tokenHash));
    }

    return await this.signJWT(header, payload, privateKey);
  }

  /**
   * Sign a JWT using ECDSA P-256
   * @param {object} header - JWT header
   * @param {object} payload - JWT payload
   * @param {CryptoKey} privateKey - Private key for signing
   * @returns {Promise<string>} Signed JWT
   */
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
   * @param {Uint8Array} bytes - Bytes to encode
   * @returns {string} Base64URL encoded string
   */
  base64URLEncode(bytes) {
    const base64 = btoa(String.fromCharCode.apply(null, bytes));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Base64URL decode
   * @param {string} str - Base64URL encoded string
   * @returns {Uint8Array} Decoded bytes
   */
  base64URLDecode(str) {
    // Add padding if necessary
    str += '==='.slice(0, 4 - (str.length % 4));
    // Convert to regular base64
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    // Decode
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Generate a secure authorization code
   * @returns {string} Cryptographically secure authorization code
   */
  generateAuthorizationCode() {
    return this.generateSecureRandom(32);
  }

  /**
   * Generate secure access and refresh tokens
   * @returns {object} Object containing access_token and refresh_token
   */
  generateTokens() {
    return {
      access_token: this.generateSecureRandom(32),
      refresh_token: this.generateSecureRandom(32)
    };
  }

  /**
   * Validate that a state parameter matches the stored state
   * @param {string} receivedState - State received in callback
   * @param {string} storedState - State stored during authorization request
   * @returns {boolean} True if states match
   */
  validateState(receivedState, storedState) {
    if (!receivedState || !storedState) {
      return false;
    }
    return receivedState === storedState;
  }

  /**
   * Create a secure session identifier
   * @returns {string} Session ID for tracking OAuth flows
   */
  generateSessionId() {
    return this.generateSecureRandom(24);
  }

  /**
   * Hash a value using SHA-256
   * @param {string} value - Value to hash
   * @returns {Promise<string>} Base64URL encoded hash
   */
  async sha256Hash(value) {
    const data = this.encoder.encode(value);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return this.base64URLEncode(new Uint8Array(hash));
  }

  /**
   * Create a DPoP-bound access token fingerprint
   * @param {string} accessToken - Access token
   * @param {object} publicKeyJWK - DPoP public key JWK
   * @returns {Promise<string>} Token fingerprint for binding verification
   */
  async createTokenFingerprint(accessToken, publicKeyJWK) {
    const combined = accessToken + JSON.stringify(publicKeyJWK);
    return await this.sha256Hash(combined);
  }
}

export default OAuthCrypto;
