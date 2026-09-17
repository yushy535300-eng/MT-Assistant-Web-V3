import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("DG foreground multi-socket bridge", () => {
  it("broadcasts every upstream frame to all DG page sockets", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "server/dg-relay.ts"), "utf8");

    expect(source).toContain("foregroundBridgeSinks = new Set");
    expect(source).toContain("for (const sink of this.foregroundBridgeSinks)");
    expect(source).toContain("this.foregroundBridgeSinks.add(sink)");
    expect(source).toContain("this.foregroundBridgeSinks.delete(sink)");
    expect(source).not.toContain("private foregroundBridgeSink:");
  });
});
