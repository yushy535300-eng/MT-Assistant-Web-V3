import { describe, expect, it } from "vitest";
import {
  buildPsLogin,
  extractSaDealCards,
  formatSaPokerJson,
  parseFrame,
  parseScGameResult,
  parseScGameState,
  parseScInitBaccarat,
  roadFromFResult,
  wrapCommand,
  SA_CMD,
} from "../server/sa-protocol";

describe("sa-protocol", () => {
  it("wraps and parses command frames", () => {
    const payload = Buffer.from([1, 2, 3]);
    const frame = wrapCommand(30501, payload);
    expect(frame[0]).toBe(0xaa);
    const parsed = parseFrame(frame);
    expect(parsed?.cmdId).toBe(30501);
    expect(Buffer.compare(parsed!.payload, payload)).toBe(0);
  });

  it("builds PsLogin with website bet source", () => {
    const pkt = buildPsLogin("ABC123TOKEN");
    const parsed = parseFrame(pkt);
    expect(parsed?.cmdId).toBe(SA_CMD.PS_LOGIN);
    expect(parsed!.payload.toString("utf8")).toContain("ABC123TOKEN");
  });

  it("decodes new-format FResult bits", () => {
    // bits 0-2 marker + bit4 player
    expect(roadFromFResult(7 | (1 << 4))).toBe("閒");
    expect(roadFromFResult(7 | (1 << 5))).toBe("莊");
    expect(roadFromFResult(7 | (1 << 3))).toBe("和");
  });

  it("parses GameStart hostId→gameId binding", async () => {
    const { parseScGameStart } = await import("../server/sa-protocol");
    const b = Buffer.alloc(18);
    b.writeUInt16LE(521, 0);
    b.writeBigUInt64LE(123456789n, 2);
    b.writeUInt32LE(21005, 10);
    b.writeUInt32LE(14, 14);
    const start = parseScGameStart(b);
    expect(start?.hostId).toBe(521);
    expect(start?.gameId).toBe(123456789);
    expect(start?.gameCount).toBe(21005);
  });

  it("parses InitBaccarat hands from synthetic payload", () => {
    // Minimal InitBaccarat: BaseInformation + 1 OldResult hand
    const parts: Buffer[] = [];
    const push = (b: Buffer) => parts.push(b);
    const u8 = (v: number) => {
      const b = Buffer.alloc(1);
      b.writeUInt8(v, 0);
      push(b);
    };
    const u16 = (v: number) => {
      const b = Buffer.alloc(2);
      b.writeUInt16LE(v, 0);
      push(b);
    };
    const u32 = (v: number) => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(v, 0);
      push(b);
    };
    const i64 = (v: number) => {
      const b = Buffer.alloc(8);
      b.writeBigInt64LE(BigInt(v), 0);
      push(b);
    };
    const u64 = (v: number) => {
      const b = Buffer.alloc(8);
      b.writeBigUInt64LE(BigInt(v), 0);
      push(b);
    };
    // BaseInformation
    u32(16384); // HallID
    u16(903); // HostID
    u32(16); // CountDown
    u32(14); // RemainTime
    u8(0);
    u8(1);
    u8(0);
    i64(0);
    u8(0);
    // OldResult size=1
    u8(1);
    i64(12345); // GameID
    u32(70001); // GameCount shoe7 round1
    u64(7 | (1 << 5)); // banker win
    u8(2); // player cards
    u8(10);
    u8(2);
    u8(2); // banker cards
    u8(18);
    u8(8);
    u16(1); // CurrentState
    // CurrentResult + GoodRoad omitted — parser stops after hands
    const payload = Buffer.concat(parts);
    const init = parseScInitBaccarat(payload);
    expect(init?.hostId).toBe(903);
    expect(init?.hands.length).toBe(1);
    expect(init?.hands[0].result).toBe("莊");
    expect(init?.hands[0].gameCount).toBe(70001);
    // Init OldResult card bytes → float poker (1-based ids in binary layout)
    expect(init?.hands[0].poker).toBe(
      JSON.stringify({ player: "10-2", banker: "5-8" }),
    );
  });

  it("parses D01 screenshot hand CSV into show_poker JSON (2♠4♥ / 3♦6♠)", () => {
    // Suit order ♠♥♦♣, 0-based: 2♠=1, 4♥=16, 3♦=28, 6♠=5 → 闲6 庄9
    const resultString = "2, 1, 16, 2, 28, 5";
    const fresult = 7 | (1 << 5); // banker
    const body = Buffer.alloc(16 + Buffer.byteLength(resultString) + 1);
    body.writeBigUInt64LE(133175732359168n, 0);
    body.writeBigUInt64LE(BigInt(fresult), 8);
    body.write(resultString, 16, "utf8");
    body.writeUInt8(0, 16 + Buffer.byteLength(resultString));
    const gr = parseScGameResult(body);
    expect(gr?.road).toBe("莊");
    expect(gr?.playerCards).toEqual([1, 16]);
    expect(gr?.bankerCards).toEqual([28, 5]);
    expect(gr?.poker).toBe(JSON.stringify({ player: "2-4", banker: "3-6" }));
  });

  it("parses HAR GameResult CSV cards as 0-based poker JSON", () => {
    // D04 from ws2…3596: `3, 4, 50, 46, 2, 27, 41` → 庄
    // 0-based faces: player 5-Q-8 banker 2-3
    const resultString = "3, 4, 50, 46, 2, 27, 41";
    const fresult = 7 | (1 << 5); // banker
    const body = Buffer.alloc(16 + Buffer.byteLength(resultString) + 1);
    body.writeBigUInt64LE(130408297037824n, 0);
    body.writeBigUInt64LE(BigInt(fresult), 8);
    body.write(resultString, 16, "utf8");
    body.writeUInt8(0, 16 + Buffer.byteLength(resultString));
    const gr = parseScGameResult(body);
    expect(gr?.road).toBe("莊");
    expect(gr?.playerCards).toEqual([4, 50, 46]);
    expect(gr?.bankerCards).toEqual([27, 41]);
    expect(gr?.poker).toBe(JSON.stringify({ player: "5-Q-8", banker: "2-3" }));
  });

  it("parses HAR GameState progressive deal CSV into live poker", () => {
    // Hex from D04 deal step: remain=42 state=7 detail=`2, 4, 50, 2, 27, 41`
    const hex = "2a0080380c9b7600000700322c20342c2035302c20322c2032372c20343100";
    const payload = Buffer.from(hex, "hex");
    const st = parseScGameState(payload);
    expect(st?.gameId).toBe(130408297037824);
    expect(st?.hostId).toBeUndefined();
    expect(st?.detail).toBe("2, 4, 50, 2, 27, 41");
    expect(st?.playerCards).toEqual([4, 50]);
    expect(st?.bankerCards).toEqual([27, 41]);
    expect(st?.poker).toBe(JSON.stringify({ player: "5-Q", banker: "2-3" }));
  });

  it("extracts partial deal before both sides have two cards", () => {
    const step1 = extractSaDealCards("1, 4, 0");
    expect(step1).toEqual({
      playerCards: [4],
      bankerCards: [],
      oneBased: false,
    });
    expect(formatSaPokerJson(step1!.playerCards, step1!.bankerCards, false)).toBe(
      JSON.stringify({ player: "5", banker: "" }),
    );
    const step2 = extractSaDealCards("1, 4, 1, 27");
    expect(step2?.playerCards).toEqual([4]);
    expect(step2?.bankerCards).toEqual([27]);
  });

  it("bumps SA float round on GameResult when GameStart count missing", async () => {
    const { nextSaRoundAfterHand, mergeSaInitRound } = await import(
      "../server/sa-protocol"
    );
    // Roads advanced past Init round 32 with no gameCount → +1 each hand.
    expect(nextSaRoundAfterHand(32)).toBe(33);
    expect(nextSaRoundAfterHand(33)).toBe(34);
    expect(nextSaRoundAfterHand(36)).toBe(37);
    // Absolute gameCount wins without double-bump after GameStart.
    expect(nextSaRoundAfterHand(37, 80037)).toBe(37);
    expect(nextSaRoundAfterHand(32, 80037)).toBe(37);
    // Stale Init must not pull live round backward on same shoe.
    expect(mergeSaInitRound(37, "8", 8, 32)).toBe(37);
    expect(mergeSaInitRound(10, "7", 8, 1)).toBe(1);
  });

});
