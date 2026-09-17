import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("DG foreground frame mirror", () => {
  it("feeds the exact frames received by the DG page into the floating relay", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "server/dg-game-proxy.ts"), "utf8");
    expect(source).toContain('this.addEventListener(\\"message\\",event=>{void __mirrorFrame(event.data);})');
    expect(source).toContain('fetch(\\"/api/dg/proxy/frames\\"');
    expect(source).toContain('app.post("/api/dg/proxy/frames"');
    expect(source).toContain("relay.ingestBridgeFrame(data)");
  });
});
