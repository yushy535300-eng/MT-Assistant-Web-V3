import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("SA single-session like DG", () => {
  it("enter flow matches DG: bridge closes background WS, proxy + mirror only", () => {
    const app = fs.readFileSync(
      path.resolve(process.cwd(), "app/index.tsx"),
      "utf8",
    );
    // DG reference (must remain — we do not edit DG):
    expect(app).toContain("await stopDgRelayServer(accessSessionId)");
    expect(app).toContain("enterDgSameSessionProxy");
    // SA: do not wipe relay/tables on enter — enterBridgeMode stops PS_LOGIN.
    expect(app).toContain('enterExternalSameOriginProxy(url, "SA")');
    expect(app).toContain("SA 單工作階段（同 DG）");
    expect(app).toContain("Do NOT stopSaRelayServer here");
    expect(app).not.toContain("retargetSaBackgroundServer");
  });

  it("SA proxy enter uses /api/ext/host so inject always runs (DG has /ddnewpc mounts)", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/external-game-proxy.ts"),
      "utf8",
    );
    expect(source).toContain("HOST_PREFIX}/${finalUrl.hostname}");
    expect(source).toContain("__mt_ext_sid");
    expect(source).toContain("SA inject HTML");
    expect(source).toContain("normalizeSaLaunchUrl");
    expect(source).toContain("saEmptyDocumentBootstrap");
    expect(source).toContain("looksHtml");
    expect(source).toContain("MTSAWebSocket");
    expect(source).toContain('fetch(\\"/api/sa/proxy/frames\\"');
  });
});
