import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("DG wallet re-entry after transfer all", () => {
  it("refreshes DGLI exactly for the next explicit DG launch", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "app/index.tsx"), "utf8");
    expect(source).toContain("dgFreshAuthorizationRequiredRef.current=true");
    expect(source).toContain("const needsWalletReentry=dgFreshAuthorizationRequiredRef.current");
    expect(source).toContain("url=await ensureDgAuthorization(true)");
    expect(source).toContain('await stopDgRelayServer(accessSessionId)');
    expect(source).toContain('fetch("/api/dg/start"');
    expect(source).toContain("dgFreshAuthorizationRequiredRef.current=false");
  });
});
