// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffectsStore } from "../../../effects";
import { useTour } from "../../../tour/tourStore";
import { LookChoice } from "./LookChoice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  useEffectsStore.setState({ look: "auto", lookAsked: false });
  useTour.setState({ phase: "off" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const button = (label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent?.includes(label))!;
const finish = () => act(() => host.querySelector("[data-look-choice]")!.dispatchEvent(new Event("transitionend", { bubbles: true })));

describe("LookChoice", () => {
  it("asks once: a choice is kept after the strip fades out", async () => {
    await act(async () => root.render(<LookChoice />));
    act(() => button("ui.home.look.performance").click());
    expect(button("ui.home.look.performance").getAttribute("aria-pressed")).toBe("true");
    expect(useEffectsStore.getState().lookAsked).toBe(false);
    finish();
    expect(useEffectsStore.getState()).toMatchObject({ look: "performance", lookAsked: true });
    expect(host.innerHTML).toBe("");
  });

  it("decide later keeps Auto and does not ask again", async () => {
    await act(async () => root.render(<LookChoice />));
    act(() => button("ui.home.look.later").click());
    finish();
    expect(useEffectsStore.getState()).toMatchObject({ look: "auto", lookAsked: true });
    expect(host.innerHTML).toBe("");
  });

  it("stays away during the tour and once asked", async () => {
    useTour.setState({ phase: "poster" });
    await act(async () => root.render(<LookChoice />));
    expect(host.innerHTML).toBe("");
    act(() => useTour.setState({ phase: "off" }));
    expect(host.querySelector("[data-look-choice]")).not.toBeNull();
    act(() => useEffectsStore.setState({ lookAsked: true }));
    expect(host.innerHTML).toBe("");
  });
});
