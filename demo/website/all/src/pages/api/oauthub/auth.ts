import type { NextApiRequest, NextApiResponse } from "next";
import { parseVersionParam } from "~/lib/demo-config";
import { db } from "~/server/db";
import { oauthHubAuthPath } from "~/server/storage";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const version = parseVersionParam(req.query.version, "oauthhub");
  if (!version) {
    return res.status(400).json({ error: "Invalid or missing OAuthHub demo version" });
  }

  if (req.method === "GET") {
    try {
      const oauthub = await db.getData(oauthHubAuthPath(version)) as { token?: string };
      return res.status(200).json({ token: oauthub.token ?? null });
    } catch {
      return res.status(200).json({ token: null });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body as {
        publicKey?: unknown;
        userSub?: unknown;
        token?: unknown;
      };
      const publicKey = body.publicKey;
      const userSub =
        typeof body.userSub === "string" || body.userSub === null
          ? body.userSub
          : undefined;
      const token = typeof body.token === "string" ? body.token : undefined;
      const existing = await db.getData(oauthHubAuthPath(version)).catch(() => ({})) as Record<string, unknown>;
      const update: Record<string, unknown> = { ...existing, authorized_at: new Date().toISOString() };
      if (publicKey !== undefined) update.publicKey = publicKey;
      if (userSub !== undefined) update.userSub = userSub;
      if (token !== undefined) update.token = token;
      await db.push(oauthHubAuthPath(version), update);
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("Auth save error:", err);
      return res.status(500).json({ error: "Failed to save auth data" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
