import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SA_TABLE_LABELS, saTableLabel } from "../lib/sa-table-labels";

describe("sa-table-labels", () => {
  it("maps screenshot ground-truth D04 to hostId 904", () => {
    expect(SA_TABLE_LABELS["904"]).toBe("D04");
    expect(saTableLabel(904)).toBe("D04");
  });

  it("maps HAR D01–D04 rooms (dedf.har /rm/game/901..904 + join_host_id 904)", () => {
    expect(SA_TABLE_LABELS["901"]).toBe("D01");
    expect(SA_TABLE_LABELS["902"]).toBe("D02");
    expect(SA_TABLE_LABELS["903"]).toBe("D03");
    expect(SA_TABLE_LABELS["904"]).toBe("D04");
    expect(saTableLabel("901")).toBe("D01");
    expect(saTableLabel(904)).toBe("D04");
  });

  it("keeps server and lib label files in sync for D-series", () => {
    const server = JSON.parse(
      readFileSync(join(process.cwd(), "server/sa-table-labels.json"), "utf8"),
    );
    for (const id of ["901", "902", "903", "904", "905", "906", "907", "908", "909"]) {
      expect(server.labels[id]).toBe(SA_TABLE_LABELS[id]);
      expect(SA_TABLE_LABELS[id]).toMatch(/^D0\d$/);
    }
  });

  it("has short codes for C/M/A baccarat rooms", () => {
    expect(SA_TABLE_LABELS["871"]).toBe("C01");
    expect(SA_TABLE_LABELS["521"]).toBe("M01");
    expect(SA_TABLE_LABELS["601"]).toBe("A01");
    expect(Object.keys(SA_TABLE_LABELS).length).toBeGreaterThanOrEqual(28);
  });
});
