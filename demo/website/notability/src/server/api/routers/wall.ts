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

  getDriveFiles: publicProcedure.query(async (): Promise<{ id: string; name: string; mimeType: string; modifiedTime: string }[]> => {
    const data = await db.getData("/google_data") as { files?: { id?: string; name?: string; mimeType?: string; modifiedTime?: string }[] };
    return (data.files ?? []).map((file) => ({
      id: file.id ?? "",
      name: file.name ?? "(Untitled)",
      mimeType: file.mimeType ?? "application/octet-stream",
      modifiedTime: file.modifiedTime ?? "",
    }));
  }),

  logout: publicProcedure.mutation(async () => {
    try { await db.delete("/google_tokens"); } catch { /* ignore */ }
    try { await db.delete("/google_data"); } catch { /* ignore */ }
    return { success: true };
  }),
});
