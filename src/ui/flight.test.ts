// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { coverKey } from "./components/coverUrl";
import { useEffectsStore } from "./effects";
import { arrive, watchDepartures } from "./flight";

const ART = "https://lh3.googleusercontent.com/abc=w544-h544-l90-rj";
const HERO_ART = "https://lh3.googleusercontent.com/abc=w1000-h1000-l90-rj";
const animations: { keyframes: Keyframe[]; element: Element; cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }[] = [];

function cover(src: string, box: Partial<DOMRect>, parent: HTMLElement, loaded = true): HTMLElement {
  const node = document.createElement("span");
  const image = document.createElement("img");
  Object.defineProperties(image, { complete: { value: loaded, configurable: true }, naturalWidth: { value: loaded ? 500 : 0, configurable: true } });
  node.append(image);
  node.dataset.cover = src;
  node.getBoundingClientRect = () => ({ left: 0, top: 0, width: 160, height: 160, ...box }) as DOMRect;
  Object.defineProperties(node, { offsetWidth: { value: box.width ?? 160 }, offsetHeight: { value: box.height ?? 160 } });
  parent.append(node);
  return node;
}

function page(): HTMLElement {
  const node = document.createElement("div");
  node.dataset.page = "";
  document.body.append(node);
  return node;
}

let stop: () => void;

beforeEach(() => {
  animations.length = 0;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  Element.prototype.getAnimations = () => [];
  Element.prototype.animate = function (this: Element, keyframes: Keyframe[]) {
    const animation = { keyframes, element: this, cancel: vi.fn(), onfinish: null };
    animations.push(animation);
    return animation as unknown as Animation;
  } as Element["animate"];
  stop = watchDepartures();
});

afterEach(() => {
  stop();
  document.body.replaceChildren();
  useEffectsStore.setState({ reduce: false });
});

const ghosts = () => document.querySelectorAll("body > [aria-hidden=true]");

function press(src: string, box: Partial<DOMRect>, loaded = true): void {
  const old = page();
  const button = document.createElement("button");
  old.append(button);
  cover(src, box, button, loaded);
  button.click();
  old.remove();
}

describe("cover flight", () => {
  it("knows one artwork at two sizes", () => {
    expect(coverKey(ART)).toBe(coverKey(HERO_ART));
    expect(coverKey("https://x.test/a.jpg")).toBe("https://x.test/a.jpg");
  });

  it("flies the pressed cover to the largest one of the page, whose text rises as it lands", () => {
    press(ART, { left: 20, top: 300, width: 80, height: 80 });
    const next = page();
    const title = document.createElement("h1");
    const target = cover(HERO_ART, { left: 10, top: 10, width: 160, height: 160 }, next);
    next.append(title);
    cover(HERO_ART, { width: 48, height: 48 }, document.createElement("div"));
    arrive();
    expect(animations[0].keyframes[0].transform).toBe("translate(10px, 290px) scale(0.5, 0.5)");
    expect(animations[1].element).toBe(target);
    expect(animations.slice(2).map((animation) => animation.element)).toEqual([title]);
    expect(ghosts()).toHaveLength(1);
    animations[0].onfinish?.();
    expect(ghosts()).toHaveLength(0);
    expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
  });

  it("hides the frame around the cover with it, so no placeholder waits for it", () => {
    press(ART, {});
    const frame = document.createElement("div");
    Object.defineProperties(frame, { offsetWidth: { value: 160 }, offsetHeight: { value: 160 } });
    page().append(frame);
    cover(HERO_ART, {}, frame);
    arrive();
    expect(animations[1].element).toBe(frame);
  });

  it("a second flight takes over from the air and cleans up the first", () => {
    press(ART, { left: 0, top: 0, width: 80, height: 80 });
    cover(HERO_ART, {}, page());
    arrive();
    const first = animations.slice();
    ghosts()[0].getBoundingClientRect = () => ({ left: 40, top: 60, width: 100, height: 100 }) as DOMRect;
    press(ART, { left: 900, top: 600, width: 80, height: 80 });
    arrive();
    expect(first.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
    expect(ghosts()).toHaveLength(1);
    expect(animations[first.length].keyframes[0].transform).toBe("translate(40px, 60px) scale(0.625, 0.625)");
  });

  it("a page left mid-flight takes its ghost with it", () => {
    press(ART, {});
    const next = page();
    cover(HERO_ART, {}, next);
    arrive();
    expect(ghosts()).toHaveLength(1);
    next.remove();
    arrive();
    expect(ghosts()).toHaveLength(0);
  });

  it("the wheel lands it at once", () => {
    press(ART, {});
    cover(HERO_ART, {}, page());
    arrive();
    window.dispatchEvent(new Event("wheel"));
    expect(ghosts()).toHaveLength(0);
    expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
  });

  it("a cover that has not loaded keeps the flown one until it has, and never for long", () => {
    vi.useFakeTimers();
    for (const settle of [(target: HTMLElement) => target.querySelector("img")!.dispatchEvent(new Event("load")), () => vi.advanceTimersByTime(700)]) {
      animations.length = 0;
      press(ART, {});
      const next = page();
      const target = cover(HERO_ART, {}, next, false);
      arrive();
      animations[0].onfinish?.();
      expect(ghosts()).toHaveLength(1);
      settle(target);
      expect(ghosts()).toHaveLength(0);
      expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
      next.remove();
    }
    vi.useRealTimers();
  });

  it("a pressed cover that has not loaded does not fly", () => {
    press(ART, {}, false);
    cover(HERO_ART, {}, page());
    arrive();
    expect(animations).toHaveLength(0);
  });

  it("stays on the ground under Reduce effects, for another cover and without a press", () => {
    useEffectsStore.setState({ reduce: true });
    press(ART, {});
    cover(HERO_ART, {}, page());
    arrive();
    useEffectsStore.setState({ reduce: false });
    arrive();
    press("https://x.test/other.jpg", {});
    arrive();
    expect(animations).toHaveLength(0);
  });
});
