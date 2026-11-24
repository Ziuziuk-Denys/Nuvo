// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { coverKey } from "./components/coverUrl";
import { useEffectsStore } from "./effects";
import { arrive, watchDepartures } from "./flight";

const ART = "https://lh3.googleusercontent.com/abc=w544-h544-l90-rj";
const HERO_ART = "https://lh3.googleusercontent.com/abc=w1000-h1000-l90-rj";
const animations: { keyframes: Keyframe[]; element: Element; cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }[] = [];

function cover(src: string, box: Partial<DOMRect>, parent: HTMLElement): HTMLElement {
  const node = document.createElement("span");
  node.dataset.cover = src;
  node.getBoundingClientRect = () => ({ left: 0, top: 0, width: 160, height: 160, ...box }) as DOMRect;
  Object.defineProperty(node, "offsetWidth", { value: box.width ?? 160 });
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

function press(src: string, box: Partial<DOMRect>): void {
  const old = page();
  const button = document.createElement("button");
  old.append(button);
  cover(src, box, button);
  button.click();
  old.remove();
}

describe("cover flight", () => {
  it("knows one artwork at two sizes", () => {
    expect(coverKey(ART)).toBe(coverKey(HERO_ART));
    expect(coverKey("https://x.test/a.jpg")).toBe("https://x.test/a.jpg");
  });

  it("flies the pressed cover to the hero and leaves nothing behind", () => {
    press(ART, { left: 20, top: 300, width: 80, height: 80 });
    const next = page();
    cover(HERO_ART, { width: 300, height: 300 }, next);
    const hero = document.createElement("div");
    hero.dataset.heroCover = "";
    next.append(hero);
    const target = cover(HERO_ART, { left: 10, top: 10, width: 160, height: 160 }, hero);
    arrive();
    expect(animations[0].keyframes[0].transform).toBe("translate(10px, 290px) scale(0.5, 0.5)");
    expect(animations[1].element).toBe(target);
    expect(document.querySelectorAll("body > [aria-hidden=true]")).toHaveLength(1);
    animations[0].onfinish?.();
    expect(document.querySelectorAll("body > [aria-hidden=true]")).toHaveLength(0);
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
