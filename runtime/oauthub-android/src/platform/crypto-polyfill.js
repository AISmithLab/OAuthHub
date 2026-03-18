/**
 * Full crypto.subtle polyfill for React Native (Hermes engine).
 * Uses pure JS implementations:
 *   - @noble/curves  → ECDSA P-256 (generateKey, sign, verify, importKey, exportKey)
 *   - @noble/ciphers → AES-GCM (encrypt, decrypt, generateKey, importKey, exportKey)
 *   - @noble/hashes  → SHA-256 (digest)
 *   - expo-crypto    → getRandomValues
 */
import { p256 } from '@noble/curves/p256';
import { gcm } from '@noble/ciphers/aes';
import { sha256 } from '@noble/hashes/sha256';
import * as ExpoCrypto from 'expo-crypto';

// ─── getRandomValues ─────────────────────────────────────────────────
function getRandomValues(buf) {
  const bytes = ExpoCrypto.getRandomBytes(buf.length);
  buf.set(new Uint8Array(bytes));
  return buf;
}

function randomBytes(n) {
  const buf = new Uint8Array(n);
  return getRandomValues(buf);
}

// ─── Helpers ─────────────────────────────────────────────────────────
function toArrayBuffer(uint8) {
  const ab = new ArrayBuffer(uint8.length);
  new Uint8Array(ab).set(uint8);
  return ab;
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const binary = globalThis.atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─── crypto.subtle implementation ────────────────────────────────────

async function subtleDigest(algorithm, data) {
  const algoName = typeof algorithm === 'string' ? algorithm : algorithm.name;
  if (algoName !== 'SHA-256') throw new Error(`Unsupported digest algorithm: ${algoName}`);
  const hash = sha256(new Uint8Array(data));
  return toArrayBuffer(hash);
}

async function subtleGenerateKey(algorithm, extractable, keyUsages) {
  const algoName = algorithm.name || algorithm;

  if (algoName === 'ECDSA' || algoName === 'ECDH') {
    if (algorithm.namedCurve !== 'P-256') throw new Error(`Unsupported curve: ${algorithm.namedCurve}`);
    const privBytes = randomBytes(32);
    const privKey = p256.utils.normPrivateKeyToScalar(privBytes);
    const pubPoint = p256.ProjectivePoint.fromPrivateKey(privBytes);
    return {
      privateKey: { type: 'private', algorithm, extractable, usages: keyUsages, _key: privBytes },
      publicKey: { type: 'public', algorithm, extractable, usages: keyUsages, _key: pubPoint },
    };
  }

  if (algoName === 'AES-GCM') {
    const length = algorithm.length || 256;
    const keyBytes = randomBytes(length / 8);
    return { type: 'secret', algorithm, extractable, usages: keyUsages, _key: keyBytes };
  }

  throw new Error(`Unsupported algorithm for generateKey: ${algoName}`);
}

async function subtleExportKey(format, key) {
  if (format === 'jwk') {
    if (key.algorithm?.name === 'ECDSA' || key.algorithm?.name === 'ECDH') {
      if (key.type === 'public') {
        const point = key._key;
        const raw = point.toRawBytes(false); // uncompressed: 0x04 || x || y
        const x = raw.slice(1, 33);
        const y = raw.slice(33, 65);
        return {
          kty: 'EC',
          crv: 'P-256',
          x: base64UrlEncode(x),
          y: base64UrlEncode(y),
        };
      }
      if (key.type === 'private') {
        const pubPoint = p256.ProjectivePoint.fromPrivateKey(key._key);
        const raw = pubPoint.toRawBytes(false);
        return {
          kty: 'EC',
          crv: 'P-256',
          x: base64UrlEncode(raw.slice(1, 33)),
          y: base64UrlEncode(raw.slice(33, 65)),
          d: base64UrlEncode(key._key),
        };
      }
    }

    if (key.algorithm?.name === 'AES-GCM') {
      return {
        kty: 'oct',
        k: base64UrlEncode(key._key),
        alg: `A${key.algorithm.length || 256}GCM`,
        ext: true,
      };
    }
  }

  if (format === 'raw') {
    if (key.algorithm?.name === 'AES-GCM') {
      return toArrayBuffer(key._key);
    }
    if (key.type === 'public') {
      return toArrayBuffer(key._key.toRawBytes(false));
    }
  }

  throw new Error(`Unsupported export format: ${format}`);
}

async function subtleImportKey(format, keyData, algorithm, extractable, keyUsages) {
  const algoName = algorithm.name || algorithm;

  if (algoName === 'AES-GCM') {
    let keyBytes;
    if (format === 'jwk') {
      keyBytes = base64UrlDecode(keyData.k);
    } else if (format === 'raw') {
      keyBytes = new Uint8Array(keyData);
    } else {
      throw new Error(`Unsupported import format for AES-GCM: ${format}`);
    }
    return { type: 'secret', algorithm, extractable, usages: keyUsages, _key: keyBytes };
  }

  if (algoName === 'ECDSA' || algoName === 'ECDH') {
    if (format === 'jwk') {
      if (keyData.d) {
        // Private key
        const d = base64UrlDecode(keyData.d);
        return { type: 'private', algorithm, extractable, usages: keyUsages, _key: d };
      }
      // Public key
      const x = base64UrlDecode(keyData.x);
      const y = base64UrlDecode(keyData.y);
      const raw = new Uint8Array(65);
      raw[0] = 0x04;
      raw.set(x, 1);
      raw.set(y, 33);
      const point = p256.ProjectivePoint.fromHex(raw);
      return { type: 'public', algorithm, extractable, usages: keyUsages, _key: point };
    }
    if (format === 'raw') {
      const raw = new Uint8Array(keyData);
      const point = p256.ProjectivePoint.fromHex(raw);
      return { type: 'public', algorithm, extractable, usages: keyUsages, _key: point };
    }
  }

  throw new Error(`Unsupported import: ${format} / ${algoName}`);
}

async function subtleSign(algorithm, key, data) {
  const algoName = algorithm.name || algorithm;

  if (algoName === 'ECDSA') {
    const hashName = algorithm.hash?.name || algorithm.hash || 'SHA-256';
    if (hashName !== 'SHA-256') throw new Error(`Unsupported hash for ECDSA: ${hashName}`);
    const msgHash = sha256(new Uint8Array(data));
    const sig = p256.sign(msgHash, key._key, { lowS: true });
    // Return IEEE P1363 format (r || s, each 32 bytes)
    const r = sig.r;
    const s = sig.s;
    const rBytes = hexToBytes(r.toString(16).padStart(64, '0'));
    const sBytes = hexToBytes(s.toString(16).padStart(64, '0'));
    const result = new Uint8Array(64);
    result.set(rBytes, 0);
    result.set(sBytes, 32);
    return toArrayBuffer(result);
  }

  throw new Error(`Unsupported algorithm for sign: ${algoName}`);
}

async function subtleVerify(algorithm, key, signature, data) {
  const algoName = algorithm.name || algorithm;

  if (algoName === 'ECDSA') {
    const hashName = algorithm.hash?.name || algorithm.hash || 'SHA-256';
    if (hashName !== 'SHA-256') throw new Error(`Unsupported hash for ECDSA verify: ${hashName}`);
    const msgHash = sha256(new Uint8Array(data));
    const sigBytes = new Uint8Array(signature);
    // Parse IEEE P1363 format (r || s)
    const rHex = bytesToHex(sigBytes.slice(0, 32));
    const sHex = bytesToHex(sigBytes.slice(32, 64));
    const sig = new p256.Signature(BigInt('0x' + rHex), BigInt('0x' + sHex));
    return p256.verify(sig, msgHash, key._key);
  }

  throw new Error(`Unsupported algorithm for verify: ${algoName}`);
}

async function subtleEncrypt(algorithm, key, data) {
  const algoName = algorithm.name || algorithm;

  if (algoName === 'AES-GCM') {
    const iv = new Uint8Array(algorithm.iv);
    const aes = gcm(key._key, iv);
    const plaintext = new Uint8Array(data);
    const ciphertext = aes.encrypt(plaintext);
    return toArrayBuffer(ciphertext);
  }

  throw new Error(`Unsupported algorithm for encrypt: ${algoName}`);
}

async function subtleDecrypt(algorithm, key, data) {
  const algoName = algorithm.name || algorithm;

  if (algoName === 'AES-GCM') {
    const iv = new Uint8Array(algorithm.iv);
    const aes = gcm(key._key, iv);
    const ciphertext = new Uint8Array(data);
    const plaintext = aes.decrypt(ciphertext);
    return toArrayBuffer(plaintext);
  }

  throw new Error(`Unsupported algorithm for decrypt: ${algoName}`);
}

// ─── Hex helpers ─────────────────────────────────────────────────────
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  return bytes;
}

function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

// ─── Setup ───────────────────────────────────────────────────────────

export function setupCryptoPolyfill() {
  if (typeof globalThis.crypto === 'undefined') {
    globalThis.crypto = {};
  }

  globalThis.crypto.getRandomValues = getRandomValues;

  globalThis.crypto.subtle = {
    digest: subtleDigest,
    generateKey: subtleGenerateKey,
    exportKey: subtleExportKey,
    importKey: subtleImportKey,
    sign: subtleSign,
    verify: subtleVerify,
    encrypt: subtleEncrypt,
    decrypt: subtleDecrypt,
  };

  // atob
  if (typeof globalThis.atob === 'undefined') {
    globalThis.atob = (input) => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
      let output = '';
      for (let i = 0; i < input.length; i += 4) {
        const a = chars.indexOf(input[i]);
        const b = i + 1 < input.length ? chars.indexOf(input[i + 1]) : 64;
        const c = i + 2 < input.length ? chars.indexOf(input[i + 2]) : 64;
        const d = i + 3 < input.length ? chars.indexOf(input[i + 3]) : 64;
        const bitmap = (a << 18) | (b << 12) | ((c === 64 ? 0 : c) << 6) | (d === 64 ? 0 : d);
        output += String.fromCharCode((bitmap >> 16) & 255);
        if (c !== 64) output += String.fromCharCode((bitmap >> 8) & 255);
        if (d !== 64) output += String.fromCharCode(bitmap & 255);
      }
      return output;
    };
  }

  // btoa
  if (typeof globalThis.btoa === 'undefined') {
    globalThis.btoa = (input) => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let output = '';
      for (let i = 0; i < input.length; i += 3) {
        const a = input.charCodeAt(i);
        const b = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
        const c = i + 2 < input.length ? input.charCodeAt(i + 2) : 0;
        output += chars[a >> 2];
        output += chars[((a & 3) << 4) | (b >> 4)];
        output += i + 1 < input.length ? chars[((b & 15) << 2) | (c >> 6)] : '=';
        output += i + 2 < input.length ? chars[c & 63] : '=';
      }
      return output;
    };
  }

  // TextEncoder
  if (typeof globalThis.TextEncoder === 'undefined') {
    globalThis.TextEncoder = class TextEncoder {
      encode(str) {
        const buf = [];
        for (let i = 0; i < str.length; i++) {
          let c = str.charCodeAt(i);
          if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
            const next = str.charCodeAt(i + 1);
            if (next >= 0xDC00 && next <= 0xDFFF) {
              c = ((c - 0xD800) << 10) + (next - 0xDC00) + 0x10000;
              i++;
            }
          }
          if (c < 0x80) buf.push(c);
          else if (c < 0x800) { buf.push((c >> 6) | 0xC0); buf.push((c & 0x3F) | 0x80); }
          else if (c < 0x10000) { buf.push((c >> 12) | 0xE0); buf.push(((c >> 6) & 0x3F) | 0x80); buf.push((c & 0x3F) | 0x80); }
          else { buf.push((c >> 18) | 0xF0); buf.push(((c >> 12) & 0x3F) | 0x80); buf.push(((c >> 6) & 0x3F) | 0x80); buf.push((c & 0x3F) | 0x80); }
        }
        return new Uint8Array(buf);
      }
    };
  }

  // TextDecoder
  if (typeof globalThis.TextDecoder === 'undefined') {
    globalThis.TextDecoder = class TextDecoder {
      decode(buf) {
        const bytes = new Uint8Array(buf);
        let str = '';
        let i = 0;
        while (i < bytes.length) {
          const b = bytes[i];
          let cp;
          if (b < 0x80) { cp = b; i++; }
          else if ((b & 0xE0) === 0xC0) { cp = ((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F); i += 2; }
          else if ((b & 0xF0) === 0xE0) { cp = ((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F); i += 3; }
          else if ((b & 0xF8) === 0xF0) { cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F); i += 4; }
          else { cp = 0xFFFD; i++; }
          if (cp <= 0xFFFF) str += String.fromCharCode(cp);
          else { cp -= 0x10000; str += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)); }
        }
        return str;
      }
    };
  }
}
