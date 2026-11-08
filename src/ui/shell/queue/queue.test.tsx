import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const track = (id: string) => ({ id, title: `Song ${id}`, artists: "Artist", coverUrl: "", durationMs: 60_000, playCount: 0 });
const mocks = vi.hoisted(() => ({
  play: vi.fn(),
  remove: vi.fn(),
  state: { queue: [] as unknown[], currentIndex: 0, repeat: "off", playbackContext: null as string | null, autoplayFrom: null as number | null },
}));
vi.mock("../../ports/player", () => ({
  playerEngine: { playQueueIndex: mocks.play, removeQueueIndex: mocks.remove, reorderQueue: vi.fn(), clearQueue: vi.fn() },
  usePlayerStore: (select: (state: typeof mocks.state) => unknown) => select(mocks.state),
}));

import { useShellStore } from "../shellStore";
import { QueuePanel, radioSeed } from "./QueuePanel";

afterEach(() => {
  useShellStore.setState({ queueOpen: false });
  document.body.innerHTML = "";
});

vi.mock("../../recs/DislikeButton", () => ({ DislikeButton: ({ track }: { track: { id: string } }) => <button data-dislike={track.id} /> }));

describe("QueuePanel", () => {
  it("offers a dislike on every row, the playing one marked so it stays in view", () => {
    mocks.state.queue = [track("a"), track("b")];
    mocks.state.currentIndex = 1;
    useShellStore.setState({ queueOpen: true });
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    act(() => root.render(<QueuePanel />));
    expect([...document.body.querySelectorAll("[data-dislike]")].map((node) => node.getAttribute("data-dislike"))).toEqual(["a", "b"]);
    expect(document.body.querySelector('[data-active] [data-dislike="b"]')).not.toBeNull();
    act(() => root.unmount());
    mocks.state.currentIndex = 0;
  });

  it("shows nothing while closed and lists the queue when open", () => {
    mocks.state.queue = [track("a"), track("b")];
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    act(() => root.render(<QueuePanel />));
    expect(document.body.textContent).not.toContain("Song a");
    act(() => useShellStore.getState().setQueueOpen(true));
    expect(document.body.textContent).toContain("Song a");
    expect(document.body.textContent).toContain("Song b");
    act(() => root.unmount());
  });

  it("plays and removes by index", () => {
    mocks.state.queue = [track("a"), track("b")];
    useShellStore.setState({ queueOpen: true });
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    act(() => root.render(<QueuePanel />));
    const rows = document.body.querySelectorAll<HTMLElement>('[class*="item"] [role], [class*="item"] > div');
    act(() => rows[0]?.click());
    expect(mocks.play).toHaveBeenCalledWith(0);
    const removeButtons = [...document.body.querySelectorAll<HTMLButtonElement>("button")].filter(
      (button) => button.getAttribute("aria-label") === "Remove from queue",
    );
    act(() => removeButtons[1]?.click());
    expect(mocks.remove).toHaveBeenCalledWith(1);
    act(() => root.unmount());
  });

  it("ends with the radio that follows, and says nothing while a repeat holds the queue", () => {
    mocks.state.queue = [track("a"), track("b")];
    useShellStore.setState({ queueOpen: true });
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    act(() => root.render(<QueuePanel />));
    expect(document.body.textContent).toContain("Then: radio from Song b");
    mocks.state.repeat = "all";
    act(() => root.render(<QueuePanel key="again" />));
    expect(document.body.textContent).not.toContain("Then: radio");
    act(() => root.unmount());
    mocks.state.repeat = "off";
  });

  it("names a station's seed, or the last song before the radio began", () => {
    const queue = [{ title: "Seed" }, { title: "Mine" }, { title: "Radio 1" }];
    expect(radioSeed(queue, "radio:x", null)).toBe("Seed");
    expect(radioSeed(queue, "playlist:p", 2)).toBe("Mine");
    expect(radioSeed(queue, "playlist:p", null)).toBe("Radio 1");
    expect(radioSeed([], null, null)).toBeNull();
  });

  it("marks a song its source calls explicit, and only that one", () => {
    mocks.state.queue = [{ ...track("a"), explicit: true }, track("b")];
    useShellStore.setState({ queueOpen: true });
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    act(() => root.render(<QueuePanel />));
    const marks = [...document.body.querySelectorAll('[role="img"][aria-label="Explicit"]')];
    expect(marks).toHaveLength(1);
    expect(marks[0].closest("[data-active], [role=button]")?.textContent).toContain("Song a");
    act(() => root.unmount());
  });
});
