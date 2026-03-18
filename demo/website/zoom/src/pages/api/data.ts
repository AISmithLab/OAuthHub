import type { NextApiRequest, NextApiResponse } from "next";
import type { Credentials } from "google-auth-library";
import { google } from "googleapis";
import { db } from "~/server/db";
import oauth2Client from "~/server/googleAuthClient";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    try { return res.status(200).json(await db.getData("/google_data")); }
    catch { return res.status(200).json({ events: [] }); }
  }

  if (req.method === "POST") {
    try {
      const tokens = await db.getData("/google_tokens") as Credentials;
      oauth2Client.setCredentials(tokens);

      const calendar = google.calendar({ version: "v3", auth: oauth2Client });
      const timeMin = new Date().toISOString();
      const events: { summary: string; start: string; end: string }[] = [];
      let pageToken: string | undefined;

      do {
        const { data } = await calendar.events.list({
          calendarId: "primary",
          timeMin,
          singleEvents: true,
          orderBy: "startTime",
          pageToken,
        });

        events.push(
          ...(data.items ?? []).map((event) => ({
            summary: event.summary ?? "(No title)",
            start: event.start?.dateTime ?? event.start?.date ?? "",
            end: event.end?.dateTime ?? event.end?.date ?? "",
          }))
        );

        pageToken = data.nextPageToken ?? undefined;
      } while (pageToken);

      await db.push("/google_data", { events, received_at: new Date().toISOString() });
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("Data fetch error:", err);
      return res.status(500).json({ error: "Failed to fetch calendar data" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
