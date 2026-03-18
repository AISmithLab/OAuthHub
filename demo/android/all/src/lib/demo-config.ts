export const DEFAULT_VERSION = 'zoom-google';
export const PENDING_VERSION_DB_KEY = 'oauthhub_demo_pending_version';

export type DemoId = 'zoom' | 'uber-travel' | 'notability';
export type AuthMode = 'google' | 'oauthhub';
export type DataKind = 'events' | 'files' | 'flights';

export const VERSION_IDS = [
  'zoom-google',
  'zoom-oauthhub',
  'uber-travel-google',
  'uber-travel-oauthhub',
  'notability-google',
  'notability-oauthhub',
] as const;

export type VersionId = (typeof VERSION_IDS)[number];
export type GoogleVersionId = Extract<VersionId, `${string}-google`>;
export type OAuthHubVersionId = Extract<VersionId, `${string}-oauthhub`>;

export type CalendarEventItem = {
  summary: string;
  start: { dateTime?: string; date?: string } | string;
  end: { dateTime?: string; date?: string } | string;
  location?: string;
  description?: string;
  attendees?: { email: string }[];
  organizer?: { email: string; displayName?: string };
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
  files?: DriveFileItem[];
  flights?: FlightItem[];
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
};

type GoogleVersionConfig = BaseVersionConfig & {
  authMode: 'google';
  googleScopes: string[];
};

type OAuthHubVersionConfig = BaseVersionConfig & {
  authMode: 'oauthhub';
  oauthHubProvider: 'google_calendar' | 'gmail' | 'google_drive';
  buildManifest: () => string;
  queryOperation?: 'read';
};

export type VersionConfig = GoogleVersionConfig | OAuthHubVersionConfig;

export const versionConfigs: Record<VersionId, VersionConfig> = {
  'zoom-google': {
    id: 'zoom-google',
    demoId: 'zoom',
    authMode: 'google',
    optionLabel: 'Zoom × Google OAuth',
    brandName: 'Zoom',
    heading: 'Calendar Events',
    description: 'Read all upcoming events from your primary Google Calendar.',
    connectedLabel: 'Connected to Google Calendar',
    signInLabel: 'Sign in with Google',
    fetchLabel: 'Fetch Calendar Events',
    listTitle: 'All Upcoming Events',
    emptyState: 'No upcoming events found.',
    dataKind: 'events',
    googleScopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
  },
  'zoom-oauthhub': {
    id: 'zoom-oauthhub',
    demoId: 'zoom',
    authMode: 'oauthhub',
    optionLabel: 'Zoom × OAuthHub',
    brandName: 'Zoom',
    heading: 'Calendar Events',
    description: 'Use OAuthHub to filter upcoming calendar events down to Zoom meetings.',
    connectedLabel: 'Connected via OAuthHub',
    signInLabel: 'Sign in with OAuthHub',
    fetchLabel: 'Fetch Calendar Events',
    listTitle: 'Upcoming Zoom Meetings',
    emptyState: 'No upcoming Zoom meetings found.',
    dataKind: 'events',
    oauthHubProvider: 'google_calendar',
    buildManifest: () =>
      [
        'TITLE: Zoom',
        'DESCRIPTION: Get all upcoming Zoom meetings',
        'PIPELINE: PullCalendarEvents->SelectEvents->FilterTime->FilterZoom',
        '',
        'PullCalendarEvents(type: "Pull", resourceType: "google_calendar", query: "{ events(calendarId) {...EventDetails} }")',
        'SelectEvents(type: "Select", field: "events")',
        'FilterTime(type: "Filter", operation: ">", field: "start.dateTime", targetValue: NOW)',
        'FilterZoom(type: "Filter", operation: "match", field: ["location", "description"], pattern: "zoom\\.us", requirement: "any")',
      ].join('\n'),
  },
  'uber-travel-google': {
    id: 'uber-travel-google',
    demoId: 'uber-travel',
    authMode: 'google',
    optionLabel: 'UberTravel × Google OAuth',
    brandName: 'UberTravel',
    heading: 'Flight Itineraries',
    description: 'Extract flight information from your emails to plan rides upon arrival.',
    connectedLabel: 'Connected to Gmail',
    signInLabel: 'Sign in with Google',
    fetchLabel: 'Scan Emails',
    listTitle: 'All Emails',
    emptyState: 'No emails found.',
    dataKind: 'flights',
    googleScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  },
  'uber-travel-oauthhub': {
    id: 'uber-travel-oauthhub',
    demoId: 'uber-travel',
    authMode: 'oauthhub',
    optionLabel: 'UberTravel × OAuthHub',
    brandName: 'UberTravel',
    heading: 'Flight Itineraries',
    description: 'Use OAuthHub to filter flight-related emails and send only their snippets.',
    connectedLabel: 'Connected via OAuthHub',
    signInLabel: 'Sign in with OAuthHub',
    fetchLabel: 'Scan Emails for Flights',
    listTitle: 'Extracted Flights',
    emptyState: 'No flight information found in your emails.',
    dataKind: 'flights',
    oauthHubProvider: 'gmail',
    buildManifest: () =>
      [
        'TITLE: Uber',
        'DESCRIPTION: Get only flight-related email snippets',
        'PIPELINE: PullGmail->SelectMessages->FilterFlights',
        '',
        'PullGmail(type: "Pull", resourceType: "gmail", query: "{ messages(userId) { snippet } }")',
        'SelectMessages(type: "Select", field: "messages")',
        'FilterFlights(type: "Filter", operation: "include", field: "snippet", targetValue: "flight")',
      ].join('\n'),
  },
  'notability-google': {
    id: 'notability-google',
    demoId: 'notability',
    authMode: 'google',
    optionLabel: 'Notability × Google OAuth',
    brandName: 'Notability',
    heading: 'Drive Backup',
    description: 'Upload a file to Google Drive. This baseline app has full access to your entire Drive.',
    connectedLabel: 'Connected to Google Drive',
    signInLabel: 'Sign in with Google',
    fetchLabel: 'List All Drive Files',
    listTitle: 'All Drive Files',
    emptyState: 'No files found.',
    dataKind: 'files',
    supportsUpload: true,
    backupLabel: 'Backup to Drive',
    googleScopes: ['https://www.googleapis.com/auth/drive'],
  },
  'notability-oauthhub': {
    id: 'notability-oauthhub',
    demoId: 'notability',
    authMode: 'oauthhub',
    optionLabel: 'Notability × OAuthHub',
    brandName: 'Notability',
    heading: 'Drive Backup',
    description: 'Upload a file and back it up into your /Notability folder on Google Drive through OAuthHub.',
    connectedLabel: 'Connected via OAuthHub',
    signInLabel: 'Sign in with OAuthHub',
    fetchLabel: 'List Files Under /Notability',
    listTitle: 'Files Under /Notability',
    emptyState: 'No files found under /Notability.',
    dataKind: 'files',
    supportsUpload: true,
    backupLabel: 'Backup to /Notability',
    oauthHubProvider: 'google_drive',
    queryOperation: 'read',
    buildManifest: () =>
      [
        'TITLE: Notability',
        'DESCRIPTION: Read and write backups in the Notability folder on Google Drive',
        'PIPELINE: ReceiveBackup->FilterFolder->WriteToDrive->PullDriveFiles->SelectFiles->FilterNotabilityFolder',
        '',
        'ReceiveBackup(type: "Receive", source: "inline")',
        'FilterFolder(type: "Filter", operation: "==", field: "parents", targetValue: "Notability")',
        'WriteToDrive(type: "Write", action: "create", resourceType: "google_drive")',
        'PullDriveFiles(type: "Pull", resourceType: "google_drive", query: "{ files { id name mimeType modifiedTime parents } }")',
        'SelectFiles(type: "Select", field: "files")',
        'FilterNotabilityFolder(type: "Filter", operation: "include", field: "parents", targetValue: "Notability")',
      ].join('\n'),
  },
};

export const APP_OPTIONS: Array<{ id: DemoId; label: string }> = [
  { id: 'zoom', label: 'Zoom' },
  { id: 'uber-travel', label: 'UberTravel' },
  { id: 'notability', label: 'Notability' },
];

export function getVersionConfig(version: VersionId): VersionConfig {
  return versionConfigs[version];
}

export function getVersionForApp(demoId: DemoId, authMode: AuthMode): VersionId {
  switch (demoId) {
    case 'zoom':
      return authMode === 'google' ? 'zoom-google' : 'zoom-oauthhub';
    case 'uber-travel':
      return authMode === 'google' ? 'uber-travel-google' : 'uber-travel-oauthhub';
    case 'notability':
      return authMode === 'google' ? 'notability-google' : 'notability-oauthhub';
  }
}

export function getEmptyData(version: VersionId): StoredDemoData {
  switch (versionConfigs[version].dataKind) {
    case 'events':
      return { events: [] };
    case 'files':
      return { files: [] };
    case 'flights':
      return { flights: [] };
  }
}
