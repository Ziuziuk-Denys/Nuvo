import { useState, type JSX, type KeyboardEvent } from "react";
import { Sheet } from "../../components/Sheet";
import { useTranslation } from "../../ports/i18n";
import { snapshotOf } from "../../ports/imports";
import { useAddPlaylistTracks, useCreatePlaylist, useModalStore } from "../../ports/library";
import { useImportsUi } from "../imports/importsUi";
import styles from "./NewPlaylistSheet.module.css";

/** The core refuses longer titles. */
const NAME_MAX = 200;
const DESCRIPTION_MAX = 300;

/**
 * New playlist: the name well with its length count and a description that opens on request. Enter creates, Escape cancels.
 * Opened through the modal store, so a track waiting in "Add to playlist" goes into the new playlist.
 */
export function NewPlaylistSheet(): JSX.Element | null {
  const { t } = useTranslation();
  const open = useModalStore((state) => state.createPlaylistOpen);
  const track = useModalStore((state) => state.createPlaylistPendingTrack);
  const close = useModalStore((state) => state.closeCreatePlaylist);
  const createPlaylist = useCreatePlaylist();
  const addTracks = useAddPlaylistTracks();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [describing, setDescribing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // the playlist exists but the waiting track did not go in: only Done is left, so a retry never makes a twin
  const [created, setCreated] = useState(false);

  // every opening starts blank
  const [shownOpen, setShownOpen] = useState(open);
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) {
      setName("");
      setDescription("");
      setDescribing(false);
      setPending(false);
      setError("");
      setCreated(false);
    }
  }

  const title = name.trim();

  const submit = async () => {
    if (!title || pending || created) return;
    setPending(true);
    setError("");
    let playlistId: string;
    try {
      playlistId = (await createPlaylist.mutateAsync({ title, description: description.trim() || undefined })).id;
    } catch {
      setPending(false);
      setError(t("ui.new_playlist.failed"));
      return;
    }
    if (track) {
      try {
        await addTracks.mutateAsync({ playlistId, track });
      } catch {
        setPending(false);
        setCreated(true);
        setError(t("ui.new_playlist.track_failed"));
        return;
      }
    }
    setPending(false);
    close();
  };

  // the import sheet takes over; a song waiting for a playlist goes into the imported one
  const fromLink = () => {
    close();
    useImportsUi.getState().openImport(track ? { pendingTrack: snapshotOf(track) } : {});
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Shift+Enter keeps its new line in the description
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  };

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    if (!created) setError("");
  };

  const actions = created
    ? [{ label: t("ui.new_playlist.done"), primary: true, onClick: close }]
    : [
        { label: t("ui.new_playlist.cancel"), onClick: close },
        { label: t("ui.new_playlist.create"), primary: true, disabled: !title || pending, onClick: () => void submit() },
      ];

  return (
    <Sheet open={open} onClose={close} title={t("ui.new_playlist.title")} actions={actions}>
      <div className={styles.fields} onKeyDown={onKeyDown} aria-busy={pending}>
        <p className={styles.lead}>{t("common.create_empty_playlist")}</p>
        <label className={styles.well}>
          <input
            value={name}
            maxLength={NAME_MAX}
            placeholder={t("ui.new_playlist.name")}
            aria-label={t("ui.new_playlist.name")}
            aria-invalid={error !== "" && !created}
            onChange={(event) => edit(setName)(event.target.value)}
          />
          <span className={styles.count}>
            {name.length}/{NAME_MAX}
          </span>
        </label>
        {describing ? (
          <textarea
            autoFocus
            className={styles.description}
            rows={2}
            value={description}
            maxLength={DESCRIPTION_MAX}
            placeholder={t("common.description_placeholder")}
            aria-label={t("ui.new_playlist.description")}
            onChange={(event) => edit(setDescription)(event.target.value)}
          />
        ) : (
          <button type="button" className={styles.addDescription} onClick={() => setDescribing(true)}>
            + {t("common.description_placeholder")}
          </button>
        )}
        {created ? null : (
          <button type="button" className={styles.addDescription} onClick={fromLink}>
            {t("ui.add.from_link")}
          </button>
        )}
        <p className={styles.error} role="status">
          {error}
        </p>
      </div>
    </Sheet>
  );
}
