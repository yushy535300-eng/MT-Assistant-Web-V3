import { describe, expect, it } from "vitest";
import {
  saBettingCountdown,
  saHostCoverUrl,
} from "../server/sa-relay";

describe("SA host cover + countdown", () => {
  it("maps hostId to same-origin thumb proxy", () => {
    expect(saHostCoverUrl(901)).toBe("/api/sa/thumb/901");
    expect(saHostCoverUrl(0)).toBeUndefined();
  });

  it("only accepts real betting countdown seconds (1–60)", () => {
    expect(saBettingCountdown(18, 30)).toBe(18);
    expect(saBettingCountdown(0, 30)).toBe(30);
    expect(saBettingCountdown(19950, 99999)).toBe(0);
    expect(saBettingCountdown(90)).toBe(0);
  });
});
