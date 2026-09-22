import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("SA foreground frame mirror", () => {
  it("mirrors browser-decoded SA frames into the road relay (DG pattern)", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/external-game-proxy.ts"),
      "utf8",
    );
    expect(source).toContain('fetch(\\"/api/sa/proxy/frames\\"');
    expect(source).toContain("void __mirrorFrame(event.data)");
    expect(source).toContain('app.post("/api/sa/proxy/frames"');
    expect(source).toContain("options.onSaUpstreamPacket(session.sessionId, data)");
    expect(source).toContain("sessionId:__sid");
    expect(source).toContain("MTSAWebSocket");
  });

  it("keeps bridge ingest path for mirrored packets", () => {
    const relay = fs.readFileSync(
      path.resolve(process.cwd(), "server/sa-relay.ts"),
      "utf8",
    );
    expect(relay).toContain("ingestApplicationPacket(raw: Buffer)");
    expect(relay).toContain('this.setStatus("connected", "SA 遊戲內即時封包已接通")');
    expect(relay).toContain("等待 SA 遊戲內即時封包");
  });
});
