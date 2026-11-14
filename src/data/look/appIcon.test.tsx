// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useAppIconSync } from "./appIcon";
import { useLookStore } from "./lookStore";
import { revealThemeChange } from "./reveal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "dark", resolvedTheme: "dark" }) }));

function Probe() {
  useAppIconSync();
  return null;
}

const applyIcon = vi.fn(async () => undefined);
let roots: Root[] = [];

beforeEach(() => {
  applyIcon.mockClear();
  (window as unknown as { nuvoShell: unknown }).nuvoShell = { applyIcon };
  class FakeImage {
    src = "";
    decode = async () => undefined;
  }
  vi.stubGlobal("Image", FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
});

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots = [];
  useLookStore.setState({ preset: "nuvo" });
  delete (window as unknown as { nuvoShell?: unknown }).nuvoShell;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount() {
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () => root.render(<Probe />));
}

describe("app icon", () => {
  it("sends the preset's icon, stock only for nuvo", async () => {
    useLookStore.setState({ preset: "amber" });
    await mount();
    expect(applyIcon).toHaveBeenCalledWith("data:image/png;base64,AAAA", { stock: false });
    applyIcon.mockClear();
    await act(async () => useLookStore.setState({ preset: "nuvo" }));
    expect(applyIcon).toHaveBeenCalledWith("data:image/png;base64,AAAA", { stock: true });
  });
});

describe("reveal", () => {
  it("applies at once without View Transitions", () => {
    const apply = vi.fn();
    revealThemeChange(apply);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(document.documentElement.hasAttribute("data-theme-switch")).toBe(false);
  });

  it("applies inside a view transition and marks the root until the cross-fade ends", async () => {
    let finish = () => undefined as void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    const start = vi.fn((update: () => void) => {
      update();
      return { finished };
    });
    (document as unknown as { startViewTransition: unknown }).startViewTransition = start;
    const apply = vi.fn();
    revealThemeChange(apply);
    expect(start).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(document.documentElement.hasAttribute("data-theme-switch")).toBe(true);
    finish();
    await finished;
    await Promise.resolve();
    expect(document.documentElement.hasAttribute("data-theme-switch")).toBe(false);
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });
});
