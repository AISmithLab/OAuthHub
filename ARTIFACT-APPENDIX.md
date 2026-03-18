# Artifact Appendix

Paper title: OAuthHub: Mitigating OAuth Data Overaccess through a Local Data Hub

Requested Badge(s):
  - [x] **Available**
  - [x] **Functional**
  - [ ] **Reproduced**

## Description

**Paper:** OAuthHub: Mitigating OAuth Data Overaccess through a Local Data Hub. 

Authors: Qiyu Li, Yuhe Tian, Haojian Jin (UC San Diego). 

Proceedings on Privacy Enhancing Technologies (PoPETs) 2026.

This artifact contains the full implementation of OAuthHub, a development framework that uses personal devices as local data hubs to mediate OAuth-based data sharing between third-party apps and service providers. The artifact includes:

- **Client libraries** (`lib/`) for website and Android developers to integrate OAuthHub
- **OAuthHub runtimes** (`runtime/`) — a Chrome extension for PCs and a React Native app for Android
- **Demo applications** (`demo/`) — three real-world scenarios (Zoom, Uber Travel, Notability) implemented as both baseline (conventional OAuth) and OAuthHub variants, on both web and Android platforms

The artifact demonstrates the core claims of the paper: that OAuthHub enables fine-grained, manifest-based OAuth data access with moderate code changes, and that the framework works on both PC and mobile platforms.

### Security/Privacy Issues and Ethical Concerns

This artifact does not disable any security mechanisms or run vulnerable code. All OAuth credentials (e.g., access tokens) are stored on the reviewer's local device for OAuthHub demos, or on the PoPETs VM for baseline demos — they are not transmitted to any third party beyond the Google API.

To avoid revealing the reviewer's identity through OAuth profile information and to protect reviewers' personal data privacy, we provide dedicated test Google accounts with simulated data (see [Testing the Environment](#testing-the-environment)). Reviewers do not need to use their personal Google accounts.

## Basic Requirements

### Hardware Requirements

Can run on a laptop (no special hardware requirements). An Android device or emulator is needed to test the Android runtime and demo apps.

### Software Requirements

- **OS:** macOS, Linux, or Windows. Tested on macOS 14 and Ubuntu 22.04.
- **Node.js:** v18+ (for building runtimes and running website demos)
- **npm:** v9+ (included with Node.js)
- **Google Chrome:** Latest version (for the Chrome extension runtime)
- **Android Studio** (optional, for Android runtime/demos): Arctic Fox or later, with Android SDK 33+
- **Expo CLI** (optional, for Android runtime/demos): installed via `npx expo`

All JavaScript dependencies are listed in `package.json` files and installed via `npm install`.

### Estimated Time and Storage Consumption

- **Using the deployed instance (recommended):** 5 human-minutes to build and install the Chrome extension + 15-20 human-minutes to walk through all demo scenarios. ~200MB disk space for the extension build.
- **Building from source:** 20-30 human-minutes for setup + build. ~500MB disk space (primarily node_modules).

## Environment

### Accessibility

The artifact is available at: https://github.com/AISmithLab/OAuthHub

We also deploy the website demo application on a PoPETs VM. The URL and credentials are provided to reviewers via HotCRP.

### Set up the environment

#### Step 1: Build and install the Chrome extension (required)

The OAuthHub Chrome extension runs locally in the reviewer's browser and is required for all demo scenarios. It ships with a pre-configured Google OAuth client ID — no additional credentials are needed.

```bash
git clone https://github.com/AISmithLab/OAuthHub.git
cd OAuthHub/runtime/oauthub-extension
npm install
npm run build
```

Then load the extension in Chrome:
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `runtime/oauthub-extension/dist` directory

#### Step 2a: Use the deployed website demo (recommended)

The deployed instance hosts the website demo (`demo/website/all`) with all three scenarios (Zoom, Uber Travel, Notability) pre-configured.

1. Visit the deployed instance URL and log in with the credentials provided via HotCRP
2. Log in with the provided test Google account (see [Test accounts](#test-accounts))

#### Step 2b: Build the website demo from source (alternative)

Website demos require Google OAuth credentials. We provide `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` via HotCRP. Create a `.env` file from the provided template and fill in the credentials:

```bash
cd demo/website/all
cp .env.example .env
# Edit .env and fill in the provided credentials:
#   GOOGLE_CLIENT_ID=<provided via HotCRP>
#   GOOGLE_CLIENT_SECRET=<provided via HotCRP>
npm install
npm run dev
```

#### Step 2c: Build the Android runtime and demo (optional)

The Android runtime and demo apps are not deployed — they must be built locally. Both require a Google OAuth client ID. Use the **web client ID (not the Android one)** provided via HotCRP — the same `GOOGLE_CLIENT_ID` used for the website demo.

**Build the runtime:**
```bash
cd runtime/oauthub-android
cp .env.example .env
# Edit .env and fill in:
#   GOOGLE_OAUTH_CLIENT_ID=<use the web CLIENT_ID provided via HotCRP>
npm install
npx expo prebuild
npx expo run:android
```

**Build the demo app:**
```bash
cd demo/android/all
cp .env.example .env
# Edit .env and fill in:
#   GOOGLE_OAUTH_CLIENT_ID=<use the web CLIENT_ID provided via HotCRP>
npm install
npx expo prebuild
npx expo run:android
```

The runtime must be running on the device before launching the demo app.

### Testing the Environment

Verify the Chrome extension is installed correctly:

**Chrome extension (required):**
1. Open `chrome://extensions` and confirm "OAuthHub" is listed and enabled
2. Click the OAuthHub extension icon in the toolbar — the popup should display a dashboard with manifest and log panels

**Website demo:**
3. Visit the deployed instance URL and confirm the page loads successfully

**Android (optional, if built):**
4. Open the OAuthHub runtime app on the device/emulator and confirm the dashboard screen loads
5. Open the demo app and confirm it launches with a "Sign in with OAuthHub" button

If the above checks pass, the environment is ready for evaluation.

## Artifact Evaluation

### Main Results and Claims

#### Claim 1: OAuthHub enables fine-grained OAuth data access

OAuthHub's manifest-based pipeline allows developers to declare exactly what data their app needs. The runtime executes the pipeline locally and delivers only filtered results. This is demonstrated by the three demo scenarios where apps receive only the specific data they need (Zoom meeting events, flight dates, folder-restricted file uploads) instead of full API responses. Refer to Section 7 (Case Studies) and Figure 6 in the paper.

#### Claim 2: OAuthHub works on both PC and Android

The artifact includes working runtimes for Chrome (PC) and Android, demonstrating cross-platform support. Both runtimes execute the same manifest pipelines. Refer to Section 8 (Implementation) in the paper.

### Experiments: Functional validation of manifest-based data filtering

- Time: 15-20 human-minutes
- Storage: negligible (using deployed instance)

This experiment validates that OAuthHub correctly filters OAuth data according to the declared manifest, corresponding to the case studies in Section 7 of the paper.

**Test accounts:** To protect reviewers' privacy, we provide test Google accounts pre-loaded with simulated data. All personal data in these accounts (emails, calendar events, Google Drive files) is generated by LLMs given fictional personas — no real user data is included. Test account credentials are available on the deployed instance's landing page after login.

**Steps:**

1. Log in to the deployed instance with the credentials provided via HotCRP
2. Log in with the provided test Google account
3. The combined demo app presents all three scenarios (Zoom, Uber Travel, Notability). For each scenario, you can switch between **Google OAuth** (baseline) and **OAuthHub** to compare

**Zoom scenario:**
1. Select the **Zoom** scenario
2. First, try **Google OAuth**: click "Sign in with Google" — the app receives all calendar events directly from Google
3. Then switch to **OAuthHub**: click "Sign in with OAuthHub" — this redirects to the OAuthHub extension's local authorization page
4. The extension displays the manifest: what data Zoom requests (Google Calendar events) and how it will be filtered (upcoming events containing Zoom links)
5. Click **"Allow"** — the extension authenticates with Google, retrieves calendar events, filters them locally, and sends only Zoom-related events to the app
6. Click **"Fetch Calendar Events"** — compare: OAuthHub returns only upcoming Zoom meetings, while the baseline returned all events

**Uber Travel scenario:**
1. Select the **Uber Travel** scenario
2. Try **Google OAuth** first — the app receives all email messages
3. Switch to **OAuthHub** — review the manifest: Uber requests Gmail messages, filtered for flight-related content, with date extraction
4. Click **"Allow"** — only flight date information is delivered, not full email content
5. Compare: OAuthHub returns only extracted flight dates, while the baseline returned all emails

**Notability scenario:**
1. Select the **Notability** scenario
2. Try **Google OAuth** first — the app has full Google Drive access
3. Switch to **OAuthHub** — review the manifest: Notability requests to write files to Google Drive, filtered to a specific folder
4. Click **"Allow"** — the upload is restricted to the declared folder path
5. Compare: OAuthHub restricts access to the declared folder, while the baseline had full Drive access

**Expected results:** For each scenario, the Google OAuth baseline returns full, unfiltered API responses, while the OAuthHub version returns only the data declared in the manifest.

## Limitations

To protect the authors' privacy, the test accounts contain LLM-generated data (emails, calendar events, files) based on personas rather than the original personal data used during evaluation, which may yield different data reduction rates as reported in the paper.

System performance (Section 9.5) depends on the specific device and network conditions. Reviewers may observe different absolute values, though the relative overhead should be comparable.

## Notes on Reusability

OAuthHub is designed as a general-purpose framework for any OAuth-based application. Developers can reuse the artifact in several ways:

- **Client libraries** (`lib/oauthub-lib.js`, `lib/oauthub-lib.android.js`) can be integrated into any website or Android app that uses Google OAuth (or other OAuth providers, with runtime extensions).
- **Manifest language** can be adapted to new data access scenarios by composing the available operators (Pull, Select, Filter, Extract, Post, Write, Receive, etc.) into new pipelines.
- **OAuthHub runtimes** can be extended to support additional OAuth service providers beyond Google by implementing new GraphQL resolvers in the background service.
- **Demo apps** serve as reference implementations that developers can use as starting points for their own OAuthHub integrations.