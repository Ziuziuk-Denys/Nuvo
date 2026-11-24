import { useEffect, useMemo, useState, type CSSProperties, type JSX } from "react";
import { Cover } from "../../../components/Cover";
import { continueFrom, kept, plays, type Play } from "../../../ports/homeMoments";
import { playSongs } from "../../../ports/homeShelves";
import { useTranslation } from "../../../ports/i18n";
import { usePlaylistsList } from "../../../ports/library";
import { ShelfHeading } from "../ShelfHeading";
import { sessionsOf, whenOf, type Session } from "./moments";
import styles from "./Continue.module.css";

const SESSIONS = 8;
const FANNED = 5;
const COVER = 148;

function usePlays(offline: boolean): Play[] {
  const [found, setFound] = useState<Play[]>([]);
  useEffect(() => {
    let live = true;
    void plays().then(async (all) => {
      const here = offline ? await kept(all.map((play) => play.track)) : null;
      if (live) setFound(here ? all.filter((play) => here.has(play.track.id)) : all);
    });
    return () => {
      live = false;
    };
  }, [offline]);
  return found;
}

export function Continue({ offline }: { offline: boolean }): JSX.Element | null {
  const { t } = useTranslation();
  const found = usePlays(offline);
  const { data } = usePlaylistsList();
  const [now] = useState(Date.now);
  const sessions = useMemo(() => {
    const names = new Map(data.playlists.map((playlist) => [playlist.id, playlist.title]));
    return sessionsOf(found, names, now, SESSIONS);
  }, [found, data.playlists, now]);
  if (sessions.length === 0) return null;
  return (
    <section aria-label={t("ui.home.continue.title")} data-continue="">
      <ShelfHeading title={t("ui.home.continue.title")} />
      <div className={styles.row}>
        {sessions.map((session) => (
          <SessionObject key={session.id} session={session} now={now} />
        ))}
      </div>
    </section>
  );
}

function SessionObject({ session, now }: { session: Session; now: number }): JSX.Element {
  const { t, locale } = useTranslation();
  const when = whenOf(session.endedAt, now, locale);
  const { source } = session;
  const title = source.kind === "artists" ? t("ui.home.continue.artists", { name: source.names[0] }) : source.name;
  const clock = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(session.startedAt);
  const time = t("ui.home.continue.time", { when: t(`ui.home.when.${when.key}`, { day: when.day ?? "" }), time: clock });
  const length = t("ui.home.continue.length", { count: Math.max(1, Math.round(session.listenedMs / 60_000)) });
  const context = `home:session:${session.id}`;
  const front = session.songs.slice(-FANNED).reverse();
  const resume = () => void continueFrom(session.songs, { completed: session.lastCompleted, playlistId: session.playlistId }, context);
  return (
    <div className={styles.session} data-session={session.id}>
      <div className={styles.stack} style={{ height: COVER, "--count": front.length } as CSSProperties}>
        {front.map((track, index) => (
          <button
            key={track.id}
            type="button"
            className={styles.sleeve}
            style={{ "--i": index, zIndex: FANNED - index } as CSSProperties}
            tabIndex={index === 0 ? 0 : -1}
            aria-label={index === 0 ? t("ui.home.continue.resume", { name: title }) : `${track.title}, ${track.artists}`}
            title={index === 0 ? undefined : `${track.title}, ${track.artists}`}
            onClick={index === 0 ? resume : () => playSongs(session.songs, session.songs.indexOf(track), context)}
          >
            <Cover src={track.coverUrl} size={COVER} radius={6} />
          </button>
        ))}
      </div>
      <button type="button" className={styles.label} tabIndex={-1} onClick={resume}>
        <span className={styles.title}>{title}</span>
        <span className={styles.about}>{time}</span>
        <span className={styles.about}>{length}</span>
      </button>
    </div>
  );
}
