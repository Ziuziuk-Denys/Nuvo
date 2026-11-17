// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CornerHint } from "./CornerHint";
import { exampleScene, LEAVE_MS, LookChoice } from "./LookChoice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../Stage", () => ({ Stage: ({ aspect }: { aspect: string }) => <canvas data-aspect={aspect} /> }));

let root: Root;
let host: HTMLDivElement;
let onChosen: ReturnType<typeof vi.fn<(view: "karaoke" | "scene") => void>>;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onChosen = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const mount = () => act(() => root.render(<LookChoice trackKey="t1" coverUrl="" lines={[]} onChosen={onChosen} />));
const pick = (name: string) => [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(name))!;

it("splits the view: a live scene of this song on one half, its karaoke on the other", () => {
  mount();
  expect([...host.querySelectorAll("button b")].map((item) => item.textContent)).toEqual(["visual.choice.scene", "visual.choice.karaoke"]);
  expect(host.querySelector("canvas")?.getAttribute("data-aspect")).toBe("tall");
  expect(host.textContent).toContain("visual.choice.later");
});

it("shows icy black words on white when the song has lyrics, and the chrome emblem when it has none", () => {
  expect(exampleScene(true)).toEqual({
    background: "duo",
    atmosphere: [],
    centrepiece: null,
    lyrics: "kinetic",
    colors: { a: [1, 1, 1], b: [0.02, 0.02, 0.03] },
  });
  expect(exampleScene(false)).toMatchObject({ centrepiece: "emblem" });
});

it("quiets the other half while one is hovered", () => {
  mount();
  act(() => pick("visual.choice.karaoke").dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
  expect(host.firstElementChild?.getAttribute("data-hot")).toBe("karaoke");
});

it.each(["scene", "karaoke"] as const)("picking %s lets the other half go, then hands over the choice", (view) => {
  mount();
  act(() => pick(`visual.choice.${view}`).click());
  expect(host.firstElementChild?.getAttribute("data-leaving")).toBe(view);
  expect(onChosen).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(LEAVE_MS));
  expect(onChosen).toHaveBeenCalledWith(view, exampleScene(false));
});

it("points at the switch in the corner and steps aside on a press or after a while", () => {
  const target = document.createElement("button");
  target.dataset.tour = "look-switch";
  document.body.append(target);
  const onDone = vi.fn();
  act(() => root.render(<CornerHint onDone={onDone} />));
  expect(document.body.textContent).toContain("visual.choice.here");
  act(() => window.dispatchEvent(new MouseEvent("pointerdown")));
  expect(onDone).toHaveBeenCalledOnce();
  target.remove();
});
