import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

describe("baccarat-helper presence wiring", () => {
  it("registers the portable presence server with helper dependencies only", () => {
    const source = readFileSync(path.join(root, "server/_core/index.ts"), "utf8");
    expect(source).toMatch(
      /registerUserPresence\(\s*app,\s*server,\s*requireAdmin,\s*\{\s*appId: "baccarat-helper",\s*getPool,\s*readRiskTrackerIdentity,\s*publicOrigin: process\.env\.PRESENCE_PUBLIC_ORIGIN \|\| "https:\/\/mt-assistant-web-v3\.onrender\.com",\s*\}\s*\);/s,
    );
  });

  it("binds to the existing access grant/session lifecycle as idle-only and disposes on cleanup", () => {
    const source = readFileSync(path.join(root, "app/index.tsx"), "utf8");
    expect(source).toContain("connectUserPresence(accessSessionId, () => false)");
    expect(source).toContain("[accessGranted, accessSessionId]");
    expect(source).toContain("return () => presence.dispose();");
    expect(source).toContain("不儲存捲動、IP 或登入憑證");
  });
});
