// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdateView } from "../ports/system";
import { useTour } from "../tour/tourStore";
import { useToastStore } from "./toastStore";
import { UpdateOffer } from "./UpdateOffer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  listener: null as ((view: UpdateView) => void) | null,
  installUpdate: vi.fn(async () => true),
  openReleasePage: vi.fn(async () => undefined),
}));

vi.mock("../ports/i18n", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock("../ports/system", () => ({
  readUpdate: async () => null,
  watchUpdate: (listener: (view: UpdateView) => void) => {
    mocks.listener = listener;
    return () => undefined;
  },
  installUpdate: mocks.installUpdate,
  openReleasePage: mocks.openReleasePage,
}));

function mount() {
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<UpdateOffer />));
  return root;
}

const emit = (view: UpdateView) => act(() => mocks.listener?.(view));
const offer = () => useToastStore.getState().queue.find((toast) => toast.id === "update-offer");

afterEach(() => {
  act(() => useToastStore.setState({ queue: [] }));
  vi.clearAllMocks();
});

describe("UpdateOffer", () => {
  it("offers a restart for a downloaded update and stays away after Later", async () => {
    act(() => useTour.setState({ phase: "off" }));
    const root = mount();
    emit({ phase: "ready", mode: "install", version: "1.2.0" });
    expect(offer()).toMatchObject({ message: "ui.update_offer.ready", action: { label: "ui.update_offer.restart" } });
    offer()!.action!.onClick();
    expect(mocks.installUpdate).toHaveBeenCalledTimes(1);
    offer()!.later!.onClick();
    act(() => useToastStore.getState().dismiss("update-offer"));
    emit({ phase: "ready", mode: "install", version: "1.2.0" });
    expect(offer()).toBeUndefined();
    act(() => root.unmount());
  });

  it("downloads on Update, shows the progress, and opens the release page where it cannot install", () => {
    act(() => useTour.setState({ phase: "off" }));
    const root = mount();
    emit({ phase: "available", mode: "install", version: "1.3.0" });
    offer()!.action!.onClick();
    expect(mocks.installUpdate).toHaveBeenCalledTimes(1);
    emit({ phase: "downloading", mode: "install", version: "1.3.0", percent: 40 });
    expect(offer()).toMatchObject({ variant: "loader", progress: 0.4 });
    emit({ phase: "error", mode: "install" });
    expect(offer()).toBeUndefined();

    emit({ phase: "available", mode: "notify", version: "1.4.0" });
    offer()!.action!.onClick();
    expect(mocks.openReleasePage).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
