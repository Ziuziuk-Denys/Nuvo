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
  settingsFocus: string | null;
  createPlaylistOpen: boolean;
  createPlaylistPendingTrack: Track | null;
  removeFromLibrary: RemoveFromLibraryTarget | null;
  removeFromPlaylist: RemoveFromPlaylistTarget | null;
  openSearch(): void;
  closeSearch(): void;
  openSettings(): void;
  openSettingsSection(section: string, focus?: string): void;
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
  settingsFocus: null,
  createPlaylistOpen: false,
  createPlaylistPendingTrack: null,
  removeFromLibrary: null,
  removeFromPlaylist: null,
  openSearch: () => set({ searchOpen: true }),
  closeSearch: () => set({ searchOpen: false }),
  openSettings: () => set({ settingsOpen: true, settingsSection: null, settingsFocus: null, searchOpen: false }),
  openSettingsSection: (settingsSection, focus) => set({ settingsOpen: true, settingsSection, settingsFocus: focus ?? null, searchOpen: false }),
  closeSettings: () => set({ settingsOpen: false, settingsSection: null, settingsFocus: null }),
  openCreatePlaylist: (_initialUrl, track = null) => set({ createPlaylistOpen: true, createPlaylistPendingTrack: track }),
  closeCreatePlaylist: () => set({ createPlaylistOpen: false, createPlaylistPendingTrack: null }),
  openRemoveFromLibrary: (removeFromLibrary) => set({ removeFromLibrary }),
  closeRemoveFromLibrary: () => set({ removeFromLibrary: null }),
  openRemoveFromPlaylist: (removeFromPlaylist) => set({ removeFromPlaylist }),
  closeRemoveFromPlaylist: () => set({ removeFromPlaylist: null }),
}));
