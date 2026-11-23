// @vitest-environment jsdom
import { act, useRef, type JSX } from "react";
import { type Root, createRoot } from "react-dom/client";
import { HashRouter, MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useHistoryEnds, useHistoryKeys, useScrollMemory } from "./history";

let host: HTMLElement;
let root: Root;
let navigate: NavigateFunction;
let blocked = false;
let room = 1_000;
let grow: () => void = () => undefined;

class Observer {
  constructor(private readonly notify: () => void) {}
  observe(): void {
    grow = this.notify;
  }
  disconnect(): void {
    grow = () => undefined;
  }
}

function Page(): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const location = useLocation();
  navigate = useNavigate();
  const { back, forward } = useHistoryEnds();
  useScrollMemory(box, location, ".inner");
  useHistoryKeys(navigate, () => blocked);
  return (
    <div ref={box} data-box data-ends={`${back} ${forward}`}>
      <p>{location.pathname}</p>
      <input />
    </div>
  );
}

const box = () => host.querySelector<HTMLElement>("[data-box]")!;
const path = () => host.querySelector("p")!.textContent;
const go = (to: string | number) => act(() => void (typeof to === "number" ? navigate(to) : navigate(to)));

function scrollTo(top: number): void {
  box().scrollTop = top;
  act(() => void box().dispatchEvent(new Event("scroll")));
}

function press(key: string, target: EventTarget = document.body): void {
  act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { key, altKey: true, bubbles: true, cancelable: true })));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", Observer);
  blocked = false;
  room = 1_000;
  let top = 0;
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = Math.min(value, room);
    },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <MemoryRouter initialEntries={["/a"]}>
        <Page />
      </MemoryRouter>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (HTMLElement.prototype as { scrollTop?: number }).scrollTop;
  delete (window as { navigation?: unknown }).navigation;
  vi.unstubAllGlobals();
});

it("opens a new page at the top and brings the place back both ways", () => {
  scrollTo(300);
  go("/b");
  expect(box().scrollTop).toBe(0);
  scrollTo(120);
  go(-1);
  expect([path(), box().scrollTop]).toEqual(["/a", 300]);
  go(1);
  expect([path(), box().scrollTop]).toEqual(["/b", 120]);
});

it("waits for a page that grows as it loads, and leaves it alone once the user scrolls", () => {
  scrollTo(800);
  go("/b");
  room = 100;
  go(-1);
  expect(box().scrollTop).toBe(100);
  room = 1_000;
  act(() => grow());
  expect(box().scrollTop).toBe(800);

  go("/c");
  room = 100;
  go(-1);
  window.dispatchEvent(new Event("wheel"));
  room = 1_000;
  act(() => grow());
  expect(box().scrollTop).toBe(100);
});

it("keeps a place through a visit that left before the page had grown back to it", () => {
  scrollTo(800);
  go("/b");
  room = 100;
  go(-1);
  act(() => void box().dispatchEvent(new Event("scroll")));
  go(1);
  go(-1);
  act(() => void box().dispatchEvent(new Event("scroll")));
  room = 1_000;
  act(() => grow());
  go(1);
  go(-1);
  expect(box().scrollTop).toBe(800);
});

it("moves through history with Alt and the arrows, not while typing or when something covers the page", () => {
  go("/b");
  press("ArrowLeft");
  expect(path()).toBe("/a");
  press("ArrowRight", host.querySelector("input")!);
  expect(path()).toBe("/a");
  blocked = true;
  press("ArrowRight");
  expect(path()).toBe("/a");
  blocked = false;
  go(1);
  press("ArrowLeft");
  press("ArrowRight");
  expect(path()).toBe("/b");
});

it("follows the window's history list and does nothing past its end", () => {
  const list = Object.assign(new EventTarget(), { canGoBack: true, canGoForward: false });
  (window as { navigation?: unknown }).navigation = list;
  go("/b");
  expect(box().dataset.ends).toBe("true false");
  list.canGoForward = true;
  act(() => void list.dispatchEvent(new Event("currententrychange")));
  list.canGoForward = false;
  press("ArrowRight");
  expect(path()).toBe("/b");
});

it("opens a page reached through the address at the top each time", async () => {
  const visit = async (hash: string) => {
    (window as { navigation?: unknown }).navigation = Object.assign(new EventTarget(), { currentEntry: { key: hash + Math.random() } });
    await act(async () => {
      const arrived = new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
      window.location.hash = hash;
      await arrived;
    });
  };
  act(() =>
    root.render(
      <HashRouter>
        <Page />
      </HashRouter>,
    ),
  );
  await visit("#/a");
  scrollTo(300);
  await visit("#/b");
  await visit("#/a");
  expect([path(), box().scrollTop]).toEqual(["/a", 0]);
});
