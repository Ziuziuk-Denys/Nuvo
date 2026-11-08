import { describe, expect, it } from "vitest";
import { useModalStore } from "./sheets";

const track = { id: "t", title: "T", artists: "A", coverUrl: "", durationMs: 1 };

describe("sheet store", () => {
  it("create playlist keeps the waiting track until it closes", () => {
    useModalStore.getState().openCreatePlaylist(undefined, track);
    expect(useModalStore.getState()).toMatchObject({ createPlaylistOpen: true, createPlaylistPendingTrack: track });
    useModalStore.getState().closeCreatePlaylist();
    expect(useModalStore.getState()).toMatchObject({ createPlaylistOpen: false, createPlaylistPendingTrack: null });
  });

  it("remove sheets hold their target until closed", () => {
    const target = { id: "p", title: "P", coverUrl: "", type: "playlist" as const, isOwned: true };
    useModalStore.getState().openRemoveFromLibrary(target);
    expect(useModalStore.getState().removeFromLibrary?.id).toBe("p");
    useModalStore.getState().closeRemoveFromLibrary();
    expect(useModalStore.getState().removeFromLibrary).toBeNull();
    useModalStore.getState().openRemoveFromPlaylist({ trackId: "t", playlistId: "p", trackTitle: "T" });
    expect(useModalStore.getState().removeFromPlaylist?.trackId).toBe("t");
    useModalStore.getState().closeRemoveFromPlaylist();
    expect(useModalStore.getState().removeFromPlaylist).toBeNull();
  });

  it("settings open on a requested section and forget it on close; search closes when settings open", () => {
    useModalStore.getState().openSearch();
    useModalStore.getState().openSettingsSection("hidden");
    expect(useModalStore.getState()).toMatchObject({ settingsOpen: true, settingsSection: "hidden", searchOpen: false });
    useModalStore.getState().closeSettings();
    expect(useModalStore.getState()).toMatchObject({ settingsOpen: false, settingsSection: null });
    useModalStore.getState().openSettings();
    expect(useModalStore.getState().settingsOpen).toBe(true);
    useModalStore.getState().closeSettings();
  });
});
