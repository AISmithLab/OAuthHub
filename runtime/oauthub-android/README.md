# OAuthHub Android Runtime

The OAuthHub runtime for Android devices, built with React Native. Runs as a background service on the user's phone to mediate OAuth data access between apps and service providers.

## Architecture

- **`src/core/`** — Runtime engine, manifest parser, PKCE crypto
- **`src/ipc/`** — Inter-process communication (localhost HTTP server, deep link handler, message handler)
- **`src/platform/`** — Platform-specific modules (storage, scheduler, token manager, crypto polyfill)
- **`src/screens/`** — UI screens (Dashboard, Consent, Manifests, Logs, Services)
- **`src/navigation/`** — React Navigation setup
- **`modules/expo-http-server/`** — Native module for the local HTTP server

## Setup

```bash
npm install
npx expo prebuild
npx expo run:android
```

The runtime listens on `127.0.0.1:19876` and handles `oauthub://` deep links for communication with demo apps.
