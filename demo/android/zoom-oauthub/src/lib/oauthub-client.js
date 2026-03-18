// Re-export the Android client library.
// Ensures crypto polyfill is loaded before the lib needs it.
const { setupCryptoPolyfill } = require('../platform/crypto-polyfill');
setupCryptoPolyfill();

module.exports = require('./oauthub-lib.android');
