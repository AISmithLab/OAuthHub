import type { NextApiRequest, NextApiResponse } from "next";
import type { Credentials } from "google-auth-library";
import { google } from "googleapis";
import { Readable } from "node:stream";
import { db } from "~/server/db";
import oauth2Client from "~/server/googleAuthClient";

const NOTABILITY_FOLDER_NAME = "Notability";
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    try { return res.status(200).json(await db.getData("/google_data")); }
    catch { return res.status(200).json({ files: [] }); }
  }

  if (req.method === "POST") {
    try {
      const tokens = await db.getData("/google_tokens") as Credentials;
      oauth2Client.setCredentials(tokens);

      const drive = google.drive({ version: "v3", auth: oauth2Client });
      const folderId = await findNotabilityFolderId(drive);
      if (!folderId) {
        await db.push("/google_data", { files: [], received_at: new Date().toISOString() });
        return res.status(200).json({ success: true });
      }

      const { data } = await drive.files.list({
        q: [`'${folderId}' in parents`, "trashed = false"].join(" and "),
        pageSize: 50,
        fields: "files(id, name, mimeType, modifiedTime, parents)",
        orderBy: "modifiedTime desc",
      });

      const files = (data.files ?? []).map((file) => ({
        id: file.id ?? "",
        name: file.name ?? "(Untitled)",
        mimeType: file.mimeType ?? "application/octet-stream",
        modifiedTime: file.modifiedTime ?? "",
        parents: file.parents ?? [],
      }));

      await db.push("/google_data", { files, received_at: new Date().toISOString() });
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("Data fetch error:", err);
      return res.status(500).json({ error: "Failed to fetch Drive files" });
    }
  }

  if (req.method === "PUT") {
    try {
      const tokens = await db.getData("/google_tokens") as Credentials;
      oauth2Client.setCredentials(tokens);

      const drive = google.drive({ version: "v3", auth: oauth2Client });
      const { name, mimeType, contentBase64 } = req.body as {
        name?: string;
        mimeType?: string;
        contentBase64?: string;
      };
      if (!name || !contentBase64) {
        return res.status(400).json({ error: "Missing file payload" });
      }

      const folderId = await ensureNotabilityFolderId(drive);
      const resolvedMimeType = mimeType || "application/octet-stream";
      const fileBuffer = Buffer.from(contentBase64, "base64");

      const fileMetadata = {
        name,
        mimeType: resolvedMimeType,
        parents: [folderId],
      };

      await drive.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType: resolvedMimeType,
          body: Readable.from(fileBuffer),
        },
      });

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("Upload error:", err);
      return res.status(500).json({ error: "Failed to upload file" });
    }
  }

  res.setHeader("Allow", "GET, POST, PUT");
  return res.status(405).json({ error: "Method not allowed" });
}
