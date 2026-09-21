import { describe, expect, it } from "vitest";
import {
  saWinReportTableMatches,
  saWinReportToSettleBody,
} from "../lib/sa-report";
import type { SaWinReportResult } from "../lib/sa-live";
import { parseScGameResult } from "../server/sa-protocol";

describe("SA 輸贏報表 GameResult feed", () => {
  const sample: SaWinReportResult = {
    tableId: "D04",
    apiId: "SA904",
    tableBadge: "D04",
    roomId: "904",
    hostId: 904,
    road: "莊",
    gameId: 130408297037824,
    resultKey: "130408297037824:莊",
    shoe: "13",
    round: 37,
    poker: JSON.stringify({ player: "5-Q-8", banker: "2-3" }),
    at: 1_700_000_000_000,
  };

  it("maps road / gameId / shoe / round into settlePending body", () => {
    const body = saWinReportToSettleBody(sample, "SA904");
    expect(body.table_id).toBe("SA904");
    expect(body.game_sn).toBe(130408297037824);
    expect(body.result_key).toBe("130408297037824:莊");
    expect(body.shoe).toBe("13");
    expect(body.round).toBe(37);
    expect(body.table_keys).toEqual(
      expect.arrayContaining(["SA904", "D04", "904"]),
    );
  });

  it("matches pending assist id across SA904 / D04 / roomId aliases", () => {
    expect(saWinReportTableMatches(sample, "SA904")).toBe(true);
    expect(saWinReportTableMatches(sample, "D04")).toBe(true);
    expect(saWinReportTableMatches(sample, "904")).toBe(true);
    expect(saWinReportTableMatches(sample, "D01")).toBe(false);
  });

  it("parses HAR GameResult into road + hand serial for the report", () => {
    const resultString = "3, 4, 50, 46, 2, 27, 41";
    const fresult = 7 | (1 << 5);
    const body = Buffer.alloc(16 + Buffer.byteLength(resultString) + 1);
    body.writeBigUInt64LE(130408297037824n, 0);
    body.writeBigUInt64LE(BigInt(fresult), 8);
    body.write(resultString, 16, "utf8");
    body.writeUInt8(0, 16 + Buffer.byteLength(resultString));
    const gr = parseScGameResult(body);
    expect(gr?.road).toBe("莊");
    expect(gr?.gameId).toBe(130408297037824);
    const settle = saWinReportToSettleBody(
      {
        ...sample,
        road: gr!.road!,
        gameId: gr!.gameId,
        resultKey: `${gr!.gameId}:${gr!.road}`,
        poker: gr!.poker,
      },
      "D04",
    );
    expect(settle.game_sn).toBe(gr!.gameId);
    expect(settle.result_key).toContain("莊");
  });
});
