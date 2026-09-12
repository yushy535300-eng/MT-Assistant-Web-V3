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
  const timeout = setTimeout(() => controller.abort(), 15000);
  const id = deviceId || randomUUID();
  try {
    // Match the request shape used by the working ScarabHeart client as closely as
    // possible. In particular, do not use the synthetic "MT-Assistant" UA: some
    // Cloudflare/proxy setups reject or challenge it before the API sees the body.
    const response = await fetch(`${TZ_BASE}/api/v1/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        "Origin": TZ_BASE,
        "Referer": `${TZ_BASE}/`,
      },
      body: JSON.stringify({ username, password, device_id: id }),
      signal: controller.signal,
      redirect: "follow",
    });

    const text = await response.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch {}

    const token = data?.data?.token ?? data?.token ?? data?.data?.access_token ?? data?.access_token;
    if (token) return { ok: true as const, reason: "OK", status: response.status };

    // Keep account/password failures separate from gateway/Cloudflare/network errors.
    const apiMessage = String(data?.message ?? data?.msg ?? data?.error ?? "").trim();
    if (response.status === 401 || response.status === 422 || /帳號|密碼|password|account|login/i.test(apiMessage)) {
      return { ok: false as const, reason: apiMessage || "TZ 帳號或密碼不正確", status: response.status };
    }
    if (response.status === 403 || response.status === 429) {
      return { ok: false as const, reason: `TZ 驗證服務拒絕連線 (${response.status})`, status: response.status };
    }
    return { ok: false as const, reason: apiMessage || `TZ 驗證未取得登入憑證 (${response.status})`, status: response.status };
  } catch (error: any) {
    const reason = error?.name === "AbortError"
      ? "TZ 驗證逾時，請稍後再試"
      : "目前無法連到 TZ 驗證服務";
    return { ok: false as const, reason, status: 0 };
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
        const verified = await verifyTzAccount(username, input.password, input.deviceId);
        if (!verified.ok) return { success: false, sessionId: "", error: verified.reason } as const;

        const sessionId = randomUUID();
        activeSessions.set(username.toLowerCase(), sessionId);
        return { success: true, sessionId, error: "" } as const;
      }),
    checkSession: publicProcedure
      .input(z.object({ sessionId: z.string().min(1).max(128) }))
      .query(({ input }) => ({
        valid: Array.from(activeSessions.values()).includes(input.sessionId),
      } as const)),
  }),
});

export type AppRouter = typeof appRouter;

