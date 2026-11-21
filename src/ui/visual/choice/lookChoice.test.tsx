// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CornerHint } from "./CornerHint";
import { LEAVE_MS, LookChoice } from "./LookChoice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../Stage", () => ({ Stage: ({ aspect }: { aspect: string }) => <canvas data-aspect={aspect} /> }));

let root: Root;
let host: HTMLDivElement;
let onChosen: ReturnType<typeof vi.fn<(view: "karaoke" | "scene") => void>>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(705);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onChosen = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mount = () => act(() => root.render(<LookChoice light={false} onChosen={onChosen} />));
const radio = (view: string) => host.querySelector<HTMLButtonElement>(`[role=radio]:nth-child(${view === "scene" ? 1 : 2})`)!;
const use = () => [...host.querySelectorAll("button")].find((item) => item.textContent?.startsWith("visual.choice.use_"))!;
const view = () => host.firstElementChild?.getAttribute("data-view");

it("opens on a live scene of the built-in demo line, whatever the song", () => {
  mount();
  expect(view()).toBe("scene");
  expect(radio("scene").getAttribute("aria-checked")).toBe("true");
  expect(host.querySelector("canvas")?.getAttribute("data-aspect")).toBe("wide");
  expect(host.textContent).toContain("visual.choice.demo_1");
  expect(use().textContent).toBe("visual.choice.use_scene");
});

it("tries karaoke from the switch or the arrow keys without choosing it", () => {
  mount();
  act(() => radio("karaoke").click());
  expect(view()).toBe("karaoke");
  expect(use().textContent).toBe("visual.choice.use_karaoke");
  act(() => radio("karaoke").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  expect(view()).toBe("scene");
  expect(onChosen).not.toHaveBeenCalled();
});

it.each(["scene", "karaoke"] as const)("keeping %s steps aside, then hands over the choice", (choice) => {
  mount();
  act(() => radio(choice).click());
  act(() => use().click());
  expect(host.firstElementChild?.hasAttribute("data-leaving")).toBe(true);
  expect(onChosen).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(LEAVE_MS));
  expect(onChosen).toHaveBeenCalledWith(choice);
});

it("points at the switch in the corner and steps aside on a press or after a while", () => {
  const target = document.createElement("button");
  target.dataset.tour = "look-switch";
  target.getBoundingClientRect = () => new DOMRect(900, 12, 32, 32);
  document.body.append(target);
  const onDone = vi.fn();
  act(() => root.render(<CornerHint onDone={onDone} />));
  expect(document.body.textContent).toContain("visual.choice.here");
  act(() => window.dispatchEvent(new MouseEvent("pointerdown")));
  expect(onDone).toHaveBeenCalledOnce();
  target.remove();
});
