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
    catch { return res.status(200).json({ files: [] }); }
  }

  if (req.method === "POST") {
    try {
      const { body } = await verifyOAuthHubRequest<Record<string, unknown>>(req);

      const raw = Array.isArray(body) ? body : (body.data ?? body.files ?? []);
      const files = (raw as { id?: string; name?: string; mimeType?: string; modifiedTime?: string; parents?: string[] }[]).map((f) => ({
        id: f.id ?? "",
        name: f.name ?? "(Untitled)",
        mimeType: f.mimeType ?? "application/octet-stream",
        modifiedTime: f.modifiedTime ?? "",
        parents: f.parents ?? [],
      }));
      await db.push("/oauthub/data", { files, received_at: new Date().toISOString() });
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
