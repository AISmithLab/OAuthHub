/**
 * Lightweight crypto polyfill for Hermes engine.
 * Uses expo-crypto for getRandomValues and SHA-256.
 */
const ExpoCrypto = require('expo-crypto');

function setupCryptoPolyfill() {
  // getRandomValues via expo-crypto
  if (typeof globalThis.crypto === 'undefined') {
    globalThis.crypto = {};
  }
  if (!globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues = function (buf) {
      const bytes = ExpoCrypto.getRandomBytes(buf.length);
      buf.set(new Uint8Array(bytes));
      return buf;
    };
  }

  // Minimal crypto.subtle with SHA-256 digest (needed by oauthub-lib.android.js PKCE)
  if (!globalThis.crypto.subtle) {
    globalThis.crypto.subtle = {
      digest: async function (algorithm, data) {
        const algoName = typeof algorithm === 'string' ? algorithm : algorithm.name;
        if (algoName !== 'SHA-256') {
          throw new Error('Only SHA-256 is supported in this polyfill');
        }
        const bytes = new Uint8Array(data);
        let str = '';
        for (let i = 0; i < bytes.length; i++) {
          str += String.fromCharCode(bytes[i]);
        }
        const hexHash = await ExpoCrypto.digestStringAsync(
          ExpoCrypto.CryptoDigestAlgorithm.SHA256,
          str,
          { encoding: ExpoCrypto.CryptoEncoding.HEX }
        );
        const hashBytes = new Uint8Array(hexHash.length / 2);
        for (let i = 0; i < hexHash.length; i += 2) {
          hashBytes[i / 2] = parseInt(hexHash.substr(i, 2), 16);
        }
        return hashBytes.buffer;
      },
    };
  }

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

module.exports = { setupCryptoPolyfill };
