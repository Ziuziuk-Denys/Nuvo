import { default as fs } from "node:fs";
import { default as path } from "node:path";
import { expect, it, describe } from "vitest";
import { CONTENT, ISLAND, contentGutter, coverRadius, islandWidth } from "./geometry";
import { DURATION_MS, EASE, entranceDelayMs } from "./motion";

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), "utf8");

function cssVar(css: string, name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`--${name} missing`);
  return match[1].replace(/\s+/g, " ").replace(/\(\s/g, "(").replace(/\s\)/g, ")").trim();
}

describe("foundations", () => {
  it("loads no webfonts and marks the document as Nuvo", () => {
    const html = read("../../index.html");
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(html).toMatch(/<html[^>]*data-ui="nuvo"/);
    expect(read("../../electron/app/policy.ts")).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it("keeps motion.css in step with motion.ts", () => {
    const css = read("motion.css");
    const names = { instant: "t-instant", quick: "t-quick", base: "t-base", page: "t-page", entrance: "t-entrance", light: "t-light" } as const;
    for (const [key, name] of Object.entries(names)) {
      expect(cssVar(css, `n-${name}`), name).toBe(`${DURATION_MS[key as keyof typeof DURATION_MS]}ms`);
    }
    const bezier = (v: readonly number[]) => `cubic-bezier(${v.join(", ")})`;
    expect(cssVar(css, "n-ease-out")).toBe(bezier(EASE.out));
    expect(cssVar(css, "n-ease-inout")).toBe(bezier(EASE.inOut));
    expect(cssVar(css, "n-ease-in")).toBe(bezier(EASE.in));
  });

  it("has exactly the seven type roles, scaled by --n-scale with the reading minimums", () => {
    const css = read("tokens.css");
    const px = (size: number, min?: number) => (min ? `max(${min}px, calc(${size}px * var(--n-scale, 1)))` : `calc(${size}px * var(--n-scale, 1))`);
    const roles = {
      display: `700 ${px(40)} / ${px(44)}`,
      title: `600 ${px(24)} / ${px(30)}`,
      heading: `600 ${px(17)} / ${px(22)}`,
      body: `400 ${px(14, 13)} / ${px(20, 19)}`,
      label: `500 ${px(13, 12)} / ${px(18, 17)}`,
      caption: `500 ${px(12, 11)} / ${px(16, 15)}`,
      numeral: `500 ${px(12, 11)} / ${px(16, 15)}`,
    };
    for (const [role, value] of Object.entries(roles)) {
      expect(cssVar(css, `n-type-${role}`)).toBe(`${value} var(--n-font)`);
    }
    expect(css.match(/--n-type-[a-z]+:/g)).toHaveLength(7);
  });

  it("reads the UI font through one variable and derives the focus halo from the ring colour", () => {
    const css = read("tokens.css");
    expect(cssVar(css, "n-font")).toBe("var(--n-font-ui, var(--n-font-stack))");
    expect(cssVar(css, "n-focus-halo")).toBe("color-mix(in srgb, var(--n-ring, var(--n-accent)) 38%, transparent)");
    expect(css).toMatch(/:root\[data-theme-editing\] \* \{\s*transition: none !important;/);
  });

  it("has four monotonic radii", () => {
    const css = read("tokens.css");
    const radii = ["n-r-s", "n-r-m", "n-r-l"].map((name) => parseInt(cssVar(css, name), 10));
    expect(radii).toEqual([8, 10, 14]);
  });

  it("derives shell measures", () => {
    expect(CONTENT.bottomPadding).toBe(76);
    expect(islandWidth(1440)).toBe(1440 - ISLAND.left - ISLAND.sideMargin);
    expect(islandWidth(1200)).toBe(1124);
    expect(contentGutter(1499)).toBe(12);
    expect(contentGutter(1500)).toBe(12);
    expect([64, 65, 199, 200].map(coverRadius)).toEqual([6, 6, 6, 6]);
  });

  it("caps the entrance stagger at six items", () => {
    expect([0, 1, 5, 6, 12, -1].map(entranceDelayMs)).toEqual([0, 60, 300, 300, 300, 0]);
  });
});
