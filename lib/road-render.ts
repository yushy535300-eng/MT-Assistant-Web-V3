import type { RoadResult } from "./road-live-state";

/**
 * Derived-road `莊`/`閒` are display colors only: red / blue, not game outcomes.
 */
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

/** Returns a right-aligned visible window while retaining a road's six-row coordinates. */
export function buildRoadWindow(marks: RoadMark[], columns: number): RoadMark[] {
  const lastCol = Math.max(-1, ...marks.map((mark) => mark.col));
  const start = Math.max(0, lastCol - columns + 1);
  return marks.map((mark) => ({ ...mark, col: mark.col - start })).filter((mark) => mark.col >= 0 && mark.col < columns);
}

type BigRoadState = { marks: RoadMark[]; runLengths: number[] };

const cellKey = (col: number, row: number) => `${col}:${row}`;

function buildBigRoadState(results: RoadResult[]): BigRoadState {
  const marks: RoadMark[] = [];
  const occupied = new Set<string>();
  const runLengths: number[] = [];
  let previous: RoadResult | null = null;
  let baseCol = -1;
  let last: RoadMark | null = null;
  let pendingTies = 0;

  for (const result of results) {
    if (result === "和") {
      if (last) last.tieCount = (last.tieCount ?? 0) + 1;
      else pendingTies += 1;
      continue;
    }

    const isNewColumn = previous !== result;
    let col: number;
    let row: number;
    let runIndex: number;

    if (isNewColumn) {
      baseCol += 1;
      while (occupied.has(cellKey(baseCol, 0))) baseCol += 1;
      col = baseCol;
      row = 0;
      runIndex = 0;
      runLengths[baseCol] = 1;
    } else {
      runIndex = runLengths[baseCol];
      runLengths[baseCol] += 1;
      const downRow = (last?.row ?? 0) + 1;
      if (downRow <= 5 && !occupied.has(cellKey(last!.col, downRow))) {
        col = last!.col;
        row = downRow;
      } else {
        col = last!.col + 1;
        row = last!.row;
        while (occupied.has(cellKey(col, row))) col += 1;
      }
    }

    const mark: RoadMark = { row, col, result, baseCol, runIndex, isNewColumn };
    if (pendingTies > 0) {
      mark.tieCount = pendingTies;
      pendingTies = 0;
    }
    occupied.add(cellKey(col, row));
    marks.push(mark);
    last = mark;
    previous = result;
  }
  return { marks, runLengths };
}

function placeRoad(sequence: RoadResult[], filled: boolean): RoadMark[] {
  const marks: RoadMark[] = [];
  const occupied = new Set<string>();
  let previous: RoadResult | null = null;
  let last: RoadMark | null = null;

  for (const result of sequence) {
    let col: number;
    let row: number;
    if (result !== previous || !last) {
      col = last ? last.col + 1 : 0;
      row = 0;
      while (occupied.has(cellKey(col, row))) col += 1;
    } else {
      const downRow = last.row + 1;
      if (downRow <= 5 && !occupied.has(cellKey(last.col, downRow))) {
        col = last.col;
        row = downRow;
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

/** Six-row Big Road with tie annotations, dragon tails and occupied-cell turns. */
export function buildBigRoad(results: RoadResult[]): RoadMark[] {
  return buildBigRoadState(results).marks;
}

/**
 * Big Eye Boy / Small Road / Cockroach Road. Offset is respectively 1 / 2 / 3.
 * The colors are encoded as `莊` (red) and `閒` (blue) for the shared renderer.
 */
export function buildDerivedRoad(results: RoadResult[], offset: 1 | 2 | 3, filled: boolean): RoadMark[] {
  const { marks, runLengths } = buildBigRoadState(results);
  const colors: RoadResult[] = [];

  for (const mark of marks) {
    const baseCol = mark.baseCol ?? mark.col;
    const depth = mark.runIndex ?? mark.row;
    let color: RoadResult | null = null;

    if (mark.isNewColumn) {
      // New Big Road column: compare the just-finished run with the lookback run.
      if (baseCol >= offset + 1) {
        color = runLengths[baseCol - 1] === runLengths[baseCol - offset - 1] ? "莊" : "閒";
      }
    } else {
      // Same Big Road run: compare the reference column's target cell with the one above it.
      const referenceCol = baseCol - offset;
      if (referenceCol >= 0 && depth >= 1) {
        const currentFilled = (runLengths[referenceCol] ?? 0) > depth;
        const aboveFilled = (runLengths[referenceCol] ?? 0) > depth - 1;
        color = currentFilled === aboveFilled ? "莊" : "閒";
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

/**
 * 莊問路／閒問路：各自把下一手暫時落在同一張 Big Road，
 * 只回傳該假設下三種下路新增的一筆紅／藍標記。
 */
export function buildAskRoad(results: RoadResult[]): { banker: AskRoadPrediction; player: AskRoadPrediction } {
  const predict = (outcome: "莊" | "閒"): AskRoadPrediction => ({
    bigEye: nextDerivedColor(results, outcome, 1, false),
    small: nextDerivedColor(results, outcome, 2, true),
    cockroach: nextDerivedColor(results, outcome, 3, false),
  });
  return { banker: predict("莊"), player: predict("閒") };
}

export function buildBeadWindow(results: RoadResult[]) {
  return results.slice(-36);
}

/**
 * Converts the latest 36 outcomes into row-major screen slots while preserving
 * Bead Plate's top-to-bottom, then left-to-right opening order.
 */
export function buildBeadGrid(results: RoadResult[]): Array<RoadResult | undefined> {
  const window = buildBeadWindow(results);
  return Array.from({ length: 36 }, (_, slot) => {
    const row = Math.floor(slot / 6);
    const col = slot % 6;
    return window[col * 6 + row];
  });
}
