import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "~/server/db";
import {
  getVersionConfig,
  isGoogleVersion,
  makeGoogleState,
  parseGoogleState,
  parseVersionParam,
} from "~/lib/demo-config";
import oauth2Client from "~/server/googleAuthClient";
import { googleTokensPath } from "~/server/storage";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const version = parseVersionParam(req.query.version, "google");
    if (!version || !isGoogleVersion(version)) {
      return res.status(400).json({ error: "Invalid or missing Google demo version" });
    }

    const config = getVersionConfig(version);
    if (config.authMode !== "google") {
      return res.status(400).json({ error: "Invalid Google demo configuration" });
    }
    const authUri = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: config.googleScopes,
      prompt: "consent",
      state: makeGoogleState(version),
    });

    return res.status(200).json({ authUri });
  }

  if (req.method === "POST") {
    try {
      const body = req.body as { code?: unknown; state?: unknown };
      const code = typeof body.code === "string" ? body.code : undefined;
      const state = typeof body.state === "string" ? body.state : undefined;
      const version = parseGoogleState(state);

      if (!code || !version) {
        return res.status(400).json({ error: "Missing authorization code or state" });
      }

      const { tokens } = await oauth2Client.getToken(code);
      await db.push(googleTokensPath(version), {
        ...tokens,
        authorized_at: new Date().toISOString(),
      });

      return res.status(200).json({ success: true, version });
    } catch (error) {
      console.error("Google auth error:", error);
      return res.status(500).json({ error: "Failed to exchange Google authorization code" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
