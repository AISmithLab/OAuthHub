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

  getFlightData: publicProcedure.query(async (): Promise<{ subject: string; snippet: string }[]> => {
    const data = await db.getData("/google_data") as { flights?: { subject?: string; snippet?: string }[] };
    return (data.flights ?? []).map((flight) => ({
      subject: flight.subject ?? "(No subject)",
      snippet: flight.snippet ?? "",
    }));
  }),

  logout: publicProcedure.mutation(async () => {
    try { await db.delete("/google_tokens"); } catch { /* ignore */ }
    try { await db.delete("/google_data"); } catch { /* ignore */ }
    return { success: true };
  }),
});
