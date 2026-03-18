# Website Demo Apps

Next.js web demo applications showing OAuthHub integration in the browser.

Each scenario has a **baseline** app (direct OAuth) and an **OAuthHub** variant that routes data access through the OAuthHub Chrome extension:

| Baseline | OAuthHub | Scenario |
|----------|----------|----------|
| `zoom/` | `zoom-oauthub/` | Zoom accessing Google Calendar meetings |
| `uber-travel/` | `uber-travel-oauthub/`, `uber-oauthub/` | Uber accessing flight dates from Gmail |
| `notability/` | `notability-oauthub/` | Notability backing up notes to Google Drive |
| — | `all/` | Combined demo with all scenarios |

## Setup

```bash
cd <demo-folder>
cp .env.example .env   # configure OAuth credentials
npm install
npm run dev
```

Requires the OAuthHub Chrome extension (`runtime/oauthub-extension`) to be installed for `-oauthub` variants.
