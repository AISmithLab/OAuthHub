import { Readable } from "node:stream";
import type { Credentials } from "google-auth-library";
import { google } from "googleapis";
import { db } from "~/server/db";
import oauth2Client from "~/server/googleAuthClient";
import type {
  DriveFileItem,
  EmailItem,
  FlightItem,
  GoogleVersionId,
  StoredDemoData,
} from "~/lib/demo-config";
import { googleTokensPath } from "~/server/storage";

type GmailMessagePart = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailMessagePart[] | null;
};

const NOTABILITY_FOLDER_NAME = "Notability";
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

function decodeBase64Url(value: string | null | undefined): string {
  if (!value) return "";

  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function extractGmailBody(payload: GmailMessagePart | null | undefined): string {
  if (!payload) return "";

  const parts = Array.isArray(payload.parts) ? payload.parts : [];

  for (const part of parts) {
    const mimeType = part?.mimeType ?? "";
    if (mimeType.startsWith("text/plain") && part?.body?.data) {
      return decodeBase64Url(part.body.data);
    }
  }

  for (const part of parts) {
    const nestedBody = extractGmailBody(part);
    if (nestedBody) return nestedBody;
  }

  return decodeBase64Url(payload.body?.data);
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function loadGoogleCredentials(version: GoogleVersionId): Promise<void> {
  const tokens = await db.getData(googleTokensPath(version)) as Credentials;
  oauth2Client.setCredentials(tokens);
}

async function fetchZoomEvents(): Promise<StoredDemoData> {
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  const timeMin = new Date().toISOString();
  const events: NonNullable<StoredDemoData["events"]> = [];
  let pageToken: string | undefined;

  do {
    const { data } = await calendar.events.list({
      calendarId: "primary",
      timeMin,
      singleEvents: true,
      orderBy: "startTime",
      pageToken,
    });

    events.push(
      ...(data.items ?? []).map((event) => ({
        summary: event.summary ?? "(No title)",
        start: event.start?.dateTime ?? event.start?.date ?? "",
        end: event.end?.dateTime ?? event.end?.date ?? "",
      }))
    );

    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);

  return { events, received_at: new Date().toISOString() };
}

async function fetchUberTravelEmails(): Promise<StoredDemoData> {
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const { data: listData } = await gmail.users.messages.list({
    userId: "me",
    maxResults: 100,
  });

  const messages = listData.messages ?? [];
  const flights: FlightItem[] = [];

  for (const message of messages) {
    if (!message.id) continue;

    const { data: detail } = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
      format: "metadata",
      metadataHeaders: ["Subject"],
    });

    const subject = detail.payload?.headers?.find(
      (h) => h.name === "Subject"
    )?.value ?? "(No subject)";

    flights.push({
      subject,
      snippet: detail.snippet ?? "",
    });
  }

  return { flights, received_at: new Date().toISOString() };
}

async function findNotabilityFolderId(
  drive: ReturnType<typeof google.drive>
): Promise<string | null> {
  const { data } = await drive.files.list({
    q: [
      `name = '${escapeDriveQueryValue(NOTABILITY_FOLDER_NAME)}'`,
      `mimeType = '${DRIVE_FOLDER_MIME}'`,
      "trashed = false",
      "'root' in parents",
    ].join(" and "),
    fields: "files(id)",
    pageSize: 1,
  });

  return data.files?.[0]?.id ?? null;
}

async function ensureNotabilityFolderId(
  drive: ReturnType<typeof google.drive>
): Promise<string> {
  const existingId = await findNotabilityFolderId(drive);
  if (existingId) return existingId;

  const { data } = await drive.files.create({
    requestBody: {
      name: NOTABILITY_FOLDER_NAME,
      mimeType: DRIVE_FOLDER_MIME,
      parents: ["root"],
    },
    fields: "id",
  });

  if (!data.id) {
    throw new Error("Failed to create Notability folder");
  }

  return data.id;
}

async function fetchNotabilityFiles(): Promise<StoredDemoData> {
  const drive = google.drive({ version: "v3", auth: oauth2Client });
  const folderId = await findNotabilityFolderId(drive);
  if (!folderId) {
    return { files: [], received_at: new Date().toISOString() };
  }

  const { data } = await drive.files.list({
    q: [`'${folderId}' in parents`, "trashed = false"].join(" and "),
    pageSize: 50,
    fields: "files(id, name, mimeType, modifiedTime, parents)",
    orderBy: "modifiedTime desc",
  });

  const files: DriveFileItem[] = (data.files ?? []).map((file) => ({
    id: file.id ?? "",
    name: file.name ?? "(Untitled)",
    mimeType: file.mimeType ?? "application/octet-stream",
    modifiedTime: file.modifiedTime ?? "",
    parents: file.parents ?? [],
  }));

  return { files, received_at: new Date().toISOString() };
}

export async function fetchGoogleVersionData(version: GoogleVersionId): Promise<StoredDemoData> {
  await loadGoogleCredentials(version);

  switch (version) {
    case "zoom-google":
      return fetchZoomEvents();
    case "uber-travel-google":
      return fetchUberTravelEmails();
    case "notability-google":
      return fetchNotabilityFiles();
  }
}

export async function uploadNotabilityGoogleFile(input: {
  name?: string;
  mimeType?: string;
  contentBase64?: string;
}): Promise<void> {
  await loadGoogleCredentials("notability-google");

  const { name, mimeType, contentBase64 } = input;
  if (!name || !contentBase64) {
    throw new Error("Missing file payload");
  }

  const drive = google.drive({ version: "v3", auth: oauth2Client });
  const folderId = await ensureNotabilityFolderId(drive);
  const resolvedMimeType = mimeType || "application/octet-stream";
  const fileBuffer = Buffer.from(contentBase64, "base64");

  await drive.files.create({
    requestBody: {
      name,
      mimeType: resolvedMimeType,
      parents: [folderId],
    },
    media: {
      mimeType: resolvedMimeType,
      body: Readable.from(fileBuffer),
    },
  });
}
