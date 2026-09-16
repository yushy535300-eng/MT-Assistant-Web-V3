import { describe, expect, it } from "vitest";

function mapDgRoadCode(code: number): "莊" | "閒" | "和" | null {
  if (code >= 1 && code <= 4) return "莊";
  if (code >= 5 && code <= 8) return "閒";
  if (code >= 9 && code <= 12) return "和";
  return null;
}

describe("DG baccarat road winner codes", () => {
  it("uses the DG four-code winner groups", () => {
    for (const code of [1, 2, 3, 4]) expect(mapDgRoadCode(code)).toBe("莊");
    for (const code of [5, 6, 7, 8]) expect(mapDgRoadCode(code)).toBe("閒");
    for (const code of [9, 10, 11, 12]) expect(mapDgRoadCode(code)).toBe("和");
  });
});
