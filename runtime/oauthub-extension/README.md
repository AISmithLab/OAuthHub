# OAuthHub Chrome Extension Runtime

The OAuthHub runtime for desktop browsers, built as a Chrome extension. Mediates OAuth data access between web apps and service providers.

## Architecture

- **`src/background/`** — Background service worker (runtime engine, token manager, scheduler, Google API GraphQL resolvers, PKCE crypto)
- **`src/popup/`** — Extension popup UI (Dashboard, Consent, Manifests, Logs, Services, Manifest IDE with syntax highlighting and validation)
- **`public/`** — Extension manifest, icons, OAuth callback page

## Build

```bash
npm install
npm run build       # production build → dist/
npm run start       # development build with watch mode
```

Load the built extension from `dist/` in `chrome://extensions` with developer mode enabled.
