import { useState, type JSX } from "react";
import { Sheet } from "../../components/Sheet";
import { useToastStore } from "../../feedback/toastStore";
import { useTranslation } from "../../ports/i18n";
import { deleteKeepingSnapshot, restoreDeleted, useModalStore, useRemoveExternalItem, useRemovePlaylistTracks, useUnlikeTrack } from "../../ports/library";
import { UNDO_MS } from "../../ports/playlistTools";
import styles from "./NewPlaylistSheet.module.css";

/** The Liked songs page uses this in place of a playlist id. */
const LIKED_ID = "likes";

/** The last non-null value, so a sheet sliding out still shows what it was about. */
function useLast<T>(value: T | null): T | null {
  const [last, setLast] = useState(value);
  if (value && value !== last) setLast(value);
  return value ?? last;
}

/** Confirms taking an album, artist or playlist out of the library; your own playlist is deleted. */
export function RemoveFromLibrarySheet(): JSX.Element {
  const { t } = useTranslation();
  const target = useModalStore((state) => state.removeFromLibrary);
  const close = useModalStore((state) => state.closeRemoveFromLibrary);
  const remove = useRemoveExternalItem();
  const shown = useLast(target);
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    if (!target || pending) return;
    setPending(true);
    const run = () => remove.mutateAsync({ id: target.id, type: target.type, isOwned: target.isOwned });
    try {
      if (target.type === "playlist" && target.isOwned) {
        // your own playlist is gone for good once deleted, so a snapshot taken first lets Undo bring it back
        await deleteKeepingSnapshot(target.id, run);
        const undo = () =>
          void restoreDeleted(target.id).catch(() => useToastStore.getState().show({ message: t("ui.library.undo_failed"), variant: "error" }));
        useToastStore.getState().show({
          message: t("ui.library.deleted", { title: target.title }),
          variant: "checkmark",
          duration: UNDO_MS,
          action: { label: t("ui.library.undo"), onClick: undo },
        });
      } else {
        await run();
        useToastStore.getState().show({ message: t("common.removed_from_library_success"), variant: "success" });
      }
      close();
    } catch {
      useToastStore.getState().show({ message: t("common.failed_remove_from_library"), variant: "error" });
    } finally {
      setPending(false);
    }
  };

  return (
    <Sheet
      open={target !== null}
      onClose={close}
      title={t("common.remove_from_library")}
      actions={[
        { label: t("common.cancel"), onClick: close },
        { label: t("common.remove"), primary: true, onClick: () => void confirm(), disabled: pending },
      ]}
    >
      <p className={styles.lead}>
        <strong>{shown?.title}</strong>
        <br />
        {t("common.remove_from_library_desc")}
      </p>
    </Sheet>
  );
}

/** Confirms taking one track out of a playlist, or out of Liked songs. */
export function RemoveFromPlaylistSheet(): JSX.Element {
  const { t } = useTranslation();
  const target = useModalStore((state) => state.removeFromPlaylist);
  const close = useModalStore((state) => state.closeRemoveFromPlaylist);
  const removeTracks = useRemovePlaylistTracks();
  const unlike = useUnlikeTrack();
  const shown = useLast(target);
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    if (!target || pending) return;
    setPending(true);
    try {
      if (target.playlistId && target.playlistId !== LIKED_ID && target.playlistItemId) {
        await removeTracks.mutateAsync({ playlistId: target.playlistId, itemIds: [target.playlistItemId] });
      } else {
        await unlike.mutateAsync(target.trackId);
      }
      useToastStore.getState().show({ message: t("common.removed_from_playlist"), variant: "success" });
      close();
    } catch {
      useToastStore.getState().show({ message: t("common.failed_to_remove_track"), variant: "error" });
    } finally {
      setPending(false);
    }
  };

  return (
    <Sheet
      open={target !== null}
      onClose={close}
      title={t("common.remove_from_playlist")}
      actions={[
        { label: t("common.cancel"), onClick: close },
        { label: t("common.remove"), primary: true, onClick: () => void confirm(), disabled: pending },
      ]}
    >
      <p className={styles.lead}>
        <strong>{shown?.trackTitle}</strong>
        <br />
        {t("common.remove_track_from_playlist_desc")}
      </p>
    </Sheet>
  );
}
