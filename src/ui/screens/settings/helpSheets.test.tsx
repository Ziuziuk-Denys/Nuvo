// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ open: vi.fn(), fresh: false }));
vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, string | number>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key) }),
}));
vi.mock("../../ports/settings", () => ({
  useAppVersion: () => "0.3.0",
  notesFor: () => ["Faster start.", "", "- Sort the library."],
  takeWhatsNew: () => mocks.fresh,
}));
vi.mock("../../ports/system", () => ({
  appFacts: () => Promise.resolve({ version: "0.3.0", platform: "linux", packaged: true, compositor: "kwin" }),
  systemReport: () => Promise.resolve({ version: "core 1" }),
  openExternal: mocks.open,
}));

import { useTour } from "../../tour/tourStore";
import { HelpLinks, HelpSheets, useHelpSheet } from "./HelpSheets";

let root: Root;
const button = (name: string) =>
  [...document.querySelectorAll("button")].find((node) => node.textContent === name || node.getAttribute("aria-label") === name)!;

beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  act(() => useHelpSheet.getState().close());
  document.body.innerHTML = "";
  mocks.open.mockClear();
  mocks.fresh = false;
});

describe("help sheets", () => {
  it("What's new opens by itself after an update and lists the notes", async () => {
    mocks.fresh = true;
    await act(async () => root.render(<HelpSheets />));
    expect(document.body.textContent).toContain("ui.settings.whats_new.title(0.3.0)");
    expect([...document.querySelectorAll("li")].map((item) => item.textContent)).toEqual(["01Sort the library."]);
    expect(document.body.textContent).toContain("Faster start.");
  });

  it("the About card shows the tour again from its first chapter", async () => {
    useTour.setState({ status: "done", phase: "off" });
    await act(async () => root.render(<HelpLinks />));
    act(() => button("ui.settings.tour_again").click());
    expect(useTour.getState()).toMatchObject({ phase: "chapter", chapter: 0, step: 0, gated: false });
  });

  it("Report a problem sends nothing itself: it opens a filled GitHub issue, with the diagnostics only when chosen and shown", async () => {
    await act(async () => root.render(<HelpSheets />));
    expect(document.body.textContent).not.toContain("ui.settings.whats_new.title");
    await act(async () => useHelpSheet.getState().show("report"));
    expect(document.querySelector("textarea")).toBeNull();
    act(() => button("ui.settings.problem.open").click());
    const plain = new URL(mocks.open.mock.calls[0][0] as string);
    expect(plain.searchParams.get("body")).toContain("Nuvo 0.3.0 on linux, kwin");
    expect(plain.searchParams.get("body")).not.toContain("Diagnostics");

    await act(async () => useHelpSheet.getState().show("report"));
    act(() => (document.querySelector('[role="switch"]') as HTMLElement).click());
    const review = document.querySelector("textarea")!;
    expect(review.readOnly).toBe(true);
    expect(review.value).toContain("Nuvo bug report");
    act(() => button("ui.settings.problem.open").click());
    expect(new URL(mocks.open.mock.calls[1][0] as string).searchParams.get("body")).toContain("Nuvo bug report");
  });
});
