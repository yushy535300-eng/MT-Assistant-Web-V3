import type { RoadResult } from "./road-live-state";

export type RoadMark = {
  row: number;
  col: number;
  result: RoadResult;
  filled?: boolean;
  tieCount?: number;
  baseCol?: number;
  runIndex?: number;
  isNewColumn?: boolean;
};

const cellKey = (col: number, row: number) => `${col}:${row}`;

export function buildRoadWindow(marks: RoadMark[], columns: number): RoadMark[] {
  const lastCol = Math.max(-1, ...marks.map((mark) => mark.col));
  const start = Math.max(0, lastCol - columns + 1);
  return marks.map((mark) => ({ ...mark, col: mark.col - start })).filter((mark) => mark.col >= 0 && mark.col < columns);
}

type BigRoadState = { marks: RoadMark[]; columns: Array<Array<boolean>> };

function buildBigRoadState(results: RoadResult[]): BigRoadState {
  const marks: RoadMark[] = [];
  const occupied = new Set<string>();
  const columns: Array<Array<boolean>> = [];
  let previous: "莊" | "閒" | null = null;
  let baseCol = -1;
  let last: RoadMark | null = null;
  let pendingTies = 0;
  let runIndex = 0;

  for (const result of results) {
    if (result === "和") {
      if (last) last.tieCount = (last.tieCount ?? 0) + 1;
      else pendingTies += 1;
      continue;
    }

    const newRun = previous !== result;
    let col: number;
    let row: number;

    if (newRun) {
      baseCol += 1;
      while (occupied.has(cellKey(baseCol, 0))) baseCol += 1;
      col = baseCol;
      row = 0;
      runIndex = 0;
      columns[baseCol] ??= [];
    } else {
      runIndex += 1;
      const down = (last?.row ?? 0) + 1;
      if (down <= 5 && last && !occupied.has(cellKey(last.col, down))) {
        col = last.col;
        row = down;
      } else {
        col = (last?.col ?? baseCol) + 1;
        row = last?.row ?? 0;
        while (occupied.has(cellKey(col, row))) col += 1;
      }
    }

    const mark: RoadMark = { row, col, result, baseCol, runIndex, isNewColumn: newRun };
    if (pendingTies) {
      mark.tieCount = pendingTies;
      pendingTies = 0;
    }
    occupied.add(cellKey(col, row));
    columns[baseCol] ??= [];
    columns[baseCol][runIndex] = true;
    marks.push(mark);
    last = mark;
    previous = result;
  }
  return { marks, columns };
}

function placeRoad(sequence: RoadResult[], filled: boolean): RoadMark[] {
  const marks: RoadMark[] = [];
  const occupied = new Set<string>();
  let previous: RoadResult | null = null;
  let last: RoadMark | null = null;

  for (const result of sequence) {
    let col = 0;
    let row = 0;
    if (!last || result !== previous) {
      col = last ? last.col + 1 : 0;
      while (occupied.has(cellKey(col, 0))) col += 1;
    } else {
      const down = last.row + 1;
      if (down <= 5 && !occupied.has(cellKey(last.col, down))) {
        col = last.col;
        row = down;
      } else {
        col = last.col + 1;
        row = last.row;
        while (occupied.has(cellKey(col, row))) col += 1;
      }
    }
    const mark: RoadMark = { row, col, result, filled };
    occupied.add(cellKey(col, row));
    marks.push(mark);
    last = mark;
    previous = result;
  }
  return marks;
}

export function buildBigRoad(results: RoadResult[]): RoadMark[] {
  return buildBigRoadState(results).marks;
}

/**
 * Standard derived-road comparison based on the Big Road's logical columns.
 * offset: 1 Big Eye Boy, 2 Small Road, 3 Cockroach Pig.
 * 莊/閒 here mean red/blue display only.
 */
export function buildDerivedRoad(results: RoadResult[], offset: 1 | 2 | 3, filled: boolean): RoadMark[] {
  const { marks, columns } = buildBigRoadState(results);
  const colors: RoadResult[] = [];

  for (const mark of marks) {
    const c = mark.baseCol ?? 0;
    const depth = mark.runIndex ?? 0;
    let color: RoadResult | null = null;

    if (mark.isNewColumn) {
      // At the first bead of a new column, compare the previous column with
      // the column offset+1 positions back.
      if (c >= offset + 1) {
        const a = columns[c - 1]?.length ?? 0;
        const b = columns[c - offset - 1]?.length ?? 0;
        color = a === b ? "莊" : "閒";
      }
    } else {
      const ref = c - offset;
      if (ref >= 0 && depth >= 1) {
        const hasSameDepth = Boolean(columns[ref]?.[depth]);
        const hasAbove = Boolean(columns[ref]?.[depth - 1]);
        color = hasSameDepth === hasAbove ? "莊" : "閒";
      }
    }
    if (color) colors.push(color);
  }

  return placeRoad(colors, filled);
}

export type AskRoadPrediction = {
  bigEye: RoadResult | null;
  small: RoadResult | null;
  cockroach: RoadResult | null;
};

function nextDerivedColor(results: RoadResult[], outcome: "莊" | "閒", offset: 1 | 2 | 3, filled: boolean): RoadResult | null {
  const before = buildDerivedRoad(results, offset, filled);
  const after = buildDerivedRoad([...results, outcome], offset, filled);
  return after.length > before.length ? after.at(-1)?.result ?? null : null;
}

export function buildAskRoad(results: RoadResult[]): { banker: AskRoadPrediction; player: AskRoadPrediction } {
  const predict = (outcome: "莊" | "閒"): AskRoadPrediction => ({
    bigEye: nextDerivedColor(results, outcome, 1, false),
    small: nextDerivedColor(results, outcome, 2, true),
    cockroach: nextDerivedColor(results, outcome, 3, false),
  });
  return { banker: predict("莊"), player: predict("閒") };
}

/**
 * Six columns x six rows, top-to-bottom then left-to-right.
 * After 36 results the oldest whole column disappears, so the latest result
 * starts/continues in the rightmost visible six-column window.
 */
export function buildBeadWindow(results: RoadResult[]) {
  if (results.length <= 36) return results;
  const overflow = results.length - 36;
  const columnsToDrop = Math.ceil(overflow / 6);
  const start = columnsToDrop * 6;
  return results.slice(start, start + 36);
}

export function buildBeadGrid(results: RoadResult[]): Array<RoadResult | undefined> {
  const window = buildBeadWindow(results);
  return Array.from({ length: 36 }, (_, slot) => {
    const row = Math.floor(slot / 6);
    const col = slot % 6;
    return window[col * 6 + row];
  });
}
