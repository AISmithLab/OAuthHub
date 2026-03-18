import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "~/server/db";
import oauth2Client from "~/server/googleAuthClient";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const authUri = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/gmail.readonly"],
      prompt: "consent",
    });
    return res.status(200).json({ authUri });
  }

  if (req.method === "POST") {
    try {
      const { code } = req.body as { code: string };
      if (!code) return res.status(400).json({ error: "Missing authorization code" });
      const { tokens } = await oauth2Client.getToken(code);
      await db.push("/google_tokens", { ...tokens, authorized_at: new Date().toISOString() });
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("Auth error:", err);
      return res.status(500).json({ error: "Failed to exchange token" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
