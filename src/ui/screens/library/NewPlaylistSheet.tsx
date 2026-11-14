import { useId, useState, type JSX, type KeyboardEvent } from "react";
import { Button } from "../../components/Button";
import { Cover } from "../../components/Cover";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { GlassSheet } from "../../sheets/GlassSheet";
import glass from "../../sheets/GlassSheet.module.css";
import { snapshotOf } from "../../ports/imports";
import { useAddPlaylistTracks, useCreatePlaylist, useModalStore } from "../../ports/library";
import { usePlayerStore } from "../../ports/player";
import { useImportsUi } from "../imports/importsUi";
import styles from "./NewPlaylistSheet.module.css";

/** The core refuses longer titles. */
const NAME_MAX = 200;
const DESCRIPTION_MAX = 300;
const NAME_NEAR = 160;

export function NewPlaylistSheet(): JSX.Element | null {
  const { t } = useTranslation();
  const open = useModalStore((state) => state.createPlaylistOpen);
  const pendingTrack = useModalStore((state) => state.createPlaylistPendingTrack);
  const playing = usePlayerStore((state) => state.currentTrack);
  const close = useModalStore((state) => state.closeCreatePlaylist);
  const createPlaylist = useCreatePlaylist();
  const addTracks = useAddPlaylistTracks();
  const titleId = useId();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [describing, setDescribing] = useState(false);
  const [withPlaying, setWithPlaying] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // the playlist exists but the waiting track did not go in: only Done is left, so a retry never makes a twin
  const [created, setCreated] = useState(false);

  const [shownOpen, setShownOpen] = useState(open);
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) {
      setName("");
      setDescription("");
      setDescribing(false);
      setWithPlaying(false);
      setPending(false);
      setError("");
      setCreated(false);
    }
  }

  const title = name.trim();
  // a song handed over by Add to playlist always goes in; the playing one only when chosen
  const starter = pendingTrack ?? playing;
  const track = pendingTrack ?? (withPlaying ? playing : null);

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

  const fromLink = () => {
    close();
    useImportsUi.getState().openImport(track ? { pendingTrack: snapshotOf(track) } : {});
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  };

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    if (!created) setError("");
  };

  return (
    <GlassSheet open={open} onClose={close} labelledBy={titleId} width={440}>
      <div className={styles.head} onKeyDown={onKeyDown} aria-busy={pending}>
        <div className={styles.fields}>
          <h2 id={titleId} className={styles.eyebrow}>
            {t("ui.new_playlist.title")}
          </h2>
          <label className={styles.name}>
            <input
              value={name}
              maxLength={NAME_MAX}
              placeholder={t("ui.new_playlist.name")}
              aria-label={t("ui.new_playlist.name")}
              aria-invalid={error !== "" && !created}
              onChange={(event) => edit(setName)(event.target.value)}
            />
            {name.length >= NAME_NEAR ? (
              <span className={styles.count}>
                {name.length}/{NAME_MAX}
              </span>
            ) : null}
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
            <button type="button" className={`${glass.quiet} ${styles.describe}`} onClick={() => setDescribing(true)}>
              <Icon name="add" size={16} />
              {t("common.description_placeholder")}
            </button>
          )}
        </div>
      </div>
      {starter && !created ? (
        <button
          type="button"
          className={styles.starter}
          aria-pressed={!!track}
          disabled={!!pendingTrack}
          aria-label={t("ui.new_playlist.with_song", { title: starter.title })}
          onClick={() => setWithPlaying(!withPlaying)}
        >
          <Cover src={starter.coverUrl ?? ""} size={36} radius={9} />
          <span className={styles.starterText}>
            <span className={styles.starterTitle}>{starter.title}</span>
            <span className={styles.starterArtist}>{pendingTrack ? starter.artists : `${starter.artists} · ${t("ui.new_playlist.playing")}`}</span>
          </span>
          <span className={styles.mark} key={track ? "in" : "out"}>
            <Icon name={track ? "check" : "add"} size={16} />
          </span>
        </button>
      ) : null}
      <p className={styles.error} role="status">
        {error}
      </p>
      <div className={glass.footer}>
        {created ? null : (
          <button type="button" className={`${glass.quiet} ${glass.start}`} onClick={fromLink}>
            <Icon name="link" size={16} />
            {t("ui.add.from_link")}
          </button>
        )}
        {created ? (
          <Button variant="primary" onClick={close}>
            {t("ui.new_playlist.done")}
          </Button>
        ) : (
          <>
            <Button onClick={close}>{t("ui.new_playlist.cancel")}</Button>
            <Button variant="primary" disabled={!title || pending} onClick={() => void submit()}>
              {t("ui.new_playlist.create")}
            </Button>
          </>
        )}
      </div>
    </GlassSheet>
  );
}
