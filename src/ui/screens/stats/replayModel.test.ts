import { describe, expect, it } from "vitest";
import { arcPath, artistArcs, dayRows, parsePeriod, pastPeriods, periodName, periodOf } from "./replayModel";

const TODAY = "2026-11-24";

describe("periods", () => {
  it("follow the calendar, and weeks start on the locale's first weekday", () => {
    expect(periodOf("month", TODAY, "en")).toEqual({ kind: "month", from: "2026-11-01", to: "2026-11-30" });
    expect(periodOf("year", TODAY, "en")).toEqual({ kind: "year", from: "2026-01-01", to: "2026-12-31" });
    expect(periodOf("week", TODAY, "ru").from).toBe("2026-11-23");
    expect(periodOf("week", TODAY, "en").from).toBe("2026-11-22");
  });

  it("a wrong or future date opens the current period", () => {
    for (const at of ["2026-13-40", "soon", "2027-01-01", null]) {
      expect(parsePeriod("month", at, TODAY, "en").from).toBe("2026-11-01");
    }
    expect(parsePeriod("month", "2026-02-14", TODAY, "en")).toEqual({ kind: "month", from: "2026-02-01", to: "2026-02-28" });
    expect(parsePeriod("nonsense", null, TODAY, "en").kind).toBe("month");
  });

  it("go back no further than the first play", () => {
    expect(pastPeriods("month", TODAY, "2026-09-30", "en").map((period) => period.from)).toEqual(["2026-11-01", "2026-10-01", "2026-09-01"]);
    expect(pastPeriods("month", TODAY, null, "en")).toHaveLength(1);
    expect(pastPeriods("all", TODAY, "2020-01-01", "en")).toEqual([]);
    expect(pastPeriods("week", TODAY, "2020-01-01", "en")).toHaveLength(8);
  });

  it("are named in the reader's language, the year only when it is another one", () => {
    expect(periodName(periodOf("month", TODAY, "en"), TODAY, "en")).toBe("November");
    expect(periodName(periodOf("month", TODAY, "ru"), TODAY, "ru")).toBe("Ноябрь");
    expect(periodName(periodOf("month", TODAY, "ru"), TODAY, "ru", true)).toBe("ноябрь");
    expect(periodName(periodOf("month", "2025-03-02", "en"), TODAY, "en")).toBe("March 2025");
    expect(periodName(periodOf("year", TODAY, "en"), TODAY, "en")).toBe("2026");
  });
});

describe("artist arcs", () => {
  const day = (at: string, listenedMs: number) => ({ day: at, listenedMs, plays: 1 });

  it("span the first to the last day and rise where the listening was thickest", () => {
    const [arc] = artistArcs([{ id: "a", days: [day("2026-11-01", 10), day("2026-11-10", 900), day("2026-11-30", 10)] }], "2026-11-01", "2026-11-30");
    expect(arc.from).toBe(0);
    expect(arc.to).toBe(1);
    expect(arc.peak).toBeCloseTo(9.5 / 30);
    expect(arc.height).toBe(1);
  });

  it("keep a one day artist visible, inside the plot, and skip a silent one", () => {
    const arcs = artistArcs(
      [
        { id: "last", days: [day("2026-11-30", 10)] },
        { id: "silent", days: [] },
      ],
      "2026-11-01",
      "2026-11-30",
    );
    expect(arcs).toHaveLength(1);
    expect(arcs[0].to).toBeLessThanOrEqual(1);
    expect(arcs[0].to - arcs[0].from).toBeGreaterThan(0.05);
    expect(arcs[0].peak).toBeGreaterThan(arcs[0].from);
    expect(arcs[0].peak).toBeLessThan(arcs[0].to);
    expect(arcPath(arcs[0], 100, 50)).not.toContain("NaN");
  });
});

describe("day rows", () => {
  const run = { from: "2026-11-02", to: "2026-11-03" };
  const days = [
    { day: "2026-11-02", listenedMs: 10, plays: 1 },
    { day: "2026-11-03", listenedMs: 900, plays: 9 },
  ];

  it("a month is calendar weeks with the run, the shares and the days to come", () => {
    const rows = dayRows(days, run, { from: "2026-11-01", to: "2026-11-30" }, TODAY, "ru");
    expect(rows.map((row) => row.days.length)).toEqual([7, 7, 7, 7, 7, 1]);
    expect(rows[0].days.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    const marks = rows.flatMap((row) => row.days.filter((mark) => mark !== null));
    expect(marks).toHaveLength(30);
    expect(marks.filter((mark) => mark.run)).toHaveLength(2);
    expect(marks.slice(0, 4).map((mark) => mark.share)).toEqual([0, 10 / 900, 1, 0]);
    expect(marks.filter((mark) => mark.future)).toHaveLength(6);
  });

  it("a week is one row and a year is twelve", () => {
    expect(dayRows(days, run, periodOf("week", TODAY, "en"), TODAY, "en")).toHaveLength(1);
    const rows = dayRows(days, run, { from: "2026-01-01", to: "2026-12-31" }, TODAY, "en");
    expect(rows).toHaveLength(12);
    expect(rows[1].days).toHaveLength(28);
  });
});
