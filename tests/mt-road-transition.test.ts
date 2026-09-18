import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("MT international road transition", () => {
  it("keeps the painted road during empty new-round packets", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "app/index.tsx"), "utf8");
    expect(source).toContain("shoe:prev.shoe");
    expect(source).toContain("round:prev.round");
    expect(source).toContain("results:[...prev.results]");
    expect(source).toContain("applyLiveWait(c,p,activeMtTableIds)");
    expect(source).not.toContain("applyLiveWait(reset,p,activeMtTableIds)");
  });
});
