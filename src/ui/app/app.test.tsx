import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../shell/Shell", () => ({ Shell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("../screens/lock/Gate", () => ({ Gate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("./Overlays", () => ({ Overlays: () => null }));
vi.mock("../shell/useAppearanceSync", () => ({ useAppearanceSync: () => undefined }));
vi.mock("../ports/app", async (original) => ({
  ...(await original<typeof import("../ports/app")>()),
  useSoundSync: () => undefined,
  useTempoSync: () => undefined,
  useAbLoop: () => undefined,
  useNotchFeeds: () => undefined,
}));

vi.mock("../ports/player", () => ({ usePlayerStore: (select: (state: unknown) => unknown) => select({ currentTrack: null }) }));
vi.mock("../ports/lyrics", () => ({ useLyrics: (select: (state: unknown) => unknown) => select({ trackId: null, lines: [] }) }));
vi.mock("./routes", async () => {
  const { useLocation } = await import("react-router-dom");
  return { AppRoutes: () => <p>at {useLocation().pathname}</p> };
});
vi.mock("./links", () => ({ useDeeplinks: () => undefined }));

import { App } from "./App";

describe("App", () => {
  it("the theme reaches the root as data-theme: the design tokens select on it", () => {
    window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
    localStorage.setItem("theme", "dark");
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<App />));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    act(() => root.unmount());
    localStorage.clear();
  });

  it("renders the shell inside a hash router and a theme provider", () => {
    window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
    location.hash = "#/library";
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<App />));
    expect(host.querySelector("main")?.textContent).toBe("at /library");
    act(() => root.unmount());
  });
});
