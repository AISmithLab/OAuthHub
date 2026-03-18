import type { NextApiRequest, NextApiResponse } from "next";
import {
  getEmptyData,
  parseVersionParam,
  type StoredDemoData,
} from "~/lib/demo-config";
import { db } from "~/server/db";
import {
  isOAuthHubRequestError,
  verifyOAuthHubRequest,
} from "~/server/oauthhub-request";
import { oauthHubDataPath } from "~/server/storage";

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const version = parseVersionParam(req.query.version, "oauthhub");
  if (!version) {
    return res.status(400).json({ error: "Invalid or missing OAuthHub demo version" });
  }

  if (req.method === "GET") {
    try {
      return res.status(200).json(await db.getData(oauthHubDataPath(version)));
    } catch {
      return res.status(200).json(getEmptyData(version));
    }
  }

  if (req.method === "POST") {
    try {
      const { body } = await verifyOAuthHubRequest<Record<string, unknown> | unknown[]>(req, version);
      let data: StoredDemoData;

      switch (version) {
        case "zoom-oauthhub": {
          const raw = Array.isArray(body) ? body : (body.data ?? body.events ?? []);
          const events = (raw as {
            summary?: string;
            start?: { dateTime?: string; date?: string } | string;
            end?: { dateTime?: string; date?: string } | string;
          }[]).map((event) => ({
            summary: event.summary ?? "(No title)",
            start: typeof event.start === "string" ? event.start : (event.start?.dateTime ?? event.start?.date ?? ""),
            end: typeof event.end === "string" ? event.end : (event.end?.dateTime ?? event.end?.date ?? ""),
          }));
          data = { events };
          break;
        }
        case "uber-travel-oauthhub": {
          const raw = Array.isArray(body) ? body : (body.data ?? body.flights ?? body.messages ?? []);
          const flights = (raw as Array<{ snippet?: string; payload?: { headers?: Array<{ name?: string; value?: string }> } }>).map((msg) => {
            const headers = msg.payload?.headers ?? [];
            const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "";
            return {
              subject,
              snippet: msg.snippet ?? "(No content)",
            };
          });
          data = { flights };
          break;
        }
        case "notability-oauthhub": {
          const raw = Array.isArray(body) ? body : (body.data ?? body.files ?? []);
          const files = (raw as {
            id?: string;
            name?: string;
            mimeType?: string;
            modifiedTime?: string;
            parents?: string[];
          }[]).map((file) => ({
            id: file.id ?? "",
            name: file.name ?? "(Untitled)",
            mimeType: file.mimeType ?? "application/octet-stream",
            modifiedTime: file.modifiedTime ?? "",
            parents: file.parents ?? [],
          }));
          data = { files };
          break;
        }
      }

      await db.push(oauthHubDataPath(version), {
        ...data,
        received_at: new Date().toISOString(),
      });
      return res.status(200).json({ success: true });
    } catch (err) {
      if (isOAuthHubRequestError(err)) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      console.error("OAuthHub data endpoint error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
