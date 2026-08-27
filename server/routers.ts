import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";

export const appRouter = router({
  trackerAccess: router({
    login: publicProcedure
      .input(z.object({
        username: z.string().trim().min(1).max(128),
        password: z.string().min(1).max(256),
      }))
      .mutation(({ input }) => {
        const expectedUsername = (process.env.APP_USERNAME || "Dino0209").trim().toLowerCase();
        const expectedPassword = process.env.APP_PASSWORD || "change-me-now";
        const success =
          input.username.trim().toLowerCase() === expectedUsername &&
          input.password === expectedPassword;
        return { success } as const;
      }),
  }),
});

export type AppRouter = typeof appRouter;
