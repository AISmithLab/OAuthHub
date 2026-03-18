import { wallRouter } from "~/server/api/routers/wall";
import { createTRPCRouter } from "~/server/api/trpc";

export const appRouter = createTRPCRouter({
  wall: wallRouter,
});

export type AppRouter = typeof appRouter;
