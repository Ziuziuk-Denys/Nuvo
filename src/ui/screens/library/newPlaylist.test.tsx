// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useModalStore } from "../../ports/library";
import { useImportsUi } from "../imports/importsUi";
import { NewPlaylistSheet } from "./NewPlaylistSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ create: vi.fn(), add: vi.fn(), playing: null as { id: string; title: string; artists: string; coverUrl: string } | null }));

vi.mock("../../ports/player", () => ({
  usePlayerStore: (select: (state: { currentTrack: unknown }) => unknown) => select({ currentTrack: mocks.playing }),
}));
vi.mock("../../ports/escape", () => ({ isEscapeGuarded: () => false }));
vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../ports/library", async () => {
  const { create } = await import("zustand");
  const useModalStore = create<{
    createPlaylistOpen: boolean;
    createPlaylistPendingTrack: any | null;
    openCreatePlaylist: (initialUrl?: string, track?: any) => void;
    closeCreatePlaylist: () => void;
  }>((set) => ({
    createPlaylistOpen: false,
    createPlaylistPendingTrack: null,
    openCreatePlaylist: (_initialUrl, track = null) => set({ createPlaylistOpen: true, createPlaylistPendingTrack: track }),
    closeCreatePlaylist: () => set({ createPlaylistOpen: false, createPlaylistPendingTrack: null }),
  }));
  return {
    useModalStore,
    useCreatePlaylist: () => ({ mutateAsync: mocks.create, isPending: false }),
    useAddPlaylistTracks: () => ({ mutateAsync: mocks.add, isPending: false }),
  };
});

let root: Root;
let host: HTMLDivElement;
let opener: HTMLButtonElement;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.create.mockResolvedValue({ id: "pl1", title: "Rain" });
  mocks.add.mockResolvedValue(undefined);
  host = document.createElement("div");
  opener = document.createElement("button");
  document.body.append(host, opener);
  root = createRoot(host);
  act(() => root.render(<NewPlaylistSheet />));
});

afterEach(() => {
  act(() => useModalStore.getState().closeCreatePlaylist());
  act(() => vi.runAllTimers());
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
  mocks.playing = null;
  vi.useRealTimers();
});

function open(track: { id: string } | null = null) {
  opener.focus();
  act(() => useModalStore.getState().openCreatePlaylist(undefined, track as never));
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const inputs = () => [...(dialog()?.querySelectorAll("input") ?? [])];
const button = (label: string) => [...(dialog()?.querySelectorAll("button") ?? [])].find((item) => item.textContent === label)!;

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(key: string, shiftKey = false) {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }));
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("NewPlaylistSheet", () => {
  it("opens titled, with the name field focused and Create disabled until a name is typed", () => {
    open();
    expect(dialog()?.textContent).toContain("ui.new_playlist.title");
    const [name] = inputs();
    expect(document.activeElement).toBe(name);
    expect(button("ui.new_playlist.create").disabled).toBe(true);
    type(name, "   ");
    expect(button("ui.new_playlist.create").disabled).toBe(true);
    type(name, "Rain");
    expect(button("ui.new_playlist.create").disabled).toBe(false);
  });

  it("creates on Enter with the trimmed name and closes", async () => {
    open();
    type(inputs()[0], "  Rain  ");
    press("Enter");
    await settle();
    expect(mocks.create).toHaveBeenCalledWith({ title: "Rain", description: undefined });
    expect(useModalStore.getState().createPlaylistOpen).toBe(false);
  });

  it("does nothing on Enter while the name is empty", async () => {
    open();
    press("Enter");
    await settle();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(useModalStore.getState().createPlaylistOpen).toBe(true);
  });

  it("sends the description from the Create button and adds the waiting track", async () => {
    open({ id: "t9" });
    type(inputs()[0], "Rain");
    act(() => button("common.description_placeholder").click());
    const description = dialog()!.querySelector("textarea")!;
    expect(document.activeElement).toBe(description);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(description, " for slow mornings ");
      description.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("ui.new_playlist.create").click());
    await settle();
    expect(mocks.create).toHaveBeenCalledWith({ title: "Rain", description: "for slow mornings" });
    expect(mocks.add).toHaveBeenCalledWith({ playlistId: "pl1", track: expect.objectContaining({ id: "t9" }) });
    expect(useModalStore.getState().createPlaylistOpen).toBe(false);
  });

  it("shows a daemon failure quietly and keeps the sheet and the name", async () => {
    mocks.create.mockRejectedValueOnce(new Error("title must be 1-200 characters"));
    open();
    type(inputs()[0], "Rain");
    press("Enter");
    await settle();
    expect(useModalStore.getState().createPlaylistOpen).toBe(true);
    expect(dialog()?.querySelector('[role="status"]')?.textContent).toBe("ui.new_playlist.failed");
    expect(inputs()[0].value).toBe("Rain");
    type(inputs()[0], "Rain 2");
    expect(dialog()?.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("offers only Done when the playlist was made but the track did not go in", async () => {
    mocks.add.mockRejectedValueOnce(new Error("offline"));
    open({ id: "t9" });
    type(inputs()[0], "Rain");
    press("Enter");
    await settle();
    expect(dialog()?.querySelector('[role="status"]')?.textContent).toBe("ui.new_playlist.track_failed");
    press("Enter");
    await settle();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    act(() => button("ui.new_playlist.done").click());
    expect(useModalStore.getState().createPlaylistOpen).toBe(false);
  });

  it("cancels on Escape and on Cancel without creating, and gives focus back to the opener", () => {
    open();
    type(inputs()[0], "Rain");
    press("Escape");
    expect(useModalStore.getState().createPlaylistOpen).toBe(false);
    expect(document.activeElement).toBe(opener);

    act(() => vi.runAllTimers());
    open();
    expect(inputs()[0].value).toBe("");
    act(() => button("ui.new_playlist.cancel").click());
    expect(useModalStore.getState().createPlaylistOpen).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps Tab inside the sheet", () => {
    open();
    type(inputs()[0], "Rain");
    const create = button("ui.new_playlist.create");
    create.focus();
    press("Tab");
    expect(document.activeElement).toBe(inputs()[0]);
    press("Tab", true);
    expect(document.activeElement).toBe(create);
  });

  it("From a link closes this sheet and opens the import sheet, keeping a waiting song", () => {
    const song = { id: "t1", title: "Wild", artists: "Ada", coverUrl: "", durationMs: 1000 };
    act(() => useModalStore.getState().openCreatePlaylist(undefined, song));
    const fromLink = [...document.querySelectorAll("button")].find((node) => node.textContent === "ui.add.from_link")!;
    act(() => fromLink.click());
    expect(useModalStore.getState().createPlaylistOpen).toBe(false);
    expect(useImportsUi.getState().sheet).toEqual({ pendingTrack: expect.objectContaining({ id: "t1", title: "Wild" }) });
    act(() => useImportsUi.getState().close());
  });

  it("starts the playlist with the playing song only when it is chosen", async () => {
    mocks.playing = { id: "now", title: "Liability", artists: "Lorde", coverUrl: "" };
    open();
    const starter = dialog()!.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
    expect(starter.getAttribute("aria-pressed")).toBe("false");
    type(inputs()[0], "Rain");
    act(() => starter.click());
    expect(starter.getAttribute("aria-pressed")).toBe("true");
    act(() => button("ui.new_playlist.create").click());
    await settle();
    expect(mocks.add).toHaveBeenCalledWith({ playlistId: "pl1", track: expect.objectContaining({ id: "now" }) });
  });

  it("leaves the playing song out by default", async () => {
    mocks.playing = { id: "now", title: "Liability", artists: "Lorde", coverUrl: "" };
    open();
    type(inputs()[0], "Rain");
    press("Enter");
    await settle();
    expect(mocks.create).toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });
});
