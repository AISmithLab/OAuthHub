/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "~/server/db";
import {
  isOAuthHubRequestError,
  oauthHubApiConfig,
  verifyOAuthHubRequest,
} from "~/server/oauthhub-request";

export const config = oauthHubApiConfig;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // GET: frontend reads stored tokens
  if (req.method === "GET") {
    try {
      const tokens = await db.getData("/oauthub/tokens");
      return res.status(200).json(tokens);
    } catch {
      return res.status(200).json(null);
    }
  }

  // POST: extension delivers tokens
  if (req.method === "POST") {
    try {
      const { body } = await verifyOAuthHubRequest<{
        access_token?: string;
        token_type?: string;
        expires_in?: number | null;
        scope?: string | null;
      }>(req);

      const { access_token, token_type, expires_in, scope } = body;

      if (!access_token) {
        return res.status(400).json({ error: "Missing access_token" });
      }

      await db.push("/oauthub/tokens", {
        access_token,
        token_type: token_type ?? "Bearer",
        expires_in: expires_in ?? null,
        scope: scope ?? null,
        received_at: new Date().toISOString(),
      });

      return res.status(200).json({ success: true });
    } catch (err) {
      if (isOAuthHubRequestError(err)) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      console.error("OAuthHub token endpoint error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
