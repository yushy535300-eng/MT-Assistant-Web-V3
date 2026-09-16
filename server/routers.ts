import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { randomUUID } from "node:crypto";
import { authorizeWhitelist } from "./whitelist";


// TZ website authorization + single-login registry.
// The browser talks to TZ directly so Render is not the source IP of the TZ login request.
// Passwords are never sent to or stored by this server.
const activeSessions = new Map<string, string>();

export const appRouter = router({
  trackerAccess: router({
    login: publicProcedure
      .input(z.object({
        username: z.string().min(1).max(128),
        platform: z.enum(["TZ","OFA"]).optional(),
        tzToken: z.string().min(16).max(8192),
        deviceId: z.string().min(1).max(128).optional(),
      }))
      .mutation(async ({ input }) => {
        // TZ already authenticated the credentials in the user's browser.
        // Do not persist the TZ token; it is only proof that the browser login completed.
        const username = input.username.trim().toLowerCase();
        if (!username || !input.tzToken.trim()) return { success: false, sessionId: "", reason: "invalid_login" } as const;

        const access = await authorizeWhitelist(username, input.platform || "TZ");
        if (!access.allowed) return { success: false, sessionId: "", reason: access.reason } as const;

        const sessionId = randomUUID();
        activeSessions.set(`${input.platform || "TZ"}:${username}`, sessionId);
        return { success: true, sessionId } as const;
      }),
    checkSession: publicProcedure
      .input(z.object({ sessionId: z.string().min(1).max(128) }))
      .query(async ({ input }) => {
        let sessionKey = "";
        for (const [name, sessionId] of activeSessions.entries()) {
          if (sessionId === input.sessionId) { sessionKey = name; break; }
        }
        if (!sessionKey) return { valid: false, reason: "session_invalid" } as const;

        // Re-check the live whitelist on every session heartbeat. This makes admin
        // disable/delete/expiry changes affect users who are already online.
        const split=sessionKey.indexOf(":");
        const platform=split>0?sessionKey.slice(0,split):"TZ";
        const username=split>0?sessionKey.slice(split+1):sessionKey;
        const access = await authorizeWhitelist(username, platform);
        if (!access.allowed) {
          activeSessions.delete(sessionKey);
          return { valid: false, reason: access.reason } as const;
        }
        return { valid: true, reason: "ok" } as const;
      }),
    logout: publicProcedure
      .input(z.object({ sessionId: z.string().min(1).max(128) }))
      .mutation(({ input }) => {
        for (const [username, sessionId] of activeSessions.entries()) {
          if (sessionId === input.sessionId) {
            activeSessions.delete(username);
              break;
          }
        }
        return { success: true } as const;
      }),
  }),
});

export type AppRouter = typeof appRouter;

