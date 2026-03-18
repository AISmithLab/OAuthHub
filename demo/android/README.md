# Android Demo Apps

React Native demo applications showing OAuthHub integration on Android.

Each scenario has a **baseline** app (direct OAuth) and an **OAuthHub** variant that routes data access through the OAuthHub runtime:

| Baseline | OAuthHub | Scenario |
|----------|----------|----------|
| `zoom/` | `zoom-oauthub/` | Zoom accessing Google Calendar meetings |
| `uber-travel/` | `uber-travel-oauthub/` | Uber accessing flight dates from Gmail |
| `notability/` | `notability-oauthub/` | Notability backing up notes to Google Drive |
| — | `all/` | Combined demo with all scenarios |

## Setup

```bash
cd <demo-folder>
npm install
npx expo run:android
```

Requires the OAuthHub Android runtime (`runtime/oauthub-android`) to be running on the same device for `-oauthub` variants.
