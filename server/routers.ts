import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";

function getAccounts() {
  const accounts: Array<{ username: string; password: string }> = [];
  for (let i = 1; i <= 100; i++) {
    const username = process.env[`APP_USERNAME_${i}`];
    const password = process.env[`APP_PASSWORD_${i}`];
    if (username && password) accounts.push({ username: username.trim().toLowerCase(), password });
  }
  // Backward-compatible single account if present.
  if (process.env.APP_USERNAME && process.env.APP_PASSWORD) {
    accounts.push({ username: process.env.APP_USERNAME.trim().toLowerCase(), password: process.env.APP_PASSWORD });
  }
  return accounts;
}

export const appRouter = router({
  trackerAccess: router({
    login: publicProcedure
      .input(z.object({ username: z.string().min(1).max(128), password: z.string().min(1).max(256) }))
      .mutation(({ input }) => ({
        success: getAccounts().some(a => a.username === input.username.trim().toLowerCase() && a.password === input.password),
      } as const)),
  }),
});

export type AppRouter = typeof appRouter;

