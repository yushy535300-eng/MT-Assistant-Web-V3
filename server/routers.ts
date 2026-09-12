import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { randomUUID } from "node:crypto";


// TZ account authorization + single-login registry.
// MT Assistant uses TZ account verification for website access.
// The TZ password/token are used only for the login verification request and are not stored.
const activeSessions = new Map<string, string>();
const TZ_BASE = "https://www.tz6868.cc";

async function verifyTzAccount(username: string, password: string, deviceId?: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${TZ_BASE}/api/v1/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 MT-Assistant/1.0",
        "Origin": TZ_BASE,
        "Referer": `${TZ_BASE}/`,
      },
      body: JSON.stringify({
        username,
        password,
        device_id: deviceId || randomUUID(),
      }),
      signal: controller.signal,
    });

    if (!response.ok) return false;
    const data: any = await response.json().catch(() => null);
    return Boolean(data?.data?.token);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export const appRouter = router({
  trackerAccess: router({
    login: publicProcedure
      .input(z.object({
        username: z.string().min(1).max(128),
        password: z.string().min(1).max(256),
        deviceId: z.string().min(1).max(128).optional(),
      }))
      .mutation(async ({ input }) => {
        const username = input.username.trim();
        const success = await verifyTzAccount(username, input.password, input.deviceId);
        if (!success) return { success: false, sessionId: "" } as const;

        const sessionId = randomUUID();
        activeSessions.set(username.toLowerCase(), sessionId);
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

