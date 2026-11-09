import { create } from "zustand";
import type { Track } from "../ports/player";

export interface RemoveFromLibraryTarget {
  id: string;
  title: string;
  coverUrl: string;
  type: "album" | "artist" | "playlist";
  subtitle?: string;
  isOwned?: boolean;
}

export interface RemoveFromPlaylistTarget {
  trackId: string;
  playlistItemId?: string;
  trackTitle?: string;
  trackArtists?: string;
  trackCoverUrl?: string;
  playlistId?: string;
  playlistTitle?: string;
}

interface Sheets {
  searchOpen: boolean;
  settingsOpen: boolean;
  settingsSection: string | null;
  createPlaylistOpen: boolean;
  createPlaylistPendingTrack: Track | null;
  removeFromLibrary: RemoveFromLibraryTarget | null;
  removeFromPlaylist: RemoveFromPlaylistTarget | null;
  openSearch(): void;
  closeSearch(): void;
  openSettings(): void;
  openSettingsSection(section: string): void;
  closeSettings(): void;
  openCreatePlaylist(initialUrl?: string, track?: Track | null): void;
  closeCreatePlaylist(): void;
  openRemoveFromLibrary(target: RemoveFromLibraryTarget): void;
  closeRemoveFromLibrary(): void;
  openRemoveFromPlaylist(target: RemoveFromPlaylistTarget): void;
  closeRemoveFromPlaylist(): void;
}

export const useModalStore = create<Sheets>((set) => ({
  searchOpen: false,
  settingsOpen: false,
  settingsSection: null,
  createPlaylistOpen: false,
  createPlaylistPendingTrack: null,
  removeFromLibrary: null,
  removeFromPlaylist: null,
  openSearch: () => {
    window.location.hash = "#/search";
  },
  closeSearch: () => set({ searchOpen: false }),
  openSettings: () => set({ settingsOpen: true, settingsSection: null, searchOpen: false }),
  openSettingsSection: (settingsSection) => set({ settingsOpen: true, settingsSection, searchOpen: false }),
  closeSettings: () => set({ settingsOpen: false, settingsSection: null }),
  openCreatePlaylist: (_initialUrl, track = null) => set({ createPlaylistOpen: true, createPlaylistPendingTrack: track }),
  closeCreatePlaylist: () => set({ createPlaylistOpen: false, createPlaylistPendingTrack: null }),
  openRemoveFromLibrary: (removeFromLibrary) => set({ removeFromLibrary }),
  closeRemoveFromLibrary: () => set({ removeFromLibrary: null }),
  openRemoveFromPlaylist: (removeFromPlaylist) => set({ removeFromPlaylist }),
  closeRemoveFromPlaylist: () => set({ removeFromPlaylist: null }),
}));
