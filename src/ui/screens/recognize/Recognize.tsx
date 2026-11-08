import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type JSX } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/Button";
import { Cover } from "../../components/Cover";
import { Enter } from "../../components/Enter";
import { IconButton } from "../../components/IconButton";
import { Menu } from "../../components/Menu";
import { Popover } from "../../components/Popover";
import { TextField } from "../../components/TextField";
import { Icon } from "../../icons/Icon";
import { usePageBackdrop } from "../../ports/backdrop";
import { useTranslation } from "../../ports/i18n";
import { useIsTrackLiked, useLikeTrack, useUnlikeTrack } from "../../ports/library";
import { useOnline } from "../../ports/network";
import { playerEngine, type Track } from "../../ports/player";
import { findSong, songFacts, timeAgo, type RecognizedEntry, type RecognizedSong, type Session } from "../../ports/recognize";
import { DislikeButton } from "../../recs/DislikeButton";
import { navigateWithTransition } from "../../shell/navigate";
import { openExternal } from "../../ports/system";
import { AddToPlaylistPopover } from "../../shell/popovers/AddToPlaylistPopover";
import { formatDuration } from "../entity/entityModel";
import { MediaRow } from "../MediaRow";
import look from "../look.module.css";
import { recognizeText } from "./recognizeText";
import { useCatalogSong, useRecognize, useRecognizeHistory } from "./useRecognize";
import { Wave } from "./Wave";
import styles from "./Recognize.module.css";
import { useDroppedFile } from "./recognizeDrop";

const COVER_PX = 168;
const NO_PEAKS: number[] = [];

function play(track: Track, fromMs = 0): void {
  void playerEngine.playTrack(track, [track]);
  // the start is still loading, so the engine holds the seek until the audio is there
  if (fromMs > 0) playerEngine.seek(fromMs);
}

/** "Play from 1:23" when the service said where the heard part starts. */
function moment(song: RecognizedSong): { ms: number; clock: string } | null {
  const clock = song.offsetMs ? formatDuration(song.offsetMs) : undefined;
  return clock && song.offsetMs ? { ms: song.offsetMs, clock } : null;
}

/** The screen: the listening panel or the result card, then what was recognized before. */
export function Recognize(): JSX.Element {
  const { t } = useTranslation();
  const reachable = useOnline();
  const { session, start, startFile, startLink, anotherPart, stop } = useRecognize();
  const found = session.phase === "found" ? session : null;
  const { items, forget } = useRecognizeHistory(found?.id ?? null);
  const [dragging, setDragging] = useState(false);
  // the link stays after a run, so a failed one can be fixed and sent again
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  usePageBackdrop(found?.song.coverUrl);
  const dropped = useDroppedFile((state) => state.file);
  useEffect(() => {
    const file = dropped ? useDroppedFile.getState().take() : null;
    if (file && reachable) void startFile(file);
  }, [dropped, reachable, startFile]);

  const onPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void startFile(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && reachable) void startFile(file);
  };

  const sendLink = () => {
    if (!link.trim() || !reachable) return;
    setLinkOpen(false);
    startLink(link);
  };

  const sources = linkOpen ? (
    <div
      className={styles.linkForm}
      data-tour="recognize-sources"
      data-recognize-link=""
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        setLinkOpen(false);
      }}
    >
      <div className={styles.linkField}>
        <TextField
          value={link}
          onChange={setLink}
          label={t("ui.recognize.link_label")}
          placeholder={t("ui.recognize.link_placeholder")}
          maxLength={2048}
          onClear={() => setLink("")}
          onSubmit={sendLink}
          autoFocus
        />
      </div>
      <Button variant="primary" disabled={!reachable || !link.trim()} onClick={sendLink}>
        {t("ui.recognize.link_go")}
      </Button>
      <Button onClick={() => setLinkOpen(false)}>{t("common.cancel")}</Button>
    </div>
  ) : (
    <div className={styles.sources} data-tour="recognize-sources">
      <Button variant="primary" disabled={!reachable} onClick={() => start("microphone")}>
        <Icon name="microphone" size={16} />
        {t("ui.recognize.microphone")}
      </Button>
      <Button disabled={!reachable} onClick={() => start("system")}>
        <Icon name="output" size={16} />
        {t("ui.recognize.system")}
      </Button>
      <Button disabled={!reachable} onClick={() => picker.current?.click()}>
        <Icon name="folder" size={16} />
        {t("ui.recognize.file")}
      </Button>
      <Button disabled={!reachable} onClick={() => setLinkOpen(true)}>
        <Icon name="link" size={16} />
        {t("ui.recognize.link")}
      </Button>
    </div>
  );

  return (
    <div
      className={styles.page}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <Enter index={0} screen="recognize">
        <h1 className={styles.title}>{t("ui.recognize.title")}</h1>
      </Enter>
      <Enter index={1} screen="recognize">
        <section className={styles.panel} data-dragging={dragging ? "" : undefined} data-recognize={session.phase} aria-label={t("ui.recognize.title")}>
          {session.phase === "found" ? (
            <ResultCard song={session.song} onAgain={stop} />
          ) : (
            <Listener session={session} reachable={reachable} sources={sources} onStop={stop} onAnotherPart={anotherPart} />
          )}
        </section>
      </Enter>
      <input ref={picker} type="file" hidden accept="audio/*,video/*" data-recognize-file="" onChange={onPicked} />
      {items.length > 0 ? (
        <Enter index={2} screen="recognize">
          <History items={items} onForget={forget} />
        </Enter>
      ) : null}
    </div>
  );
}

function Listener({
  session,
  reachable,
  sources,
  onStop,
  onAnotherPart,
}: {
  session: Exclude<Session, { phase: "found" }>;
  reachable: boolean;
  sources: JSX.Element;
  onStop(): void;
  onAnotherPart(): void;
}): JSX.Element {
  const { t } = useTranslation();
  const active = session.phase === "listening";
  const text = recognizeText(session, reachable, t);
  return (
    <div className={styles.listener} aria-busy={active}>
      <Wave peaks={active ? session.peaks : NO_PEAKS} live={active} />
      <div role="status" className={styles.words}>
        <h2 className={styles.state}>{text.title}</h2>
        <p className={styles.line}>{text.line}</p>
      </div>
      {active ? (
        <Button onClick={onStop}>{t("ui.recognize.stop")}</Button>
      ) : (
        <>
          {session.phase === "not_found" && session.more ? (
            <Button variant="text" size="s" onClick={onAnotherPart}>
              {t("ui.recognize.another_part")}
            </Button>
          ) : null}
          {sources}
        </>
      )}
    </div>
  );
}

function ResultCard({ song, onAgain }: { song: RecognizedSong; onAgain(): void }): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const track = useCatalogSong(song);
  const liked = useIsTrackLiked(track?.id);
  const like = useLikeTrack();
  const unlike = useUnlikeTrack();
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const facts = songFacts(song);
  const from = moment(song);
  const searchFor = () => navigateWithTransition(navigate, `/search?q=${encodeURIComponent(`${song.artist} ${song.title}`)}`);

  return (
    <div className={`${styles.result} n-enter`} data-recognize-result="">
      <Cover src={song.coverUrl ?? ""} size={COVER_PX} radius={12} />
      <div className={styles.about}>
        <h2 className={styles.song}>{song.title}</h2>
        <p className={styles.artist}>{song.artist}</p>
        {facts ? <p className={styles.facts}>{facts}</p> : null}
        <div className={styles.actions}>
          {track === null ? (
            <Button variant="primary" onClick={searchFor}>
              {t("ui.recognize.search")}
            </Button>
          ) : (
            <Button variant="primary" disabled={!track} onClick={() => track && play(track, from?.ms)}>
              <Icon name="play" size={16} />
              {from ? t("ui.recognize.play_from", { time: from.clock }) : t("ui.recognize.play")}
            </Button>
          )}
          {track ? (
            <>
              <IconButton
                icon={liked ? "liked" : "like"}
                label={liked ? t("ui.island.unlike") : t("ui.island.like")}
                data-recognize-like=""
                onClick={() => (liked ? unlike.mutate(track.id) : like.mutate(track))}
              />
              <IconButton
                icon="playlist-add"
                label={t("common.add_to_playlist")}
                aria-haspopup="dialog"
                aria-expanded={addOpen}
                tooltip={!addOpen}
                onClick={(event) => {
                  setAddAnchor(event.currentTarget);
                  setAddOpen(true);
                }}
              />
              <DislikeButton track={track} />
            </>
          ) : null}
        </div>
        <div className={styles.links}>
          {song.appleMusicUrl ? (
            <Button variant="text" onClick={() => openExternal(song.appleMusicUrl ?? "")}>
              {t("ui.recognize.apple_music")}
            </Button>
          ) : null}
          <Button variant="text" onClick={onAgain}>
            {t("ui.recognize.again")}
          </Button>
        </div>
        {track === null ? <p className={styles.note}>{t("ui.recognize.not_in_catalog")}</p> : null}
      </div>
      <Popover open={addOpen} anchor={addAnchor} onClose={() => setAddOpen(false)} title={t("ui.add.title")} width={320}>
        {track ? <AddToPlaylistPopover track={track} onDone={() => setAddOpen(false)} /> : null}
      </Popover>
    </div>
  );
}

interface RowMenu {
  entry: RecognizedEntry;
  anchor: HTMLElement | null;
  at?: { x: number; y: number };
}

function History({ items, onForget }: { items: RecognizedEntry[]; onForget(id: string): void }): JSX.Element {
  const { t, locale } = useTranslation();
  const like = useLikeTrack();
  const [menu, setMenu] = useState<RowMenu | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [add, setAdd] = useState<{ track: Track; anchor: HTMLElement | null } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [now] = useState(Date.now);
  // a history row holds what was heard; the catalog's copy is looked up when an action needs it
  const catalog = useRef(new Map<string, Promise<Track | null>>());
  const lookUp = (entry: RecognizedEntry) => {
    const known = catalog.current.get(entry.id);
    if (known) return known;
    const found = findSong(entry.track, new AbortController().signal);
    catalog.current.set(entry.id, found);
    return found;
  };
  const withTrack = (entry: RecognizedEntry, action: (track: Track) => void) => void lookUp(entry).then((track) => track && action(track));
  const openMenu = (entry: RecognizedEntry, anchor: HTMLElement | null, at?: { x: number; y: number }) => {
    setMenu({ entry, anchor, at });
    setMenuOpen(true);
  };

  return (
    <section className={styles.history} aria-label={t("ui.recognize.history")}>
      <div className={look.sectionHead}>
        <h2 className={look.sectionTitle}>{t("ui.recognize.history")}</h2>
      </div>
      <div className={styles.rows}>
        {items.map((entry) => (
          <MediaRow
            key={entry.id}
            data-recognize-row=""
            data-selected={menuOpen && menu?.entry.id === entry.id ? "" : undefined}
            leading={<Cover src={entry.track.coverUrl ?? ""} size={48} radius={8} fetchPriority="low" />}
            title={entry.track.title}
            subtitle={entry.track.artist}
            meta={timeAgo(entry.createdAt, now, locale)}
            extra={<DislikeButton track={() => lookUp(entry)} />}
            onActivate={() => withTrack(entry, (track) => play(track))}
            onContextMenu={(event) => {
              event.preventDefault();
              openMenu(entry, event.currentTarget, { x: event.clientX, y: event.clientY });
            }}
            menuLabel={t("ui.entity.more")}
            onMenu={(anchor) => openMenu(entry, anchor)}
          />
        ))}
      </div>
      <Menu
        open={menuOpen}
        anchor={menu?.anchor ?? null}
        at={menu?.at}
        onClose={() => setMenuOpen(false)}
        items={
          menu
            ? [
                { label: t("ui.recognize.play"), onSelect: () => withTrack(menu.entry, play) },
                ...(moment(menu.entry.track)
                  ? [
                      {
                        label: t("ui.recognize.play_from", { time: moment(menu.entry.track)?.clock ?? "" }),
                        onSelect: () => withTrack(menu.entry, (track) => play(track, menu.entry.track.offsetMs)),
                      },
                    ]
                  : []),
                { label: t("common.like"), onSelect: () => withTrack(menu.entry, (track) => like.mutate(track)) },
                {
                  label: t("common.add_to_playlist"),
                  onSelect: () =>
                    withTrack(menu.entry, (track) => {
                      setAdd({ track, anchor: menu.anchor });
                      setAddOpen(true);
                    }),
                },
                ...(menu.entry.track.appleMusicUrl
                  ? [{ label: t("ui.recognize.apple_music"), onSelect: () => openExternal(menu.entry.track.appleMusicUrl ?? "") }]
                  : []),
                "separator",
                { label: t("ui.recognize.forget"), onSelect: () => onForget(menu.entry.id) },
              ]
            : []
        }
      />
      <Popover open={addOpen} anchor={add?.anchor ?? null} onClose={() => setAddOpen(false)} title={t("ui.add.title")} width={320}>
        {add ? <AddToPlaylistPopover track={add.track} onDone={() => setAddOpen(false)} /> : null}
      </Popover>
    </section>
  );
}
