// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useModalStore } from "../../shell/sheets";
import { useToastStore } from "../../feedback/toastStore";
import { RemoveFromLibrarySheet, RemoveFromPlaylistSheet } from "./RemoveSheets";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ removeItem: vi.fn(), removeTracks: vi.fn(), unlike: vi.fn(), snapshotFirst: vi.fn(), restore: vi.fn() }));

vi.mock("../../ports/escape", () => ({ isEscapeGuarded: () => false }));
vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../ports/library", async () => ({
  useModalStore: (await import("../../shell/sheets")).useModalStore,
  useRemoveExternalItem: () => ({ mutateAsync: mocks.removeItem }),
  useRemovePlaylistTracks: () => ({ mutateAsync: mocks.removeTracks }),
  useUnlikeTrack: () => ({ mutateAsync: mocks.unlike }),
  deleteKeepingSnapshot: mocks.snapshotFirst,
  restoreDeleted: mocks.restore,
}));

let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.removeItem.mockResolvedValue(undefined);
  mocks.removeTracks.mockResolvedValue(undefined);
  mocks.unlike.mockResolvedValue(undefined);
  mocks.snapshotFirst.mockImplementation(async (_id: string, remove: () => Promise<void>) => remove());
  mocks.restore.mockResolvedValue(undefined);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() =>
    root.render(
      <>
        <RemoveFromLibrarySheet />
        <RemoveFromPlaylistSheet />
      </>,
    ),
  );
});

afterEach(() => {
  act(() => vi.runAllTimers());
  act(() => root.unmount());
  document.body.innerHTML = "";
  useToastStore.setState({ queue: [] });
  useModalStore.setState({ removeFromLibrary: null, removeFromPlaylist: null });
  vi.clearAllMocks();
  vi.useRealTimers();
});

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const press = (label: string) => act(async () => [...dialog()!.querySelectorAll("button")].find((b) => b.textContent === label)!.click());

describe("remove from library", () => {
  it("deletes your own playlist after a snapshot, and the notice's Undo brings it back", async () => {
    act(() => useModalStore.getState().openRemoveFromLibrary({ id: "p1", title: "Gym", coverUrl: "", type: "playlist", isOwned: true }));
    await press("common.remove");
    expect(mocks.snapshotFirst).toHaveBeenCalledWith("p1", expect.any(Function));
    expect(mocks.removeItem).toHaveBeenCalledWith({ id: "p1", type: "playlist", isOwned: true });
    const notice = useToastStore.getState().queue.at(-1) as { message: string; action: { label: string; onClick(): void } };
    expect(notice).toMatchObject({ message: "ui.library.deleted", action: { label: "ui.library.undo" } });
    notice.action.onClick();
    expect(mocks.restore).toHaveBeenCalledWith("p1");
  });

  it("names the item, removes it after Remove, says so and closes", async () => {
    act(() => useModalStore.getState().openRemoveFromLibrary({ id: "al", title: "Blue", coverUrl: "", type: "album", isOwned: false }));
    expect(dialog()?.textContent).toContain("Blue");
    await press("common.remove");
    expect(mocks.removeItem).toHaveBeenCalledWith({ id: "al", type: "album", isOwned: false });
    expect(useModalStore.getState().removeFromLibrary).toBeNull();
    expect(useToastStore.getState().queue.at(-1)).toMatchObject({ message: "common.removed_from_library_success" });
  });

  it("Cancel removes nothing", async () => {
    act(() => useModalStore.getState().openRemoveFromLibrary({ id: "al", title: "Blue", coverUrl: "", type: "album" }));
    await press("common.cancel");
    expect(mocks.removeItem).not.toHaveBeenCalled();
    expect(useModalStore.getState().removeFromLibrary).toBeNull();
  });

  it("a failure keeps the sheet open and says so", async () => {
    mocks.removeItem.mockRejectedValue(new Error("down"));
    act(() => useModalStore.getState().openRemoveFromLibrary({ id: "p", title: "Mix", coverUrl: "", type: "playlist", isOwned: true }));
    await press("common.remove");
    expect(useModalStore.getState().removeFromLibrary).not.toBeNull();
    expect(useToastStore.getState().queue.at(-1)).toMatchObject({ message: "common.failed_remove_from_library", variant: "error" });
  });
});

describe("remove from playlist", () => {
  it("takes the track's row out of its playlist", async () => {
    act(() => useModalStore.getState().openRemoveFromPlaylist({ trackId: "t", playlistItemId: "i1", playlistId: "p", trackTitle: "Song" }));
    expect(dialog()?.textContent).toContain("Song");
    await press("common.remove");
    expect(mocks.removeTracks).toHaveBeenCalledWith({ playlistId: "p", itemIds: ["i1"] });
    expect(mocks.unlike).not.toHaveBeenCalled();
    expect(useModalStore.getState().removeFromPlaylist).toBeNull();
  });

  it("on Liked songs the track is unliked", async () => {
    act(() => useModalStore.getState().openRemoveFromPlaylist({ trackId: "t", playlistId: "likes", trackTitle: "Song" }));
    await press("common.remove");
    expect(mocks.unlike).toHaveBeenCalledWith("t");
    expect(mocks.removeTracks).not.toHaveBeenCalled();
  });
});
