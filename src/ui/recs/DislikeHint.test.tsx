// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DislikeHint } from "./DislikeHint";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tour = vi.hoisted(() => ({ phase: "off" }));
const player = vi.hoisted(() => ({ fullscreen: false }));
vi.mock("../ports/player", () => ({ usePlayerStore: (pick: (state: { fullscreen: boolean }) => unknown) => pick(player) }));
vi.mock("../tour/tourStore", () => ({ useTour: (pick: (state: { phase: string }) => unknown) => pick(tour) }));
vi.mock("../tour/targets", () => ({ seenBox: () => ({ x: 10, y: 10, width: 32, height: 32 }), radiusOf: () => 16 }));
vi.mock("../tour/Callout", () => ({ Callout: ({ text }: { text: string }) => <p data-callout="">{text}</p> }));
vi.mock("../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

let root: Root;
let host: HTMLDivElement;
const callout = () => document.querySelector("[data-callout]")?.textContent ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  tour.phase = "off";
  player.fullscreen = false;
  host = document.createElement("div");
  host.innerHTML = '<div data-island=""><button data-dislike=""></button></div>';
  document.body.append(host);
  root = createRoot(host.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("Dislike hint", () => {
  it("explains Dislike once, after a moment, and leaves on the next press", () => {
    act(() => root.render(<DislikeHint />));
    expect(callout()).toBeNull();
    act(() => vi.advanceTimersByTime(4_000));
    expect(callout()).toBe("ui.recs.dislike_hint");
    act(() => window.dispatchEvent(new Event("pointerdown")));
    expect(callout()).toBeNull();
    act(() => root.render(<></>));
    act(() => root.render(<DislikeHint />));
    act(() => vi.advanceTimersByTime(10_000));
    expect(callout()).toBeNull();
  });

  it("waits while the tour runs", () => {
    tour.phase = "running";
    act(() => root.render(<DislikeHint />));
    act(() => vi.advanceTimersByTime(10_000));
    expect(callout()).toBeNull();
    expect(localStorage.getItem("nuvo.hint.dislike")).toBeNull();
  });

  it("waits while the karaoke view covers the player, then shows once it closes", () => {
    player.fullscreen = true;
    act(() => root.render(<DislikeHint />));
    act(() => vi.advanceTimersByTime(10_000));
    expect(callout()).toBeNull();
    player.fullscreen = false;
    act(() => root.render(<DislikeHint />));
    act(() => vi.advanceTimersByTime(4_000));
    expect(callout()).toBe("ui.recs.dislike_hint");
  });
});
