# Integrating OAuthHub

This guide explains how to integrate OAuthHub into an existing OAuth app. The integration mainly relies on the three library APIs (`generateAuthUrl`, `exchangeToken`, `query`) and requires moderate code changes (~50 lines added, ~30 removed in our evaluation).

See the demo apps in `android/` and `website/` for complete working examples of each scenario. Each scenario includes a **baseline** (direct OAuth) and an **OAuthHub** variant (suffix `-oauthub`) for side-by-side comparison. Appendix D of the paper provides annotated code diffs.

## Step-by-Step Integration

### Step 1: Include the client library

Copy `lib/oauthub-lib.js` (browser) or `lib/oauthub-lib.android.js` (React Native) into your project. The library manages PKCE state, URL construction, token exchange, and signature verification, so developers do not need to implement OAuth protocols directly.

### Step 2: Write a manifest

Write a text-based manifest declaring what data your app needs as a pipeline of operators. This replaces direct service provider API calls with a declarative specification that the OAuthHub runtime can parse, display to users as a permission prompt, and execute locally.

**Common operators:**

| Operator | Purpose |
|----------|---------|
| `Pull` | Fetch data from a service provider via GraphQL query |
| `Select` | Extract a specific field from the response |
| `Filter` | Keep only items matching a condition |
| `Extract` | Pull out specific patterns (e.g., dates from text) |
| `Post` | Send processed results to your backend |
| `Write` | Create or update a resource on the service provider |
| `Receive` | Accept incoming data from an app |

### Step 3: Add a new login option in the frontend

Add a "Sign in with OAuthHub" button alongside existing login options (e.g., "Sign in with Google"). When clicked, call `generateAuthUrl()` with the manifest, provider, redirect URL, and access type to build the authorization URL and redirect the user to the OAuthHub runtime's local authorization page. This is the entry point for users to review the manifest and grant fine-grained permissions.

### Step 4: Handle the callback

On the callback page, call `exchangeToken()` with the authorization code and state from the URL parameters. The library verifies the PKCE state internally to prevent CSRF attacks. Extract the hub identity parameters (`oauthub_public_key`, `oauthub_user_sub`) from the callback URL and persist them on your server — these are needed later for verifying signed payloads.

### Step 5: Replace data fetching with `query()`

Instead of calling service provider APIs directly (e.g., Google Calendar API), call `query()` with the access token and manifest. The OAuthHub runtime executes the manifest pipeline locally on the user's device, filters the data, and delivers only the processed results to your API endpoint specified in the manifest's `Post` operator. The token is rotated on each call — store the returned token for subsequent requests.

### Step 6: Register an API endpoint for receiving data

Set up a public-facing API endpoint (e.g., `/api/oauthub/data`) to receive the filtered data from the OAuthHub runtime. Since the runtime connects from the user's device (which may have any IP address), developers must implement **rate limiting and robust DDoS protection** to validate payloads from random IP addresses. In practice, common cloud endpoints (e.g., AWS, Vercel) provide built-in DDoS protection and rate limiting. OAuthHub also signs all payloads, so use `verifySignedPayload()` with the stored public key to verify authenticity and integrity before processing the data.

### Step 7: Handle offline devices (for scheduled access)

For `scheduled_time` access, the user's device may be offline when data is due. The OAuthHub runtime automatically defers the request and executes it when the device comes back online. Your API endpoint should handle payloads arriving at any time. For `user_driven` and `install_time` access, the device is already online when the user triggers the action, so no special handling is needed.

## Access Types

| Type | When data is accessed |
|------|----------------------|
| `install_time` | Once during registration, linking, or account setup |
| `user_driven` | When the user actively triggers it in the app |
| `scheduled_time` | Periodically on a developer-declared schedule |

## Examples

| Scenario | Manifest operators | Demo apps |
|----------|-------------------|-----------|
| Zoom reads Google Calendar meetings | Pull, Select, Filter (time), Filter (Zoom links), Post | `website/zoom-oauthub/`, `android/zoom-oauthub/` |
| Uber extracts flight dates from Gmail | Pull, Select, Filter (flight keywords), Extract (dates), Post | `website/uber-travel-oauthub/`, `android/uber-travel-oauthub/` |
| Notability backs up notes to Google Drive | Receive, Filter (folder path), Write | `website/notability-oauthub/`, `android/notability-oauthub/` |
