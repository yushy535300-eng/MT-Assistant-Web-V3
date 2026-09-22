import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("SA floating assistant lifecycle (DG-aligned)", () => {
  it("does not force SA offline while entering the same-session proxy", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../app/index.tsx"),
      "utf8",
    );
    const enterFn = source.slice(
      source.indexOf("const enterExternalSameOriginProxy"),
      source.indexOf("const leaveExternalSameOriginProxy"),
    );
    expect(enterFn).not.toContain("setSaConnected(false)");
    expect(enterFn).not.toContain('setSaStatus("連線中")');
    expect(enterFn).toContain("do not force the floating assistant offline");

    // Enter-game block must not close SSE / wipe connected flag (DG pattern).
    const saEnter = source.slice(
      source.indexOf('} else if (activePlatform === "SA") {'),
      source.indexOf('notify(`已轉入${platformDisplayName("SA")}`)'),
    );
    expect(saEnter).not.toContain("saControllerRef.current?.close()");
    expect(saEnter).not.toContain("setSaConnected(false)");
    expect(saEnter).not.toContain('setSaStatus("等待遊戲內即時封包")');
    expect(saEnter).not.toContain("await stopSaRelayServer(accessSessionId)");
    expect(saEnter).toContain("Do NOT stopSaRelayServer here");
    expect(saEnter).toContain("setSaConnectEpoch");
  });

  it("proxy keeps SA on host-prefix with sid fallback and WS tunnel+mirror", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../server/external-game-proxy.ts"),
      "utf8",
    );
    expect(source).toContain("__mt_ext_sid");
    expect(source).toContain("sessionIdFromRequest");
    expect(source).toContain("mapWs(raw)");
    expect(source).toContain("Location.prototype");
    expect(source).toContain("SA host first hit");
    expect(source).toContain("SA skip inject");
  });
});
