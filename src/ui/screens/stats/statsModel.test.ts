import { describe, expect, it } from "vitest";
import type { StatsOverview } from "../../ports/stats";
import { addDays, buckets, calendarWeeks, change, dayProfile, firstWeekday, formatTime, fullness, parseRange, rangeDays, weekdays } from "./statsModel";

const t = (key: string, vars?: Record<string, unknown>) => `${key.split(".").pop()}:${Object.values(vars ?? {}).join(",")}`;

describe("ranges", () => {
  it("rolls back from today so the previous period has the same length", () => {
    expect(rangeDays("week", "2026-11-07", null)).toEqual({ from: "2026-11-01", to: "2026-11-07" });
    expect(rangeDays("month", "2026-11-07", null)).toEqual({ from: "2026-10-09", to: "2026-11-07" });
    expect(rangeDays("all", "2026-11-07", null)).toEqual({});
    expect(rangeDays("custom", "2026-11-07", { from: "2026-01-01", to: "2026-01-31" })).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("walks days across a clock change", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
  });

  it("falls back to a month for an unknown range", () => {
    expect(parseRange("nope")).toBe("month");
    expect(parseRange("year")).toBe("year");
  });
});

describe("words", () => {
  it("writes time from seconds to hours", () => {
    expect(formatTime(20_000, t)).toBe("seconds:20");
    expect(formatTime(23 * 60_000, t)).toBe("minutes:23");
    expect(formatTime(3 * 3_600_000, t)).toBe("hours:3");
    expect(formatTime(90 * 60_000, t)).toBe("hours_minutes:1,30");
    expect(formatTime(120.4 * 3_600_000, t)).toBe("hours:120");
  });

  it("compares with the previous period only when it has something", () => {
    expect(change(120, 100)).toBe(20);
    expect(change(50, 100)).toBe(-50);
    expect(change(50, 0)).toBeNull();
    expect(change(50, undefined)).toBeNull();
  });
});

describe("buckets", () => {
  const days = [
    { day: "2026-01-01", listenedMs: 100, plays: 1 },
    { day: "2026-01-09", listenedMs: 200, plays: 2 },
    { day: "2026-03-02", listenedMs: 300, plays: 3 },
  ];

  it("keeps days for a month, with the silent ones at zero", () => {
    const list = buckets(days, "2026-01-01", "2026-01-30", "en");
    expect(list).toHaveLength(30);
    expect(list[1].listenedMs).toBe(0);
    expect(list[8].plays).toBe(2);
  });

  it("adds days up to weeks for a year and to months for years", () => {
    const weeks = buckets(days, "2026-01-01", "2026-12-31", "en");
    expect(weeks).toHaveLength(53);
    expect(weeks[1].listenedMs).toBe(200);
    const months = buckets(days, "2024-01-01", "2026-12-31", "en");
    expect(months).toHaveLength(36);
    expect(months.find((bucket) => bucket.key === "2026-03")?.plays).toBe(3);
  });
});

describe("the calendar", () => {
  it("ends on the week of the last day and starts weeks where the locale does", () => {
    expect(firstWeekday("ru")).toBe(1);
    const sunday = calendarWeeks([], "2026-11-07", null, "en");
    expect(sunday).toHaveLength(53);
    expect(sunday.at(-1)?.[0].day).toBe("2026-11-01");
    const monday = calendarWeeks([], "2026-11-07", null, "ru");
    expect(monday.at(-1)?.[0].day).toBe("2026-11-02");
  });

  it("marks quartiles and what is outside the range", () => {
    const weeks = calendarWeeks(
      [
        { day: "2026-11-01", listenedMs: 10, plays: 1 },
        { day: "2026-11-02", listenedMs: 20, plays: 1 },
        { day: "2026-11-03", listenedMs: 30, plays: 1 },
        { day: "2026-11-04", listenedMs: 400, plays: 1 },
      ],
      "2026-11-05",
      "2026-11-03",
      "en",
    );
    const cells = weeks.flat();
    expect(cells.find((cell) => cell.day === "2026-11-04")?.level).toBe(4);
    expect(cells.find((cell) => cell.day === "2026-11-01")?.level).toBe(1);
    expect(cells.find((cell) => cell.day === "2026-11-05")?.level).toBe(0);
    expect(cells.find((cell) => cell.day === "2026-11-05")?.inRange).toBe(true);
    expect(cells.find((cell) => cell.day === "2026-11-01")?.inRange).toBe(false);
    expect(cells.find((cell) => cell.day === "2026-11-06")?.inRange).toBe(false);
  });
});

describe("the page's state", () => {
  const stats = (firstPlayedAt: string | null, listenedMs: number, active: number) =>
    ({
      firstPlayedAt,
      totals: { listenedMs },
      calendar: Array.from({ length: active }, (_, index) => ({ day: `2026-11-0${index + 1}`, listenedMs: 1, plays: 1 })),
    }) as unknown as StatsOverview;

  it("tells a new profile, a silent range, the first days and a history apart", () => {
    expect(fullness(stats(null, 0, 0))).toBe("never");
    expect(fullness(stats("2026-01-01T00:00:00.000Z", 0, 0))).toBe("silent");
    expect(fullness(stats("2026-01-01T00:00:00.000Z", 10, 2))).toBe("first");
    expect(fullness(stats("2026-01-01T00:00:00.000Z", 10, 7))).toBe("full");
  });

  it("splits the day into four parts", () => {
    const hours = Array.from({ length: 24 }, (_, hour) => (hour >= 18 ? 3 : hour < 6 ? 1 : 0));
    const profile = dayProfile(hours);
    expect(profile.map((item) => item.part)).toEqual(["night", "morning", "afternoon", "evening"]);
    expect(profile[3].share).toBeCloseTo(0.75);
  });

  it("orders weekdays by locale", () => {
    expect(weekdays("en")[0]).toEqual([0, "Sun"]);
    expect(weekdays("ru")[0][0]).toBe(1);
  });
});
