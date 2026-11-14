import type { MenuAction, MenuItem } from "../../components/Menu";
import type { TFunction } from "../../ports/i18n";
import type { Track } from "../../ports/player";
import type { NotInterestedScope } from "../../ports/recs";
import { notInterestedItems } from "../../recs/notInterestedItems";
import { shareItemOf, useShareSheet } from "../../sheets/ShareSheet";
import { useSourceSheet } from "../../sheets/SourceSheet";
import { useTrimSheet } from "../../sheets/TrimSheet";

export interface TrackMenuActions {
  t: TFunction;
  playNext(track: Track): void;
  addToQueue(track: Track): void;
  addToPlaylist(track: Track): void;
  startRadio(track: Track): void;
  goToArtist(artistId: string): void;
  goToAlbum(albumId: string): void;
  remove(track: Track): void;
  notInterested?(track: Track, scope: NotInterestedScope): void;
  editLyrics?(track: Track): void;
  translateLyrics?(track: Track): void;
  saveAsFile?(track: Track): void;
  showInFolder?(track: Track): void;
}

export function trackMenuItems(track: Track, context: { playlistId?: string }, actions: TrackMenuActions): MenuItem[] {
  const { t } = actions;
  const artistId = track.artistId;
  const albumId = track.album?.id;
  const sections: MenuItem[][] = [
    [
      { label: t("ui.entity.play_next"), icon: "next", onSelect: () => actions.playNext(track) },
      { label: t("ui.entity.add_to_queue"), icon: "queue", onSelect: () => actions.addToQueue(track) },
      { label: t("ui.entity.start_radio"), icon: "radio", onSelect: () => actions.startRadio(track) },
    ],
    [
      { label: t("ui.entity.add_to_playlist"), icon: "playlist-add", onSelect: () => actions.addToPlaylist(track) },
      { label: t("ui.links.share.title"), icon: "export", onSelect: () => useShareSheet.getState().show("", [shareItemOf(track)]) },
    ],
  ];
  const goTo: MenuItem[] = [];
  if (artistId) goTo.push({ label: t("ui.entity.go_artist"), icon: "artist", onSelect: () => actions.goToArtist(artistId) });
  if (albumId) goTo.push({ label: t("ui.entity.go_album"), icon: "album", onSelect: () => actions.goToAlbum(albumId) });
  goTo.push({ label: t("ui.stats.track_stats"), icon: "stats", onSelect: () => void (location.hash = `#/stats/track?id=${encodeURIComponent(track.id)}`) });
  sections.push(goTo);

  const tools: MenuItem[] = [];
  const lyrics: MenuAction[] = [];
  if (actions.editLyrics) lyrics.push({ label: t("ui.lyrics.edit"), onSelect: () => actions.editLyrics?.(track) });
  if (actions.translateLyrics) lyrics.push({ label: t("ui.lyrics.translate"), onSelect: () => actions.translateLyrics?.(track) });
  if (lyrics.length > 1) tools.push({ label: t("ui.lyrics.edit_title"), icon: "lyrics", items: lyrics });
  else if (lyrics[0]) tools.push({ ...lyrics[0], icon: "lyrics" });
  // the daemon trims only a song whose length it knows
  if (track.durationMs > 0) tools.push({ label: t("ui.trim.menu"), icon: "trim", onSelect: () => useTrimSheet.getState().open(track) });
  if (!track.id.startsWith("local:")) tools.push({ label: t("ui.source.menu"), icon: "link", onSelect: () => useSourceSheet.getState().open(track) });
  sections.push(tools);

  const file: MenuItem[] = [];
  if (actions.saveAsFile) file.push({ label: t("ui.export.save_file"), icon: "download", onSelect: () => actions.saveAsFile?.(track) });
  if (actions.showInFolder && /^local:[0-9a-f]{32}$/.test(track.id))
    file.push({ label: t("ui.local.show_in_folder"), icon: "folder", onSelect: () => actions.showInFolder?.(track) });
  sections.push(file);

  if (actions.notInterested) sections.push([{ label: t("ui.recs.dislike"), icon: "dislike", items: notInterestedItems(track, t, actions.notInterested) }]);
  if (context.playlistId && track.playlistItemId) {
    sections.push([{ label: t("ui.entity.remove_from_playlist"), icon: "remove", danger: true, onSelect: () => actions.remove(track) }]);
  }
  return sections.filter((section) => section.length > 0).flatMap((section, index) => (index === 0 ? section : ["separator" as const, ...section]));
}
