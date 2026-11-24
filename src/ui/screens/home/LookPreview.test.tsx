// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffectsStore } from "../../effects";
import { usePageBackdropStore } from "../../ports/backdrop";
import { useTour } from "../../tour/tourStore";
import { LookPreview } from "./LookPreview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../components/Lens", () => ({ Lens: () => null }));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useEffectsStore.setState({ look: "auto", lookAsked: false, reduce: false });
  useTour.setState({ phase: "off" });
  usePageBackdropStore.setState({ options: { scene: "room" } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const button = (label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === label)!;
const stored = () => JSON.parse(localStorage.getItem("nuvo.effects") ?? "{}") as { look?: string; lookAsked?: boolean };

describe("LookPreview", () => {
  it("previews a look live and keeps it only on Keep this", () => {
    act(() => root.render(<LookPreview />));
    act(() => button("ui.home.look.performance").click());
    expect(useEffectsStore.getState()).toMatchObject({ look: "performance", lookAsked: false });
    expect(stored().lookAsked).toBeUndefined();
    act(() => button("ui.home.look.keep").click());
    act(() => vi.runAllTimers());
    expect(useEffectsStore.getState()).toMatchObject({ look: "performance", lookAsked: true });
    expect(stored()).toMatchObject({ look: "performance", lookAsked: true });
    expect(host.innerHTML).toBe("");
  });

  it("Decide later puts back the look it found and does not ask again", () => {
    act(() => root.render(<LookPreview />));
    act(() => button("ui.home.look.visuals").click());
    act(() => button("ui.home.look.later").click());
    act(() => vi.runAllTimers());
    expect(useEffectsStore.getState()).toMatchObject({ look: "auto", lookAsked: true });
    expect(host.innerHTML).toBe("");
  });

  it("waits for the lit room of Home, the end of the tour and full motion", () => {
    usePageBackdropStore.setState({ options: {} });
    useTour.setState({ phase: "poster" });
    act(() => root.render(<LookPreview />));
    expect(host.innerHTML).toBe("");
    act(() => usePageBackdropStore.setState({ options: { scene: "room" } }));
    expect(host.innerHTML).toBe("");
    act(() => useEffectsStore.setState({ reduce: true }));
    act(() => useTour.setState({ phase: "off" }));
    expect(host.innerHTML).toBe("");
    act(() => useEffectsStore.setState({ reduce: false }));
    expect(host.querySelector("[data-look-preview]")).not.toBeNull();
  });
});
