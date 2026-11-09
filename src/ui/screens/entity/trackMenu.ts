import type { MenuItem } from "../../components/Menu";
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
  const items: MenuItem[] = [
    { label: t("ui.entity.play_next"), onSelect: () => actions.playNext(track) },
    { label: t("ui.entity.add_to_queue"), onSelect: () => actions.addToQueue(track) },
    { label: t("ui.entity.add_to_playlist"), onSelect: () => actions.addToPlaylist(track) },
    { label: t("ui.links.share.title"), onSelect: () => useShareSheet.getState().show("", [shareItemOf(track)]) },
    { label: t("ui.entity.start_radio"), onSelect: () => actions.startRadio(track) },
    { label: t("ui.entity.go_artist"), disabled: !artistId, onSelect: () => artistId && actions.goToArtist(artistId) },
    { label: t("ui.entity.go_album"), disabled: !albumId, onSelect: () => albumId && actions.goToAlbum(albumId) },
  ];
  items.push({ label: t("ui.stats.track_stats"), onSelect: () => void (location.hash = `#/stats/track?id=${encodeURIComponent(track.id)}`) });
  if (actions.editLyrics) items.push({ label: t("ui.lyrics.edit"), onSelect: () => actions.editLyrics?.(track) });
  if (actions.translateLyrics) items.push({ label: t("ui.lyrics.translate"), onSelect: () => actions.translateLyrics?.(track) });
  // the daemon trims only a song whose length it knows
  items.push({ label: t("ui.trim.menu"), disabled: !(track.durationMs > 0), onSelect: () => useTrimSheet.getState().open(track) });
  if (!track.id.startsWith("local:")) items.push({ label: t("ui.source.menu"), onSelect: () => useSourceSheet.getState().open(track) });
  const extra: MenuItem[] = [];
  if (actions.saveAsFile) extra.push({ label: t("ui.export.save_file"), onSelect: () => actions.saveAsFile?.(track) });
  if (actions.showInFolder && /^local:[0-9a-f]{32}$/.test(track.id))
    extra.push({ label: t("ui.local.show_in_folder"), onSelect: () => actions.showInFolder?.(track) });
  if (extra.length) items.push("separator", ...extra);
  if (actions.notInterested) items.push("separator", ...notInterestedItems(track, t, actions.notInterested));
  if (context.playlistId && track.playlistItemId) {
    items.push("separator", { label: t("ui.entity.remove_from_playlist"), danger: true, onSelect: () => actions.remove(track) });
  }
  return items;
}
