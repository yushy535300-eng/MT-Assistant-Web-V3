import { describe, expect, it } from "vitest";
import {
  isSaTableModeOpen,
  parseScGameRest,
  parseScInitBaccarat,
  SA_TABLE_MODE,
} from "../server/sa-protocol";

describe("SA open-desk filter helpers", () => {
  it("treats Open and Pause as 開桌", () => {
    expect(isSaTableModeOpen(SA_TABLE_MODE.OPEN)).toBe(true);
    expect(isSaTableModeOpen(SA_TABLE_MODE.PAUSE)).toBe(true);
    expect(isSaTableModeOpen(SA_TABLE_MODE.CLOSE)).toBe(false);
    expect(isSaTableModeOpen(SA_TABLE_MODE.INTERNAL_TEST)).toBe(false);
  });

  it("parses ScGameRest open/close toggle", () => {
    const b = Buffer.alloc(3);
    b.writeUInt16LE(901, 0);
    b.writeUInt8(SA_TABLE_MODE.CLOSE, 2);
    expect(parseScGameRest(b)).toEqual({ hostId: 901, onOrOff: SA_TABLE_MODE.CLOSE });
  });

  it("exposes InitBaccarat.rest TableMode", () => {
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
    u32(16384);
    u16(901);
    u32(16);
    u32(14);
    u8(SA_TABLE_MODE.OPEN); // Rest
    u8(1);
    u8(0);
    i64(0);
    u8(0);
    u8(0); // no hands
    u16(1);
    const init = parseScInitBaccarat(Buffer.concat(parts));
    expect(init?.hostId).toBe(901);
    expect(init?.rest).toBe(SA_TABLE_MODE.OPEN);
    expect(isSaTableModeOpen(init!.rest)).toBe(true);
  });
});
