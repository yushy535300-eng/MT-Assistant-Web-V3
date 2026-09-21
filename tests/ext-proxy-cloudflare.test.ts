import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  looksLikeCloudflareBlock,
  proxyCookieSecureAttr,
} from "../server/external-game-proxy";

describe("external game proxy Cloudflare detection", () => {
  it("detects common CF challenge / block HTML", () => {
    expect(
      looksLikeCloudflareBlock(
        `<html><head><title>Just a moment...</title></head><body>Checking your browser Cloudflare cdn-cgi</body></html>`,
        403,
      ),
    ).toBe(true);
    expect(
      looksLikeCloudflareBlock(
        `<html><div id="cf-error-details">Attention Required! | Cloudflare</div></html>`,
        403,
      ),
    ).toBe(true);
    expect(
      looksLikeCloudflareBlock(
        `<!DOCTYPE html><html><body><h1>正常大廳</h1><script>window.__LIVE__=1</script></body></html>`,
        200,
      ),
    ).toBe(false);
  });

  it("enter endpoint returns cloudflare_blocked clearly", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/external-game-proxy.ts"),
      "utf8",
    );
    expect(source).toContain("looksLikeCloudflareBlock");
    expect(source).toContain("cloudflare_blocked");
    expect(source).toContain('code === "cloudflare_blocked" ? 502 : 400');
  });

  it("marks Secure only for HTTPS (not NODE_ENV alone)", () => {
    expect(
      proxyCookieSecureAttr({
        headers: { "x-forwarded-proto": "https" },
      }),
    ).toBe("; Secure");
    expect(
      proxyCookieSecureAttr({
        headers: { "x-forwarded-proto": "http" },
      }),
    ).toBe("");
    expect(
      proxyCookieSecureAttr({
        secure: false,
        protocol: "http",
        headers: {},
      }),
    ).toBe("");
    expect(
      proxyCookieSecureAttr({
        secure: true,
        headers: {},
      }),
    ).toBe("; Secure");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/external-game-proxy.ts"),
      "utf8",
    );
    expect(source).toContain("proxyCookieSecureAttr(req)");
    expect(source).not.toMatch(
      /Max-Age=14400\$\{\s*process\.env\.NODE_ENV === "production" \? "; Secure" : ""\s*\}/,
    );
  });
});
