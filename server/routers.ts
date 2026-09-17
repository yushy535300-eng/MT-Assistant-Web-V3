import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { randomUUID } from "node:crypto";
import { authorizeWhitelist, getWhitelistPlatform } from "./whitelist";


// TZ website authorization + single-login registry.
// The browser talks to TZ directly so Render is not the source IP of the TZ login request.
// Passwords are never sent to or stored by this server.
const activeSessions = new Map<string, { sessionId:string; platform:string; username:string }>();

export function hasActiveTrackerSession(sessionId:string){
  if(!sessionId)return false;
  for(const value of activeSessions.values()) if(value.sessionId===sessionId) return true;
  return false;
}

export const appRouter = router({
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
        // TZ already authenticated the credentials in the user's browser.
        // Do not persist the TZ token; it is only proof that the browser login completed.
        const username = input.username.trim().toLowerCase();
        if (!username || !input.tzToken.trim()) return { success: false, sessionId: "", reason: "invalid_login" } as const;

        const platform=input.platform;
        const access = await authorizeWhitelist(username, platform);
        if (!access.allowed) return { success: false, sessionId: "", reason: access.reason } as const;

        const sessionId = randomUUID();
        activeSessions.set(`${platform}:${username}`, {sessionId,platform,username});
        return { success: true, sessionId } as const;
      }),
    checkSession: publicProcedure
      .input(z.object({ sessionId: z.string().min(1).max(128) }))
      .query(async ({ input }) => {
        let current:{sessionId:string;platform:string;username:string}|null=null;
        for (const value of activeSessions.values()) { if(value.sessionId===input.sessionId){current=value;break;} }
        if (!current) return { valid: false, reason: "session_invalid" } as const;
        const {username,platform}=current;

        // Re-check the live whitelist on every session heartbeat. This makes admin
        // disable/delete/expiry changes affect users who are already online.
        const access = await authorizeWhitelist(username, platform);
        if (!access.allowed) {
          activeSessions.delete(`${platform}:${username}`);
          return { valid: false, reason: access.reason } as const;
        }
        return { valid: true, reason: "ok" } as const;
      }),
    logout: publicProcedure
      .input(z.object({ sessionId: z.string().min(1).max(128) }))
      .mutation(({ input }) => {
        for (const [key, value] of activeSessions.entries()) {
          if (value.sessionId === input.sessionId) {
            activeSessions.delete(key);
              break;
          }
        }
        return { success: true } as const;
      }),
  }),
});

export type AppRouter = typeof appRouter;

