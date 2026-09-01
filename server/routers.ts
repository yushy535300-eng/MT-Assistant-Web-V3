import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { randomUUID } from "node:crypto";


// Single-login registry.
// A successful login replaces the previous session for the same account.
// NOTE: this is process memory, ideal for the current single Render instance.
const activeSessions = new Map<string, string>();

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
      .mutation(({ input }) => {
        const username = input.username.trim().toLowerCase();
        const success = getAccounts().some(a => a.username === username && a.password === input.password);
        if (!success) return { success: false, sessionId: "" } as const;

        const sessionId = randomUUID();
        activeSessions.set(username, sessionId);
        return { success: true, sessionId } as const;
      }),
    checkSession: publicProcedure
      .input(z.object({ sessionId: z.string().min(1).max(128) }))
      .query(({ input }) => ({
        valid: Array.from(activeSessions.values()).includes(input.sessionId),
      } as const)),
  }),
});

export type AppRouter = typeof appRouter;
