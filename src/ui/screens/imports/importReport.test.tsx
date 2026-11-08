// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import type { CatalogTrack, ImportSummary, ReportRow, RowsPage } from "../../ports/imports";
import { ImportReport, type ReportPorts } from "./ImportReport";

vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const track = (id: string, title = "Paper Moons"): CatalogTrack => ({
  id,
  title,
  artists: [{ id: "UC1", name: "Mira Holt" }],
  durationMs: 201_000,
});

const SUMMARY: ImportSummary = {
  id: "i1",
  sourceKind: "spotify-csv",
  label: "Northbound",
  targetKind: "playlist",
  targetId: "p1",
  createdAt: "2026-10-31T10:00:00Z",
  status: "done",
  total: 3,
  done: 3,
  needsReview: 2,
  counts: { exact: 0, likely: 1, check: 1, missing: 1, already: 0 },
};

const MISSING: ReportRow = {
  id: 1,
  position: 0,
  source: { title: "Paper Moons", artists: ["Mira Holt"], durationMs: 201_000 },
  label: "missing",
  reason: "duration_mismatch",
  durationDiffMs: 21_000,
  track: track("a"),
  candidates: [track("a"), track("b", "Paper Moons (Live)")],
};
const CHECK: ReportRow = {
  id: 2,
  position: 1,
  source: { title: "Glass River", artists: ["Nadia Rowe"] },
  label: "check",
  reason: "matched",
  track: track("c", "Glass River"),
  candidates: [track("c", "Glass River")],
};

function fakePorts(pages: Record<string, RowsPage>): ReportPorts & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    rows: vi.fn(async (_id: string, filter: string, cursor?: string) => {
      calls.push(`${filter}:${cursor ?? ""}`);
      return pages[`${filter}:${cursor ?? ""}`] ?? { items: [] };
    }),
    decide: vi.fn(async (_id: string, rowId: number, decision: ReportRow["decision"], picked?: CatalogTrack) => ({
      ...(rowId === 1 ? MISSING : CHECK),
      decision,
      ...(picked ? { track: picked } : {}),
    })),
    bulk: vi.fn(async () => SUMMARY),
    refresh: vi.fn(async () => {}),
    dismiss: vi.fn(async () => {}),
  };
}

async function mount(ports: ReportPorts, summary = SUMMARY) {
  const onClose = vi.fn();
  await act(async () => {
    root.render(<ImportReport open onClose={onClose} summary={summary} ports={ports} />);
  });
  return onClose;
}

const buttons = (name: string) => [...document.querySelectorAll("button")].filter((b) => b.textContent === name);
const click = async (element: HTMLElement) => {
  await act(async () => {
    element.click();
  });
};

describe("ImportReport", () => {
  it("opens on the rows that need a look, with the honest line and plain reasons", async () => {
    const ports = fakePorts({ "review:": { items: [MISSING, CHECK] } });
    await mount(ports);
    expect(ports.calls).toEqual(["review:"]);
    expect(document.body.textContent).toContain("ui.imports.honesty");
    expect(document.body.textContent).toContain('ui.imports.summary.review {"count":2}');
    expect(document.body.textContent).toContain('ui.imports.reason.length_differs {"seconds":21}');
    expect(document.body.textContent).toContain("Paper Moons · Mira Holt · 3:21");
  });

  it("applies Use this and refreshes the summary", async () => {
    const ports = fakePorts({ "review:": { items: [MISSING] } });
    await mount(ports);
    await click(buttons("ui.imports.action.use")[0]);
    expect(ports.decide).toHaveBeenCalledWith("i1", 1, "use", undefined);
    expect(ports.refresh).toHaveBeenCalledWith("i1");
    expect(document.body.textContent).toContain("ui.imports.decision.added");
  });

  it("picks another candidate, never the current match", async () => {
    const ports = fakePorts({ "review:": { items: [MISSING] } });
    await mount(ports);
    await click(buttons("ui.imports.action.pick")[0]);
    const choices = [...document.querySelectorAll("ul ul button")].map((b) => b.textContent);
    expect(choices).toEqual(["Paper Moons (Live) · Mira Holt · 3:21"]);
    await click(document.querySelector("ul ul button") as HTMLElement);
    expect(ports.decide).toHaveBeenCalledWith("i1", 1, "pick", track("b", "Paper Moons (Live)"));
  });

  it("finds a song by hand for a row and files the pick", async () => {
    const ports = fakePorts({ "review:": { items: [MISSING] } });
    const found = track("z", "Paper Moons (Demo)");
    ports.search = vi.fn(async () => [found]);
    await mount(ports);
    await click(buttons("ui.imports.action.pick")[0]);
    const field = document.querySelector<HTMLInputElement>("ul ul input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "paper moons demo");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(ports.search).toHaveBeenCalledWith("paper moons demo");
    const choices = [...document.querySelectorAll("ul ul button")].map((b) => b.textContent);
    expect(choices).toContain("Paper Moons (Demo) · Mira Holt · 3:21");
    await click([...document.querySelectorAll("ul ul button")].find((b) => b.textContent?.includes("Demo")) as HTMLElement);
    expect(ports.decide).toHaveBeenCalledWith("i1", 1, "pick", found);
  });

  it("says so when a hand search finds nothing or fails", async () => {
    const ports = fakePorts({ "review:": { items: [MISSING] } });
    ports.search = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("down"));
    await mount(ports);
    await click(buttons("ui.imports.action.pick")[0]);
    const field = document.querySelector<HTMLInputElement>("ul ul input")!;
    const submit = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
    };
    await submit("nothing");
    expect(document.body.textContent).toContain("ui.imports.search.none");
    await submit("again");
    expect(document.body.textContent).toContain("ui.imports.search.failed");
  });

  it("switches chips and pages with the cursor", async () => {
    const ports = fakePorts({
      "review:": { items: [] },
      "matched:": { items: [CHECK], nextCursor: "1" },
      "matched:1": { items: [{ ...CHECK, id: 3, position: 2 }] },
    });
    await mount(ports);
    expect(document.body.textContent).toContain("ui.imports.empty.review");
    await click(buttons("ui.imports.chip.matched")[0]);
    await click(buttons("ui.imports.show_more")[0]);
    expect(ports.calls).toEqual(["review:", "matched:", "matched:1"]);
    expect(document.querySelectorAll("li")).toHaveLength(2);
  });

  it("keeps every close match in one click", async () => {
    const ports = fakePorts({ "review:": { items: [CHECK] } });
    await mount(ports);
    await click(buttons("ui.imports.accept_check")[0]);
    expect(ports.bulk).toHaveBeenCalledWith("i1", "accept-check");
  });

  it("offers Search again when searches failed", async () => {
    const failed: ReportRow = {
      ...MISSING,
      reason: "catalog_lookup_failed",
      durationDiffMs: undefined,
      track: undefined,
      candidates: [],
    };
    const ports = fakePorts({ "review:": { items: [failed] } });
    await mount(ports);
    await click(buttons("ui.imports.retry_failed")[0]);
    expect(ports.bulk).toHaveBeenCalledWith("i1", "retry-failed");
  });

  it("Done dismisses the import and closes; it waits while the import runs", async () => {
    const ports = fakePorts({ "review:": { items: [] } });
    const onClose = await mount(ports);
    await click(buttons("ui.imports.done")[0]);
    expect(ports.dismiss).toHaveBeenCalledWith("i1");
    expect(onClose).toHaveBeenCalled();
    await mount(ports, { ...SUMMARY, status: "running" });
    expect(buttons("ui.imports.done")[0].disabled).toBe(true);
    expect(buttons("ui.imports.save_csv")).toHaveLength(0);
  });

  it("never lets a slower earlier chip answer overwrite the current list", async () => {
    let releaseAll!: (page: RowsPage) => void;
    const ports = fakePorts({
      "review:": { items: [MISSING] },
      "matched:": { items: [CHECK] },
    });
    const rows = ports.rows;
    ports.rows = vi.fn((id, filter, cursor) =>
      filter === "all"
        ? new Promise<RowsPage>((resolve) => {
            releaseAll = resolve;
          })
        : rows(id, filter, cursor),
    );
    await mount(ports);
    await click(buttons("ui.imports.chip.all")[0]);
    await click(buttons("ui.imports.chip.matched")[0]);
    await act(async () => releaseAll({ items: [MISSING, MISSING] }));
    expect(document.querySelectorAll("li")).toHaveLength(1);
    expect(document.body.textContent).toContain("Glass River");
  });

  it("drops a first page that arrives after the list was reloaded by a bulk action", async () => {
    let releaseFirst!: (page: RowsPage) => void;
    let calls = 0;
    const ports = fakePorts({});
    ports.rows = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? new Promise<RowsPage>((resolve) => {
            releaseFirst = resolve;
          })
        : Promise.resolve({ items: [CHECK] });
    });
    await mount(ports);
    await click(buttons("ui.imports.accept_check")[0]);
    await act(async () => releaseFirst({ items: [MISSING] }));
    expect(document.body.textContent).toContain("Glass River");
    expect(document.body.textContent).not.toContain("Paper Moons ·");
  });

  it("renders a bounded window of a huge report and says how to reach the rest", async () => {
    const many = Array.from({ length: 2000 }, (_, i) => ({
      ...CHECK,
      id: 100 + i,
      position: i,
    }));
    const ports = fakePorts({
      "review:": { items: many, nextCursor: "2000" },
    });
    await mount(ports);
    const shown = document.querySelectorAll("li").length;
    expect(shown).toBeLessThanOrEqual(400);
    expect(document.body.textContent).toContain(`ui.imports.rows_capped {"count":${shown}}`);
    expect(buttons("ui.imports.show_more")).toHaveLength(0);
  });

  it("says so quietly when a bulk action fails, and keeps the list", async () => {
    const ports = fakePorts({ "review:": { items: [CHECK] } });
    ports.bulk = vi.fn(async () => {
      throw new Error("down");
    });
    await mount(ports);
    await click(buttons("ui.imports.accept_check")[0]);
    expect(document.querySelector("[role=alert]")?.textContent).toBe("ui.imports.error.bulk");
    expect(document.body.textContent).toContain("Glass River");
    expect(ports.refresh).not.toHaveBeenCalled();
  });

  it("restores the row and names it when a choice cannot be saved", async () => {
    const ports = fakePorts({ "review:": { items: [CHECK] } });
    ports.decide = vi.fn(async () => {
      throw new Error("down");
    });
    await mount(ports);
    await click(buttons("ui.imports.action.keep")[0]);
    expect(document.querySelector("[role=alert]")?.textContent).toBe('ui.imports.error.decide {"title":"Glass River"}');
    expect(document.querySelectorAll("li")).toHaveLength(1);
    expect(buttons("ui.imports.action.keep")[0].disabled).toBe(false);
  });

  it("names the song on each row action for screen readers", async () => {
    const ports = fakePorts({ "review:": { items: [CHECK] } });
    await mount(ports);
    const keep = buttons("ui.imports.action.keep")[0];
    expect(keep.getAttribute("aria-label")).toBe('ui.imports.action_for {"action":"ui.imports.action.keep","title":"Glass River"}');
  });

  it("gives the truncated title and match their full text on hover", async () => {
    const ports = fakePorts({ "review:": { items: [MISSING] } });
    await mount(ports);
    const spans = [...document.querySelectorAll<HTMLElement>("li span")];
    expect(spans.length).toBeGreaterThan(1);
    for (const span of spans) expect(span.title).toBe(span.textContent);
  });
});
