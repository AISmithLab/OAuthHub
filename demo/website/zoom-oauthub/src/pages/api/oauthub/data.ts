import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "~/server/db";
import {
  isOAuthHubRequestError,
  verifyOAuthHubRequest,
} from "~/server/oauthhub-request";

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    try { return res.status(200).json(await db.getData("/oauthub/data")); }
    catch { return res.status(200).json({ events: [] }); }
  }

  if (req.method === "POST") {
    try {
      const { body } = await verifyOAuthHubRequest<Record<string, unknown>>(req);

      const raw = Array.isArray(body) ? body : (body.data ?? body.events ?? []);
      const events = (raw as { summary?: string; start?: { dateTime?: string; date?: string } | string; end?: { dateTime?: string; date?: string } | string }[]).map((e) => ({
        summary: e.summary ?? "(No title)",
        start: typeof e.start === "string" ? e.start : (e.start?.dateTime ?? e.start?.date ?? ""),
        end: typeof e.end === "string" ? e.end : (e.end?.dateTime ?? e.end?.date ?? ""),
      }));
      await db.push("/oauthub/data", { events, received_at: new Date().toISOString() });
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
