// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OutputRow } from "./OutputRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const state = { outputLabel: "Headphones" as string | null, outputChosen: "h1" as string | null };
  return {
    state,
    store: (select: (value: typeof state) => unknown) => select(state),
    list: vi.fn(async () => [
      { id: "", label: "System default (Speakers)" },
      { id: "h1", label: "Headphones" },
    ]),
    choose: vi.fn(async () => undefined),
  };
});
vi.mock("../../ports/player", () => ({ usePlayerStore: mocks.store, playerOutputs: { list: mocks.list, choose: mocks.choose } }));
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

const button = () => host.querySelector<HTMLButtonElement>("button")!;
const items = () => [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];

it("shows the chosen device and switches to the system default", async () => {
  await act(async () => root.render(<OutputRow />));
  expect(button().textContent).toBe("Headphones");
  await act(async () => button().click());
  expect(items().map((item) => item.textContent)).toEqual(["System default (Speakers)", "Headphones"]);
  await act(async () => items()[0].click());
  expect(mocks.choose).toHaveBeenCalledWith(null);
});

it("reads the device list again on every open", async () => {
  mocks.list.mockClear();
  await act(async () => root.render(<OutputRow />));
  await act(async () => button().click());
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => button().click());
  expect(mocks.list).toHaveBeenCalledTimes(2);
});

it("names the default when nothing is chosen", async () => {
  mocks.state.outputLabel = null;
  await act(async () => root.render(<OutputRow />));
  expect(button().textContent).toBe("ui.settings.output_default");
});
