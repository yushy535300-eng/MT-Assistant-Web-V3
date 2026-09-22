import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("SA no-login float after enter", () => {
  it("bridges background before opening the game and mirrors only", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "app/index.tsx"),
      "utf8",
    );
    expect(source).toContain("enterExternalSameOriginProxy");
    expect(source).toContain("SA 單工作階段（同 DG）");
    expect(source).toContain("Do NOT stopSaRelayServer here");
    expect(source).not.toContain("retargetSaBackgroundServer");

    const relay = fs.readFileSync(
      path.resolve(process.cwd(), "server/sa-relay.ts"),
      "utf8",
    );
    expect(relay).toContain("等待 SA 遊戲內即時封包");
    expect(relay).toContain("enterBridgeMode");
  });

  it("yields on DuplicateLogin and connects WSS sequentially", () => {
    const relay = fs.readFileSync(
      path.resolve(process.cwd(), "server/sa-relay.ts"),
      "utf8",
    );
    expect(relay).toContain("login.duplicateLogin");
    expect(relay).toContain("背景已讓出");
    expect(relay).toContain("Sequential candidates only");
    expect(relay).toContain("for (const url of candidates)");
    expect(relay).not.toContain("Race the first successful endpoint");

    const protocol = fs.readFileSync(
      path.resolve(process.cwd(), "server/sa-protocol.ts"),
      "utf8",
    );
    expect(protocol).toContain("duplicateLogin: number");
  });
});
