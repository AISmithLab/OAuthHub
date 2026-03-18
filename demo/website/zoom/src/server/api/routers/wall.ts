import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { db } from "~/server/db";

export const wallRouter = createTRPCRouter({
  getAuthStatus: publicProcedure.query(async () => {
    try {
      const tokens = await db.getData("/google_tokens") as { authorized_at?: string };
      if (!tokens?.authorized_at) return { authenticated: false, authorized_at: null };
      return { authenticated: true, authorized_at: tokens.authorized_at };
    } catch {
      return { authenticated: false, authorized_at: null };
    }
  }),

  getCalendarEvents: publicProcedure.query(async (): Promise<{ summary: string; start: string; end: string }[]> => {
    const data = await db.getData("/google_data") as { events?: { summary?: string; start?: string; end?: string }[] };
    return (data.events ?? []).map((event) => ({
      summary: event.summary ?? "(No title)",
      start: event.start ?? "",
      end: event.end ?? "",
    }));
  }),

  logout: publicProcedure.mutation(async () => {
    try { await db.delete("/google_tokens"); } catch { /* ignore */ }
    try { await db.delete("/google_data"); } catch { /* ignore */ }
    return { success: true };
  }),
});
