import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "~/server/db";
import { isGoogleVersion, parseVersionParam } from "~/lib/demo-config";
import {
  clearVersionState,
  googleTokensPath,
  oauthHubAuthPath,
} from "~/server/storage";

type SessionResponse = {
  authenticated: boolean;
  authorized_at: string | null;
};

function getVersion(req: NextApiRequest, res: NextApiResponse) {
  const version = parseVersionParam(req.query.version);
  if (!version) {
    res.status(400).json({ error: "Invalid or missing version" });
    return null;
  }
  return version;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SessionResponse | { error: string } | { success: true }>
) {
  const version = getVersion(req, res);
  if (!version) return;

  if (req.method === "GET") {
    const authPath = isGoogleVersion(version)
      ? googleTokensPath(version)
      : oauthHubAuthPath(version);

    try {
      const data = await db.getData(authPath) as { authorized_at?: string | null };
      return res.status(200).json({
        authenticated: Boolean(data?.authorized_at),
        authorized_at: data?.authorized_at ?? null,
      });
    } catch {
      return res.status(200).json({ authenticated: false, authorized_at: null });
    }
  }

  if (req.method === "DELETE") {
    await clearVersionState(version);
    return res.status(200).json({ success: true });
  }

  res.setHeader("Allow", "GET, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}
