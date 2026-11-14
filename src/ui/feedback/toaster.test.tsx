// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { Toaster } from "./Toaster";
import { useToastStore } from "./toastStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ status: "ready", reachable: true }));

vi.mock("../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../ports/core", () => ({ useCoreStatus: () => mocks.status }));
vi.mock("../ports/network", () => ({ useStreamingReachable: () => mocks.reachable }));
vi.mock("../screens/lock/gateState", async () => {
  const { create } = await import("zustand");
  return { useGateStore: create(() => ({ locked: false })) };
});

let root: Root;
let host: HTMLDivElement;

const show = (input: Parameters<ReturnType<typeof useToastStore.getState>["show"]>[0]) => act(() => useToastStore.getState().show(input));
const card = () => host.querySelector<HTMLElement>("[data-toast]");
const messages = () => useToastStore.getState().queue.map((toast) => toast.message);

function hover(element: Element, inside: boolean) {
  act(() => {
    element.dispatchEvent(new MouseEvent(inside ? "mouseover" : "mouseout", { bubbles: true, relatedTarget: inside ? document.body : document.body }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.status = "ready";
  mocks.reachable = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Toaster />));
});

afterEach(() => {
  act(() => root.unmount());
  useToastStore.setState({ queue: [] });
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("Toaster", () => {
  it("shows one toast at a time with its action", () => {
    const onClick = vi.fn();
    show({ message: "Added to Rain", action: { label: "Undo", onClick } });
    show({ message: "Second" });
    expect(host.querySelectorAll("[data-toast]")).toHaveLength(1);
    expect(card()?.getAttribute("role")).toBe("status");
    expect(card()?.textContent).toContain("Added to Rain");
    act(() => card()!.querySelector("button")!.click());
    expect(onClick).toHaveBeenCalledOnce();
    expect(messages()).toEqual(["Second"]);
  });

  it("announces errors as alerts", () => {
    show({ message: "Could not save", variant: "error" });
    expect(card()?.getAttribute("role")).toBe("alert");
  });

  it("hides after 4 s and pauses while the pointer is on it", () => {
    show({ message: "Liked" });
    act(() => vi.advanceTimersByTime(3900));
    expect(messages()).toEqual(["Liked"]);
    hover(card()!, true);
    act(() => vi.advanceTimersByTime(10_000));
    expect(messages()).toEqual(["Liked"]);
    hover(card()!, false);
    act(() => vi.advanceTimersByTime(4000));
    expect(messages()).toEqual([]);
  });

  it("keeps a sticky toast until it is dismissed", () => {
    show({ message: "Importing", variant: "loader" });
    act(() => vi.advanceTimersByTime(60_000));
    expect(messages()).toEqual(["Importing"]);
  });

  it("says when the library service is retrying and clears it when it is back", () => {
    act(() => root.unmount());
    mocks.status = "restarting";
    root = createRoot(host);
    act(() => root.render(<Toaster />));
    expect(card()?.textContent).toContain("ui.status.retrying");
    act(() => vi.advanceTimersByTime(60_000));
    expect(messages()).toEqual(["ui.status.retrying"]);
    mocks.status = "ready";
    act(() => root.render(<Toaster />));
    expect(messages()).toEqual([]);
  });

  it("says nothing for a quick start, then a quiet loader if the start drags on", () => {
    act(() => root.unmount());
    mocks.status = "starting";
    root = createRoot(host);
    act(() => root.render(<Toaster />));
    act(() => vi.advanceTimersByTime(1000));
    expect(messages()).toEqual([]);
    act(() => vi.advanceTimersByTime(1000));
    expect(card()?.textContent).toContain("ui.status.starting");
    expect(card()?.getAttribute("role")).toBe("status");
    mocks.status = "ready";
    act(() => root.render(<Toaster />));
    expect(messages()).toEqual([]);
  });

  it("says a stopped service stays stopped, with what to do", () => {
    act(() => root.unmount());
    mocks.status = "failed";
    root = createRoot(host);
    act(() => root.render(<Toaster />));
    expect(card()?.getAttribute("role")).toBe("alert");
    expect(card()?.textContent).toContain("ui.status.failed");
    expect(card()?.textContent).toContain("ui.status.failed_hint");
    act(() => vi.advanceTimersByTime(60_000));
    expect(messages()).toEqual(["ui.status.failed"]);
  });

  it("says offline once per session, for 8 s, with no button to press", () => {
    mocks.reachable = false;
    act(() => root.render(<Toaster />));
    expect(card()?.textContent).toContain("ui.status.offline");
    expect(card()?.textContent).toContain("ui.status.offline_hint");
    expect(card()?.querySelector("button")).toBeNull();
    act(() => vi.advanceTimersByTime(8000));
    expect(messages()).toEqual([]);
    mocks.reachable = true;
    act(() => root.render(<Toaster />));
    mocks.reachable = false;
    act(() => root.render(<Toaster />));
    expect(messages()).toEqual([]);
  });
});
