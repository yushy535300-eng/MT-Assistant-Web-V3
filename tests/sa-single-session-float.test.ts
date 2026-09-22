import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("SA single-session play + float (no dual SALI)", () => {
  it("enter flow never retargets a second SALI while the game is open", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "app/index.tsx"),
      "utf8",
    );
    expect(source).not.toContain("retargetSaBackgroundServer");
    expect(source).not.toContain("dualToken");
    expect(source).toContain("enterExternalSameOriginProxy");
    expect(source).toContain("單工作階段");
    expect(source).toContain("懸浮無法即時");
    expect(source).toContain("Do NOT stopSaRelayServer here");
  });

  it("proxy mirror posts frames with sessionId like DG", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/external-game-proxy.ts"),
      "utf8",
    );
    expect(source).toContain('fetch(\\"/api/sa/proxy/frames\\"');
    expect(source).toContain("sessionId:__sid");
    expect(source).toContain('credentials:\\"include\\"');
    expect(source).toContain("MTSAWebSocket");
    expect(source).toContain("void __mirrorFrame(event.data)");
    expect(source).toContain("mapWs(raw)");
    expect(source).toContain("__stay");
  });
});
