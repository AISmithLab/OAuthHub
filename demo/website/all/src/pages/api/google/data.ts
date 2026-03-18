import type { NextApiRequest, NextApiResponse } from "next";
import {
  getEmptyData,
  parseVersionParam,
} from "~/lib/demo-config";
import { db } from "~/server/db";
import {
  fetchGoogleVersionData,
  uploadNotabilityGoogleFile,
} from "~/server/google-data";
import { googleDataPath } from "~/server/storage";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const version = parseVersionParam(req.query.version, "google");
  if (!version) {
    return res.status(400).json({ error: "Invalid or missing Google demo version" });
  }

  if (req.method === "GET") {
    try {
      return res.status(200).json(await db.getData(googleDataPath(version)));
    } catch {
      return res.status(200).json(getEmptyData(version));
    }
  }

  if (req.method === "POST") {
    try {
      const data = await fetchGoogleVersionData(version);
      await db.push(googleDataPath(version), data);
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Google data fetch error:", error);
      return res.status(500).json({ error: "Failed to fetch Google data" });
    }
  }

  if (req.method === "PUT") {
    if (version !== "notability-google") {
      return res.status(400).json({ error: "Uploads are only supported for Notability x Google OAuth" });
    }

    try {
      const body = req.body as {
        name?: unknown;
        mimeType?: unknown;
        contentBase64?: unknown;
      };
      await uploadNotabilityGoogleFile({
        name: typeof body.name === "string" ? body.name : undefined,
        mimeType: typeof body.mimeType === "string" ? body.mimeType : undefined,
        contentBase64: typeof body.contentBase64 === "string" ? body.contentBase64 : undefined,
      });
      return res.status(200).json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to upload file";
      console.error("Google upload error:", error);
      return res.status(message === "Missing file payload" ? 400 : 500).json({ error: message });
    }
  }

  res.setHeader("Allow", "GET, POST, PUT");
  return res.status(405).json({ error: "Method not allowed" });
}
