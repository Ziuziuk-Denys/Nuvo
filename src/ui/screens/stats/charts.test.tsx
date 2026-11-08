// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BarChart, Calendar, Clock, Curve, ShareRows } from "./charts";

vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string, vars?: { count?: number }) => `${key}${vars?.count ?? ""}`, locale: "en" }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (node: React.ReactNode) => act(() => root.render(node));

describe("charts", () => {
  it("marks the strongest column and survives silent ones", () => {
    render(
      <BarChart
        label="l"
        onHover={() => undefined}
        items={[1, 0, 5].map((value, index) => ({ key: String(index), label: String(index), title: "", value }))}
      />,
    );
    const peaks = host.querySelectorAll("[data-peak]");
    expect(peaks).toHaveLength(1);
    expect(host.innerHTML).not.toContain("NaN");
  });

  it("has no peak when everything is silent", () => {
    render(<BarChart label="l" onHover={() => undefined} items={[{ key: "a", label: "a", title: "", value: 0 }]} />);
    expect(host.querySelectorAll("[data-peak]")).toHaveLength(0);
    expect(host.innerHTML).not.toContain("NaN");
  });

  it("reads out the column under the pointer", () => {
    const onHover = vi.fn();
    render(<BarChart label="l" onHover={onHover} items={[{ key: "a", label: "a", title: "A", value: 3 }]} />);
    const column = host.querySelector("span[class*=column]")!;
    act(() => column.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    expect(onHover).toHaveBeenCalledWith(expect.objectContaining({ title: "A" }));
  });

  it("draws a dial from any day", () => {
    render(<Clock byHour={Array.from({ length: 24 }, (_, hour) => (hour === 21 ? 100 : 0))} />);
    expect(host.querySelectorAll("path[data-peak]")).toHaveLength(1);
    expect(host.textContent).toContain("ui.stats.part.evening.name");
    expect(host.innerHTML).not.toContain("NaN");
  });

  it("draws a curve through two points", () => {
    render(
      <Curve
        label="l"
        onHover={() => undefined}
        points={[
          { key: "a", label: "a", title: "", value: 2 },
          { key: "b", label: "b", title: "", value: 0 },
        ]}
      />,
    );
    expect(host.innerHTML).not.toContain("NaN");
  });

  it("shows a year of days and the shares of a whole", () => {
    render(<Calendar days={[{ day: "2026-11-01", listenedMs: 100, plays: 1 }]} from={null} to="2026-11-07" />);
    expect(host.querySelectorAll("[data-level]").length).toBe(53 * 7 + 5);
    render(<ShareRows items={[{ key: "a", label: "A", share: 0.25, note: "1 min" }]} />);
    expect(host.textContent).toContain("25%");
  });
});
