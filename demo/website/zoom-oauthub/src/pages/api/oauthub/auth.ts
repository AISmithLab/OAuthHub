import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "~/server/db";

const AUTH_WRITE_HEADER = "x-oauthhub-auth";

function hasJsonContentType(req: NextApiRequest): boolean {
  const contentType = req.headers["content-type"];
  return typeof contentType === "string" && contentType.toLowerCase().startsWith("application/json");
}

function hasAuthWriteHeader(req: NextApiRequest): boolean {
  const header = req.headers[AUTH_WRITE_HEADER];
  if (Array.isArray(header)) {
    return header.includes("1");
  }
  return header === "1";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    try {
      const oauthub = await db.getData("/oauthub") as { token?: string };
      return res.status(200).json({ token: oauthub.token ?? null });
    } catch {
      return res.status(200).json({ token: null });
    }
  }

  if (req.method === "POST") {
    if (!hasJsonContentType(req)) {
      return res.status(415).json({ error: "Content-Type must be application/json" });
    }

    if (!hasAuthWriteHeader(req)) {
      return res.status(403).json({ error: "Missing OAuthHub auth header" });
    }

    try {
      const { publicKey, userSub, token } = req.body as { publicKey?: unknown; userSub?: string | null; token?: string };
      const existing = await db.getData("/oauthub").catch(() => ({})) as Record<string, unknown>;
      const update: Record<string, unknown> = { ...existing, authorized_at: new Date().toISOString() };
      if (publicKey !== undefined) update.publicKey = publicKey;
      if (userSub !== undefined) update.userSub = userSub;
      if (token !== undefined) update.token = token;
      await db.push("/oauthub", update);
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("Auth save error:", err);
      return res.status(500).json({ error: "Failed to save auth data" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
