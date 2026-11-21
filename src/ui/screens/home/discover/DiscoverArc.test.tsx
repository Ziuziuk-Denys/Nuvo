// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeMix, Track } from "../../../ports/recs";
import { DISCOVER, FOR_YOU } from "../homeModel";
import { ringTracks } from "./ring";
import { DiscoverArc } from "./DiscoverArc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ playSongs: vi.fn(), backdrop: vi.fn(), moveSky: vi.fn() }));
vi.mock("../../../ports/homeShelves", () => ({ playSongs: mocks.playSongs }));
vi.mock("../../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../../ports/backdrop", () => ({ usePageBackdrop: mocks.backdrop }));
vi.mock("../../../field/Sky", () => ({ moveSky: mocks.moveSky }));
vi.mock("../../../effects", () => ({ useReducedEffects: () => true }));
vi.mock("../../../components/Cover", () => ({ Cover: () => null }));
vi.mock("../ShelfHeading", () => ({ ShelfHeading: ({ title }: { title: string }) => <h2>{title}</h2> }));

const track = (id: string) => ({ id, title: `Title ${id}`, artists: `Artist ${id}`, coverUrl: `https://covers/${id}.jpg`, durationMs: 1 }) as Track;
const mix = (id: string, ids: string[]) => ({ id, title: id, description: "", tracks: ids.map(track) }) as unknown as HomeMix;
const MIXES = [mix(FOR_YOU, ["k0", "k1", "k2"]), mix(DISCOVER, ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"])];

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 1100 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function render() {
  await act(async () => root.render(<DiscoverArc tracks={ringTracks(MIXES)} />));
}

const buttons = () => [...host.querySelectorAll<HTMLButtonElement>("li button")];
const centre = () => host.querySelector<HTMLButtonElement>("button[aria-current]")!;
const frames = () => act(async () => new Promise((resolve) => setTimeout(resolve, 10)));

describe("DiscoverArc", () => {
  it("lists every ring track as a button and names the centre one", async () => {
    await render();
    expect(buttons()).toHaveLength(11);
    expect(centre().getAttribute("aria-label")).toBe("Title n0, Artist n0");
    expect(centre().tabIndex).toBe(0);
    expect(host.querySelector("p")?.textContent).toContain("Title n0");
    expect(mocks.backdrop).toHaveBeenLastCalledWith("https://covers/n0.jpg", { sky: "still" });
    expect(mocks.moveSky).toHaveBeenCalled();
  });

  it("plays the centre track on a click", async () => {
    await render();
    await act(async () => centre().click());
    expect(mocks.playSongs).toHaveBeenCalledWith(expect.any(Array), 0, "home:discover");
  });

  it("plays a side track at once and turns it to the centre", async () => {
    await render();
    await act(async () => buttons()[2].click());
    expect(mocks.playSongs).toHaveBeenCalledWith(expect.any(Array), 2, "home:discover");
    await frames();
    expect(centre()).toBe(buttons()[2]);
    expect(mocks.backdrop).toHaveBeenLastCalledWith("https://covers/n2.jpg", { sky: "still" });
  });

  it("turns with the arrow keys and moves focus with the centre", async () => {
    await render();
    centre().focus();
    await act(async () => host.querySelector("ul")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    await frames();
    expect(centre()).toBe(buttons()[10]);
    expect(document.activeElement).toBe(buttons()[10]);
    expect(mocks.playSongs).not.toHaveBeenCalled();
  });
});
