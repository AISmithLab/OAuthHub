// Crypto polyfill MUST run before any module that uses crypto.
// Using require() (not import) so polyfill executes before App is loaded.
const { setupCryptoPolyfill } = require('./src/platform/crypto-polyfill');
setupCryptoPolyfill();

const { registerRootComponent } = require('expo');
const { default: App } = require('./App');

registerRootComponent(App);
