import { describe, expect, it } from "vitest";
import {
  SA_CMD,
  SA_BET_RECORD_RECENT_ROUND,
  buildPsBetRecordSummaryQuery,
  buildPsBetRecordSummaryQueryUtc,
  parseAllFrames,
  parseSpBetRecordSummaryQuery,
  sumSaBetRecordTodayPnl,
  saBetLogTodayRange,
  buildPsBetLogSummaryQuery,
  parseSpBetLogSummaryQuery,
  pickSaTodayResultAmount,
} from "../server/sa-protocol";

function putI64(buf: Buffer, offset: number, v: number | bigint) {
  buf.writeBigInt64LE(BigInt(v), offset);
}
function putU64(buf: Buffer, offset: number, v: number | bigint) {
  buf.writeBigUInt64LE(BigInt(v), offset);
}

/** Build one CMDBetRecordSummary binary child matching vendor layout. */
function encodeBetRecordSummary(opts: {
  reportTimeMs: number;
  gameId: number;
  hostId: number;
  resultAmountRaw: number;
  betAmountRaw?: number;
}) {
  const result = Buffer.from("1,1\0", "utf8");
  const remark = Buffer.from("\0", "utf8");
  // fixed fields before Result string: ReportTime(8)+FGameID(8)+HostID(2)+GameCount(4)+GameType(8)+State(1)=31
  const fixedBefore = Buffer.alloc(31);
  putI64(fixedBefore, 0, opts.reportTimeMs);
  putU64(fixedBefore, 8, opts.gameId);
  fixedBefore.writeUInt16LE(opts.hostId, 16);
  fixedBefore.writeUInt32LE(10001, 18); // GameCount
  putI64(fixedBefore, 22, 1); // GameType
  fixedBefore.writeUInt8(3, 30); // State settled
  const after = Buffer.alloc(32);
  putI64(after, 0, 0); // WinSlot
  putI64(after, 8, opts.betAmountRaw ?? 0);
  putI64(after, 16, 0); // Rolling
  putI64(after, 24, opts.resultAmountRaw);
  return Buffer.concat([fixedBefore, result, after, remark]);
}

describe("SA official BetRecord summary (今日輸贏 = 投注記錄)", () => {
  it("builds PS_BET_RECORD_SUMMARY_QUERY_UTC 55112 like vendor SPA", () => {
    const { fromMs, toMs, day } = saBetLogTodayRange(
      new Date("2026-09-23T16:30:00.000Z"),
    );
    expect(day).toBe("2026-09-24");
    expect(fromMs).toBe(Date.parse("2026-09-24T00:00:00+08:00"));
    expect(toMs).toBe(Date.parse("2026-09-24T23:59:59.999+08:00"));
    const frame = buildPsBetRecordSummaryQueryUtc(fromMs, toMs);
    const parsed = parseAllFrames(frame);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].cmdId).toBe(SA_CMD.PS_BET_RECORD_SUMMARY_QUERY_UTC);
    expect(SA_CMD.PS_BET_RECORD_SUMMARY_QUERY_UTC).toBe(55112);
    expect(SA_BET_RECORD_RECENT_ROUND).toBe(10);
    const pl = parsed[0].payload;
    expect(pl.readBigUInt64LE(0)).toBe(BigInt(fromMs));
    expect(pl.readBigUInt64LE(8)).toBe(BigInt(toMs));
    expect(pl.readUInt32LE(16)).toBe(10);
  });

  it("legacy string-date builder still encodes 55106", () => {
    const { fromDate, toDate } = saBetLogTodayRange(
      new Date("2026-09-23T16:30:00.000Z"),
    );
    const frame = buildPsBetRecordSummaryQuery(fromDate, toDate);
    const parsed = parseAllFrames(frame);
    expect(parsed[0].cmdId).toBe(SA_CMD.PS_BET_RECORD_SUMMARY_QUERY);
    expect(parsed[0].payload.readUInt32LE(parsed[0].payload.length - 4)).toBe(
      10,
    );
  });

  it("sums today's ResultAmount/100 like BetRecord date-row 贏/輸", () => {
    // Taipei 2026-09-24 15:40 ≈ 2026-09-24T07:40:00Z
    const t1 = Date.parse("2026-09-24T07:40:13.000Z");
    const t2 = Date.parse("2026-09-24T07:40:47.000Z");
    const child1 = encodeBetRecordSummary({
      reportTimeMs: t1,
      gameId: 1001,
      hostId: 901,
      resultAmountRaw: 560_500, // +5605.00
      betAmountRaw: 590_000,
    });
    const child2 = encodeBetRecordSummary({
      reportTimeMs: t2,
      gameId: 1002,
      hostId: 901,
      resultAmountRaw: 1_140_000, // +11400.00
      betAmountRaw: 1_200_000,
    });
    // Other day must not count
    const other = encodeBetRecordSummary({
      reportTimeMs: Date.parse("2026-09-23T10:00:00.000Z"),
      gameId: 99,
      hostId: 1,
      resultAmountRaw: 9_999_900,
    });
    const payload = Buffer.alloc(4 + child1.length + child2.length + other.length);
    payload.writeUInt32LE(3, 0);
    child1.copy(payload, 4);
    child2.copy(payload, 4 + child1.length);
    other.copy(payload, 4 + child1.length + child2.length);

    const rows = parseSpBetRecordSummaryQuery(payload);
    expect(rows.length).toBe(3);
    expect(rows[0].reportDate).toBe("2026-09-24");
    // 5605 + 11400 = 17005 — same as user BetRecord date-row
    expect(sumSaBetRecordTodayPnl(rows, "2026-09-24")).toBe(17005);
    expect(sumSaBetRecordTodayPnl(rows, "2026-09-25")).toBe(0);
  });

  it("returns 0 for empty Bet[] (new day / no bets)", () => {
    const payload = Buffer.alloc(4);
    payload.writeUInt32LE(0, 0);
    expect(parseSpBetRecordSummaryQuery(payload)).toEqual([]);
    expect(sumSaBetRecordTodayPnl([], "2026-09-24")).toBe(0);
  });
});

describe("legacy BetLog summary still parses", () => {
  it("parses SP_BET_LOG_SUMMARY_QUERY ResultAmount/100", () => {
    const date = Buffer.from("2026-09-24\0", "utf8");
    const amounts = Buffer.alloc(24);
    amounts.writeBigInt64LE(BigInt(1_700_500), 0);
    amounts.writeBigInt64LE(BigInt(1_840_000), 8);
    amounts.writeBigInt64LE(BigInt(1_840_000), 16);
    const payload = Buffer.alloc(4 + date.length + amounts.length);
    payload.writeUInt32LE(1, 0);
    date.copy(payload, 4);
    amounts.copy(payload, 4 + date.length);
    const rows = parseSpBetLogSummaryQuery(payload);
    expect(pickSaTodayResultAmount(rows, "2026-09-24")).toBe(17005);
    const frame = buildPsBetLogSummaryQuery(
      "2026-09-24 00:00:00",
      "2026-09-24 23:59:59",
    );
    expect(parseAllFrames(frame)[0].cmdId).toBe(SA_CMD.PS_BET_LOG_SUMMARY_QUERY);
  });
});
