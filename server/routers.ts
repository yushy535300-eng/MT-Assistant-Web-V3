import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { randomUUID } from "node:crypto";
import { runAiAnalysis } from "./ai-analysis";
import { authorizeWhitelist, getWhitelistPlatform } from "./whitelist";
import {
  deleteTrackerSession,
  findTrackerSessionByUser,
  hasActiveTrackerSession,
  loadTrackerSession,
  saveTrackerSession,
} from "./sessions";

export { hasActiveTrackerSession } from "./sessions";
export { requireTrackerSession } from "./sessions";

export const appRouter = router({
  aiAnalysis: router({
    analyze: publicProcedure
      .input(z.object({
        sessionId: z.string().min(1).max(128),
        provider: z.enum(["chatgpt", "gemini", "grok", "meta", "combined"]),
        tableName: z.string().max(160).optional(),
        dealer: z.string().max(160).optional(),
        round: z.number().int().min(0).max(999999).optional(),
        results: z.array(z.string().max(8)).max(120),
        pattern: z.string().max(120).optional(),
        localScoreBanker: z.number().finite().optional(),
        localScorePlayer: z.number().finite().optional(),
      }))
      .mutation(async ({ input }) => runAiAnalysis(input)),
  }),
  trackerAccess: router({
    resolvePlatform: publicProcedure
      .input(z.object({ username:z.string().min(1).max(128) }))
      .mutation(async ({input}) => getWhitelistPlatform(input.username)),
    login: publicProcedure
      .input(z.object({
        username: z.string().min(1).max(128),
        tzToken: z.string().min(16).max(8192),
        deviceId: z.string().min(1).max(128).optional(),
        platform: z.enum(["TZ","OFA"]).default("TZ"),
      }))
      .mutation(async ({ input }) => {
        const username = input.username.trim().toLowerCase();
        if (!username || !input.tzToken.trim()) return { success: false, sessionId: "", reason: "invalid_login" } as const;

        const platform=input.platform;
        const access = await authorizeWhitelist(username, platform);
        if (!access.allowed) return { success: false, sessionId: "", reason: access.reason } as const;

        const existing = await findTrackerSessionByUser(platform, username);
        const sessionId = existing?.sessionId || randomUUID();
        await saveTrackerSession({ sessionId, platform, username });
        return { success: true, sessionId } as const;
      }),
    checkSession: publicProcedure
      .input(z.object({ sessionId: z.string().min(1).max(128) }))
      .query(async ({ input }) => {
        const current = await loadTrackerSession(input.sessionId);
        if (!current) return { valid: false, reason: "session_expired" } as const;

        const access = await authorizeWhitelist(current.username, current.platform);
        if (!access.allowed) {
          await deleteTrackerSession(input.sessionId);
          return { valid: false, reason: access.reason } as const;
        }
        return { valid: true, reason: "ok" } as const;
      }),
    logout: publicProcedure
      .input(z.object({ sessionId: z.string().min(1).max(128) }))
      .mutation(async ({ input }) => {
        await deleteTrackerSession(input.sessionId);
        return { success: true } as const;
      }),
  }),
});

export type AppRouter = typeof appRouter;
