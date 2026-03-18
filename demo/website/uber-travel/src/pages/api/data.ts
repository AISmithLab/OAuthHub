import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import { db } from "~/server/db";
import oauth2Client from "~/server/googleAuthClient";

type GmailMessagePart = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailMessagePart[] | null;
};

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    try { return res.status(200).json(await db.getData("/google_data")); }
    catch { return res.status(200).json({ flights: [] }); }
  }

  if (req.method === "POST") {
    try {
      const tokens = await db.getData("/google_tokens");
      oauth2Client.setCredentials(tokens);

      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      // Baseline: fetches raw Gmail content directly from the app server.
      const { data: listData } = await gmail.users.messages.list({
        userId: "me",
        maxResults: 100,
      });

      const messages = listData.messages ?? [];
      const flights: Array<{ subject: string; snippet: string }> = [];

      for (const msg of messages) {
        const { data: detail } = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "metadata",
          metadataHeaders: ["Subject"],
        });

        const subject = detail.payload?.headers?.find(h => h.name === "Subject")?.value ?? "(No subject)";

        flights.push({
          subject,
          snippet: detail.snippet ?? "",
        });
      }

      await db.push("/google_data", { flights, received_at: new Date().toISOString() });
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("Data fetch error:", err);
      return res.status(500).json({ error: "Failed to fetch email data" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
