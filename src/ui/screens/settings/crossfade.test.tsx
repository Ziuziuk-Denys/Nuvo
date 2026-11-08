// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrossfadeBlock } from "./CrossfadeBlock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const engine = vi.hoisted(() => ({ crossfadeSeconds: () => 0, setCrossfade: vi.fn() }));
vi.mock("../../ports/player", () => ({ playerEngine: engine, CROSSFADE_MAX_S: 12 }));
vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }), getTranslationsForAllLocales: (key: string) => [key] }));

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
});

it("steps the crossfade by one second and writes it to the engine", async () => {
  await act(async () => root.render(<CrossfadeBlock />));
  const slider = host.querySelector<HTMLElement>('[role="slider"]')!;
  expect(slider.getAttribute("aria-valuetext")).toBe("ui.settings.crossfade_off");
  await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(engine.setCrossfade).toHaveBeenCalledWith(1);
  expect(slider.getAttribute("aria-valuenow")).toBe("1");
});
