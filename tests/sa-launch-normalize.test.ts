import { describe, expect, it } from "vitest";
import { normalizeSaLaunchUrl } from "../server/external-game-proxy";

describe("normalizeSaLaunchUrl", () => {
  it("rewrites empty sa-globalxns app.aspx gateway to labplatformplus lobby", () => {
    const next = normalizeSaLaunchUrl(
      "https://web.sa-globalxns.com/app.aspx?username=abc&token=tok123",
    );
    expect(next.origin).toBe("https://ws2.labplatformplus.com");
    expect(next.pathname).toBe("/rm/featured");
    expect(next.searchParams.get("username")).toBe("abc");
    expect(next.searchParams.get("token")).toBe("tok123");
  });

  it("leaves real lobby URLs untouched", () => {
    const raw =
      "https://ws2.labplatformplus.com/rm/featured?username=abc&token=tok123";
    const next = normalizeSaLaunchUrl(raw);
    expect(next.toString()).toBe(raw);
  });
});
