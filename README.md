## OAuthHub

OAuthHub is a development framework that uses personal devices (smartphones, PCs) as local data hubs to mediate data sharing between third-party apps (e.g., Zoom, Uber) and OAuth service providers (e.g., Google). Instead of granting apps direct access to a service provider's API, OAuthHub retrieves data from the service provider through OAuth, processes it locally on the user's device, and delivers only the filtered results to the app.

![OAuthHub Architecture](assets/OAuthHub.png)

Developers specify their data access as a **manifest** — a text-based pipeline of stateless operators (Pull, Select, Filter, Extract, Post, etc.), each performing a specific type of transformation. The local OAuthHub runtime parses the manifest to generate permission prompts for the user and executes the pipeline locally using pre-loaded operator implementations. In this way, users can inspect how their data will be processed before granting access, making them more likely to grant access through OAuthHub compared to conventional OAuth.

### Why OAuthHub?

Most OAuth apps request more data access than they need. For example, Uber only needs flight dates from Gmail, but must request access to all emails. Overly aggressive permissions can trigger denials and damage an app's reputation. OAuthHub helps developers earn user trust by declaring exactly what data their app needs through a manifest, instead of requesting broad OAuth scopes.

### Quick Examples

#### Zoom accesses Google Calendar to get all upcoming Zoom meetings
```js
PIPELINE: CalendarEvents -> SelectEvents -> FilterTime -> FilterZoom -> PostToZoom
CalendarEvents(type: "Pull", resourceType: "google_calendar", query: "{ events(calendarId) {...} }")
SelectEvents(type: "Select", field: "events")
FilterTime(type: "Filter", operation: ">", field: "start.dateTime", targetValue: NOW)
FilterZoom(type: "Filter", operation: "match", field: ["location", "description"], pattern: "Zoom URL", requirement: "any")
PostToZoom(type: "Post", destination: "www.zoom.us")
```

#### Uber gets only flight related dates from Gmail
```js
PIPELINE: Gmail -> SelectMessage -> FilterFlights -> ExtractDate -> SendToUber
Gmail(type: "Pull", resourceType: "gmail", query: "{message(userId){snippet}}")
SelectMessage(type: "Select", field: "messages")
FilterFlights(type: "Filter", operation: "include", field: ["snippet"], targetValue: "flight")
ExtractDate(type: "Extract", operation: "match", field: ["snippet"] ,pattern: "Datetime")
SendToUber(type: "Post", destination: "https:api.uber.com/v1/")
```

#### Notability backups notes to Google Drive
```js
PIPELINE: ReceiveRequest -> FilterPath -> Upload
ReceiveRequest(type: "Receive", source: "www.notability.com")
FilterPath(type: "Filter", operation: "match", field: ["parents"], targetValue: "folderId")
Upload(type: "Write", action: "create", resourceType: "google_drive")
```

### Installation

#### Chrome Extension
1. Run ``npm install && npm run build`` in ``runtime/oauthub-extension``.
2. Open ``chrome://extensions`` and enable developer mode.
3. Load the unpacked extension from ``runtime/oauthub-extension/dist``.

#### Android
1. Run ``npm install`` in ``runtime/oauthub-android``.
2. Run ``npx expo prebuild`` to generate the native project.
3. Run ``npx expo run:android`` to build and launch on a connected device or emulator.

### Developer Documentation

We provide client libraries for both website and Android developers to help integrate OAuthHub. See [demo/README.md](demo/README.md) for a step-by-step integration guide.

#### OAuthHub Client APIs
```js
// (1) Generate authorization URL (PKCE flow)
const authUrl = await OAuthHubClient.generateAuthUrl({
    provider: "google_calendar",   // OAuth service provider
    manifest: manifest,            // fine-grained data access manifest
    redirect: redirect_url,        // callback URL after authorization
    accessType: "user_driven",     // "user_driven" | "install_time" | "scheduled_time"
    schedule: schedule_spec        // optional, for "scheduled_time"
});
window.location.href = authUrl;

// (2) Exchange authorization code for access token
const { access_token } = await OAuthHubClient.exchangeToken({
    code: auth_code,               // authorization code from callback URL
    state: state_param             // state parameter from callback (CSRF check)
});

// (3) Execute manifest pipeline through OAuthHub
const result = await OAuthHubClient.query({
    token: access_token,           // access token from step 2 (rotated each call)
    manifest: manifest,            // data access manifest
    operation: "read",             // "read" (default) or "write"
    data: payload                  // optional, for write operations
});
```

#### Signature Verification
```js
// Verify a signed payload from the OAuthHub runtime
const { body, signature } = await OAuthHubClient.verifySignedPayload({
    headers: request.headers,      // request headers
    rawBody: raw_body_string,      // raw request body
    publicKeyJwk: public_key       // JWK public key (from OAuth redirect)
});
```

### Project Structure

```
OAuthHub/
├── lib/                        # Client libraries
│   ├── oauthub-lib.js          #   Browser / Chrome extension client
│   └── oauthub-lib.android.js  #   Android / React Native client
├── demo/                       # Demo applications
│   ├── android/                #   React Native demos
│   │   ├── zoom/               #     Zoom baseline
│   │   ├── zoom-oauthub/       #     Zoom + OAuthHub
│   │   ├── uber-travel/        #     Uber Travel baseline
│   │   ├── uber-travel-oauthub/#     Uber Travel + OAuthHub
│   │   ├── notability/         #     Notability baseline
│   │   ├── notability-oauthub/ #     Notability + OAuthHub
│   │   └── all/                #     Combined demo (all scenarios)
│   └── website/                #   Next.js web demos
│       ├── zoom/               #     Zoom baseline
│       ├── zoom-oauthub/       #     Zoom + OAuthHub
│       ├── uber-travel/        #     Uber Travel baseline
│       ├── uber-travel-oauthub/#     Uber Travel + OAuthHub
│       ├── uber-oauthub/       #     Uber + OAuthHub
│       ├── notability/         #     Notability baseline
│       ├── notability-oauthub/ #     Notability + OAuthHub
│       └── all/                #     Combined demo (all scenarios)
└── runtime/                    # OAuthHub runtime environments
    ├── oauthub-extension/      #   Chrome extension runtime
    └── oauthub-android/        #   Android runtime
```
