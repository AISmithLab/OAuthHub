export const DEFAULT_VERSION = "zoom-google";
export const OAUTHHUB_PENDING_VERSION_STORAGE_KEY = "oauthhub_demo_suite_pending_version";

export type DemoId = "zoom" | "uber-travel" | "notability";
export type AuthMode = "google" | "oauthhub";
export type DataKind = "events" | "emails" | "files" | "flights";
export const VERSION_IDS = [
  "zoom-google",
  "zoom-oauthhub",
  "uber-travel-google",
  "uber-travel-oauthhub",
  "notability-google",
  "notability-oauthhub",
] as const;
export type VersionId = (typeof VERSION_IDS)[number];
export type GoogleVersionId = Extract<VersionId, `${string}-google`>;
export type OAuthHubVersionId = Extract<VersionId, `${string}-oauthhub`>;

export type CalendarEventItem = {
  summary: string;
  start: string;
  end: string;
};

export type EmailItem = {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body: string;
  labelIds: string[];
};

export type DriveFileItem = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  parents?: string[];
};

export type FlightItem = {
  subject: string;
  snippet: string;
};

export type StoredDemoData = {
  events?: CalendarEventItem[];
  emails?: EmailItem[];
  files?: DriveFileItem[];
  flights?: FlightItem[];
  received_at?: string;
};

type BaseVersionConfig = {
  id: VersionId;
  demoId: DemoId;
  authMode: AuthMode;
  optionLabel: string;
  brandName: string;
  heading: string;
  description: string;
  connectedLabel: string;
  signInLabel: string;
  fetchLabel: string;
  listTitle: string;
  emptyState: string;
  dataKind: DataKind;
  supportsUpload?: boolean;
  backupLabel?: string;
  uploadHint?: string;
};

type GoogleVersionConfig = BaseVersionConfig & {
  authMode: "google";
  googleScopes: string[];
};

type OAuthHubVersionConfig = BaseVersionConfig & {
  authMode: "oauthhub";
  oauthHubProvider: "google_calendar" | "gmail" | "google_drive";
  buildManifest: (origin: string, version: OAuthHubVersionId) => string;
  queryOperation?: "read";
};

export type VersionConfig = GoogleVersionConfig | OAuthHubVersionConfig;

export const versionConfigs: Record<VersionId, VersionConfig> = {
  "zoom-google": {
    id: "zoom-google",
    demoId: "zoom",
    authMode: "google",
    optionLabel: "Zoom x Google OAuth",
    brandName: "Zoom",
    heading: "Calendar Events",
    description: "Read all upcoming events from your primary Google Calendar.",
    connectedLabel: "Connected to Google Calendar",
    signInLabel: "Sign in with Google",
    fetchLabel: "Fetch Calendar Events",
    listTitle: "Upcoming Events",
    emptyState: "No upcoming events found.",
    dataKind: "events",
    googleScopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  },
  "zoom-oauthhub": {
    id: "zoom-oauthhub",
    demoId: "zoom",
    authMode: "oauthhub",
    optionLabel: "Zoom x OAuthHub",
    brandName: "Zoom",
    heading: "Calendar Events",
    description: "Use OAuthHub to filter upcoming calendar events down to Zoom meetings.",
    connectedLabel: "Connected via OAuthHub",
    signInLabel: "Sign in with OAuthHub",
    fetchLabel: "Fetch Calendar Events",
    listTitle: "Upcoming Zoom Events",
    emptyState: "No upcoming Zoom events found.",
    dataKind: "events",
    oauthHubProvider: "google_calendar",
    buildManifest: (origin, version) =>
      [
        "TITLE: Zoom",
        "DESCRIPTION: Get all upcoming Zoom meetings",
        "PIPELINE: PullCalendarEvents->SelectEvents->FilterTime->FilterZoom->PostToBackend",
        "",
        'PullCalendarEvents(type: "Pull", resourceType: "google_calendar", query: "{ events(calendarId) {...EventDetails} }")',
        'SelectEvents(type: "Select", field: "events")',
        'FilterTime(type: "Filter", operation: ">", field: "start.dateTime", targetValue: NOW)',
        'FilterZoom(type: "Filter", operation: "match", field: ["location", "description"], pattern: "zoom\\.us", requirement: "any")',
        `PostToBackend(type: "Post", destination: "${origin}/api/oauthub/data?version=${version}")`,
      ].join("\n"),
  },
  "uber-travel-google": {
    id: "uber-travel-google",
    demoId: "uber-travel",
    authMode: "google",
    optionLabel: "UberTravel x Google OAuth",
    brandName: "UberTravel",
    heading: "Flight Itineraries",
    description: "Read recent Gmail messages and extract flight-related subject and snippet.",
    connectedLabel: "Connected to Gmail",
    signInLabel: "Sign in with Google",
    fetchLabel: "Fetch Emails",
    listTitle: "All Emails (Subject + Snippet)",
    emptyState: "No emails found.",
    dataKind: "flights",
    googleScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  },
  "uber-travel-oauthhub": {
    id: "uber-travel-oauthhub",
    demoId: "uber-travel",
    authMode: "oauthhub",
    optionLabel: "UberTravel x OAuthHub",
    brandName: "UberTravel",
    heading: "Flight Itineraries",
    description: "Use OAuthHub to filter flight-related emails and send only their snippets to the app.",
    connectedLabel: "Connected via OAuthHub",
    signInLabel: "Sign in with OAuthHub",
    fetchLabel: "Scan Emails for Flights",
    listTitle: "Extracted Flights",
    emptyState: "No flight information found in your emails.",
    dataKind: "flights",
    oauthHubProvider: "gmail",
    buildManifest: (origin, version) =>
      [
        "TITLE: Uber",
        "DESCRIPTION: Get only flight-related email snippets",
        "PIPELINE: PullGmail->SelectMessages->FilterFlights->SendToUber",
        "",
        'PullGmail(type: "Pull", resourceType: "gmail", query: "{ messages(userId) { snippet } }")',
        'SelectMessages(type: "Select", field: "messages")',
        'FilterFlights(type: "Filter", operation: "include", field: "snippet", targetValue: "flight")',
        `SendToUber(type: "Post", destination: "${origin}/api/oauthub/data?version=${version}")`,
      ].join("\n"),
  },
  "notability-google": {
    id: "notability-google",
    demoId: "notability",
    authMode: "google",
    optionLabel: "Notability x Google OAuth",
    brandName: "Notability",
    heading: "Drive Backup",
    description: "Upload a file and back it up into your /Notability folder on Google Drive.",
    connectedLabel: "Connected to Google Drive",
    signInLabel: "Sign in with Google",
    fetchLabel: "List Files Under /Notability",
    listTitle: "Files Under /Notability",
    emptyState: "No files found under /Notability.",
    dataKind: "files",
    supportsUpload: true,
    backupLabel: "Backup to /Notability",
    uploadHint: "Choose a note file to back up.",
    googleScopes: ["https://www.googleapis.com/auth/drive"],
  },
  "notability-oauthhub": {
    id: "notability-oauthhub",
    demoId: "notability",
    authMode: "oauthhub",
    optionLabel: "Notability x OAuthHub",
    brandName: "Notability",
    heading: "Drive Backup",
    description: "Upload a file and back it up into your /Notability folder on Google Drive through OAuthHub.",
    connectedLabel: "Connected via OAuthHub",
    signInLabel: "Sign in with OAuthHub",
    fetchLabel: "List Files Under /Notability",
    listTitle: "Files Under /Notability",
    emptyState: "No files found under /Notability.",
    dataKind: "files",
    supportsUpload: true,
    backupLabel: "Backup to /Notability",
    uploadHint: "Choose a note file to back up.",
    oauthHubProvider: "google_drive",
    queryOperation: "read",
    buildManifest: (origin, version) =>
      [
        "TITLE: Notability",
        "DESCRIPTION: Read and write backups in the Notability folder on Google Drive",
        "PIPELINE: ReceiveBackup->FilterFolder->WriteToDrive->PullDriveFiles->SelectFiles->FilterNotabilityFolder->PostToBackend",
        "",
        'ReceiveBackup(type: "Receive", source: "inline")',
        'FilterFolder(type: "Filter", operation: "==", field: "parents", targetValue: "Notability")',
        'WriteToDrive(type: "Write", action: "create", resourceType: "google_drive")',
        'PullDriveFiles(type: "Pull", resourceType: "google_drive", query: "{ files { id name mimeType modifiedTime parents } }")',
        'SelectFiles(type: "Select", field: "files")',
        'FilterNotabilityFolder(type: "Filter", operation: "include", field: "parents", targetValue: "Notability")',
        `PostToBackend(type: "Post", destination: "${origin}/api/oauthub/data?version=${version}")`,
      ].join("\n"),
  },
};

export const versionOptions = VERSION_IDS.map((version) => versionConfigs[version]);

export function getVersionConfig<T extends VersionId>(version: T): (typeof versionConfigs)[T] {
  return versionConfigs[version];
}

export function normalizeQueryValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function isVersionId(value: string): value is VersionId {
  return (VERSION_IDS as readonly string[]).includes(value);
}

export function isGoogleVersion(value: string): value is GoogleVersionId {
  return isVersionId(value) && versionConfigs[value].authMode === "google";
}

export function isOAuthHubVersion(value: string): value is OAuthHubVersionId {
  return isVersionId(value) && versionConfigs[value].authMode === "oauthhub";
}

export function parseVersionParam(
  value: string | string[] | undefined
): VersionId | null;
export function parseVersionParam(
  value: string | string[] | undefined,
  expectedAuthMode: "google"
): GoogleVersionId | null;
export function parseVersionParam(
  value: string | string[] | undefined,
  expectedAuthMode: "oauthhub"
): OAuthHubVersionId | null;
export function parseVersionParam(
  value: string | string[] | undefined,
  expectedAuthMode?: AuthMode
): VersionId | null {
  const normalized = normalizeQueryValue(value);
  if (!normalized || !isVersionId(normalized)) {
    return null;
  }

  if (expectedAuthMode && versionConfigs[normalized].authMode !== expectedAuthMode) {
    return null;
  }

  return normalized;
}

export function makeGoogleState(version: GoogleVersionId): string {
  return `google:${version}`;
}

export function parseGoogleState(value: string | null | undefined): GoogleVersionId | null {
  if (!value?.startsWith("google:")) return null;
  const version = value.slice("google:".length);
  return isGoogleVersion(version) ? version : null;
}

export function getEmptyData(version: VersionId): StoredDemoData {
  switch (versionConfigs[version].dataKind) {
    case "events":
      return { events: [] };
    case "emails":
      return { emails: [] };
    case "files":
      return { files: [] };
    case "flights":
      return { flights: [] };
  }
}
