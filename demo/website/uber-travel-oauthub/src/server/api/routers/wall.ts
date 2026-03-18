import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { db } from "~/server/db";

export const wallRouter = createTRPCRouter({
  getAuthStatus: publicProcedure.query(async () => {
    try {
      const oauthub = await db.getData("/oauthub") as { authorized_at?: string };
      if (!oauthub?.authorized_at) return { authenticated: false, authorized_at: null };
      return { authenticated: true, authorized_at: oauthub.authorized_at };
    } catch {
      return { authenticated: false, authorized_at: null };
    }
  }),

  getFlightData: publicProcedure.query(async (): Promise<{ subject: string; snippet: string }[]> => {
    const data = await db.getData("/oauthub/data") as { flights?: { subject?: string; snippet?: string }[] };
    return (data.flights ?? []).map((flight) => ({
      subject: flight.subject ?? "",
      snippet: flight.snippet ?? "(No content)",
    }));
  }),

  logout: publicProcedure.mutation(async () => {
    try { await db.delete("/oauthub"); } catch { /* ignore */ }
    try { await db.delete("/oauthub/data"); } catch { /* ignore */ }
    return { success: true };
  }),
});
