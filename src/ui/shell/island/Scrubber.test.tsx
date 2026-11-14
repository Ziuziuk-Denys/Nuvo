// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { applyWindowVisibility } from "../../ports/window";
import { Scrubber } from "./Scrubber";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../ports/player", () => ({ playerEngine: { seek: vi.fn() } }));

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
  applyWindowVisibility(true);
});

const fill = () => host.querySelector<HTMLElement>("[role=slider] span")!.style.transform;

describe("Scrubber", () => {
  it("holds the line still while the window is hidden and catches up when it is back", () => {
    act(() => root.render(<Scrubber positionMs={25_000} durationMs={100_000} tint="red" />));
    expect(fill()).toBe("translateX(-75%)");
    act(() => applyWindowVisibility(false));
    act(() => root.render(<Scrubber positionMs={50_000} durationMs={100_000} tint="red" />));
    expect(fill()).toBe("translateX(-75%)");
    expect(host.querySelector("[role=slider]")!.getAttribute("aria-valuenow")).toBe("50");
    act(() => applyWindowVisibility(true));
    expect(fill()).toBe("translateX(-50%)");
  });
});

describe("Scrubber motion", () => {
  it("never glides, even on a short track whose steps are wide", () => {
    // a 1,000 px bar: a 30 s track moves about 8 px per position update
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly callback: () => void) {}
        observe() {
          this.callback();
        }
        disconnect() {}
      },
    );
    act(() => root.render(<Scrubber positionMs={1_000} durationMs={30_000} tint="red" />));
    expect(host.querySelector("[role=slider]")!.hasAttribute("data-glide")).toBe(false);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});

describe("Scrubber A-B loop", () => {
  const band = () => host.querySelector<HTMLElement>('[data-testid="ab-loop"]');

  it("draws the loop as a band from A to B and says it to a screen reader", () => {
    act(() => root.render(<Scrubber positionMs={40_000} durationMs={100_000} tint="red" loop={{ a: 38_000, b: 41_000 }} />));
    expect(band()!.style.left).toBe("38%");
    expect(band()!.style.width).toBe("calc(3%)");
    expect(host.querySelector("[role=slider]")!.getAttribute("aria-valuetext")).toBe("0:40 / 1:40, ui.island.loop");
  });

  it("marks A alone until B is set, and shows nothing without a loop", () => {
    act(() => root.render(<Scrubber positionMs={40_000} durationMs={100_000} tint="red" loop={{ a: 38_000, b: null }} />));
    expect(band()!.style.width).toBe("0px");
    expect(band()!.title).toBe("ui.island.loop_start");
    act(() => root.render(<Scrubber positionMs={40_000} durationMs={100_000} tint="red" loop={{ a: null, b: null }} />));
    expect(band()).toBeNull();
  });
});
