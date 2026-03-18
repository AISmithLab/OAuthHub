# OAuthHub Client Libraries

Platform-specific client libraries for integrating apps with OAuthHub.

| File | Platform | Transport |
|------|----------|-----------|
| `oauthub-lib.js` | Browser / Chrome extension | Chrome extension messaging (`chrome.runtime.sendMessage`) |
| `oauthub-lib.android.js` | Android / React Native | Localhost HTTP (`127.0.0.1:19876`) and `oauthub://` deep links |

Both libraries expose the same three core APIs:

1. **`generateAuthUrl()`** — Build the authorization URL (starts PKCE flow)
2. **`exchangeToken()`** — Exchange the auth code for an access token
3. **`query()`** — Execute a manifest pipeline against OAuth data

PKCE state (`state` + `codeVerifier`) is managed internally. Apps are responsible for persisting the returned `access_token`.
