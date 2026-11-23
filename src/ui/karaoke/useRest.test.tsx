// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRest } from "./useRest";

let host: HTMLDivElement;
let root: Root;

function View({ awake = false, menu = false }: { awake?: boolean; menu?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useRest(ref, awake);
  return (
    <div ref={ref} data-view="">
      <input type="file" hidden />
      <button type="button" aria-expanded={menu}>
        tools
      </button>
    </div>
  );
}

const render = (props: { awake?: boolean; menu?: boolean } = {}) => act(() => root.render(<View {...props} />));
const view = () => host.querySelector<HTMLElement>("[data-view]")!;
const rests = () => "rest" in view().dataset;
const pass = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const move = (x: number) => view().dispatchEvent(new MouseEvent("pointermove", { bubbles: true, screenX: x, screenY: 1 }));

beforeEach(() => {
  vi.useFakeTimers();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("karaoke rest", () => {
  it("the first view stays awake for 6 s, a hidden file input does not hold it", () => {
    render();
    pass(5_900);
    expect(rests()).toBe(false);
    pass(200);
    expect(rests()).toBe(true);
  });

  it("a move, a key and focus wake it for 3 s; a move that goes nowhere does not", () => {
    render();
    pass(3_100);
    expect(rests()).toBe(true);
    move(10);
    expect(rests()).toBe(false);
    pass(3_100);
    expect(rests()).toBe(true);
    move(10);
    expect(rests()).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(rests()).toBe(false);
    pass(3_100);
    view().querySelector("button")!.focus();
    expect(rests()).toBe(false);
  });

  it("stays awake while paused and while a menu is open", () => {
    render({ menu: true });
    pass(10_000);
    expect(rests()).toBe(false);
    render({ menu: false });
    pass(600);
    expect(rests()).toBe(true);
    render({ awake: true });
    expect(rests()).toBe(false);
    pass(10_000);
    expect(rests()).toBe(false);
  });
});
