import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Cover } from "../../../components/Cover";
import { kept, plays, type Play } from "../../../ports/homeMoments";
import { playSongs } from "../../../ports/homeShelves";
import { useTranslation } from "../../../ports/i18n";
import { ShelfHeading } from "../ShelfHeading";
import { dayOf, daysBack, spreadOver, type DayBack } from "./moments";
import styles from "./Memory.module.css";

const COVER = 92;
const GAP = 10;
const LEAD_MS = 30 * 60_000;

interface Day {
  back: DayBack;
  songs: Play[];
}

function useMemory(offline: boolean): Day | null {
  const [day, setDay] = useState<Day | null>(null);
  useEffect(() => {
    let live = true;
    const find = async () => {
      for (const back of daysBack(Date.now())) {
        const all = await plays(back);
        const here = offline ? await kept(all.map((play) => play.track)) : null;
        const songs = dayOf(here ? all.filter((play) => here.has(play.track.id)) : all);
        if (!live) return;
        if (songs) return setDay({ back, songs });
      }
      setDay(null);
    };
    void find();
    return () => {
      live = false;
    };
  }, [offline]);
  return day;
}

export function Memory({ offline }: { offline: boolean }): JSX.Element | null {
  const { t, locale } = useTranslation();
  const day = useMemory(offline);
  if (!day) return null;
  const title = t(`ui.home.memory.${day.back.key}`, { count: day.back.count ?? 1 });
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(day.back.from);
  return (
    <section aria-label={title} data-memory={day.back.key}>
      <ShelfHeading title={title} />
      <p className={styles.date}>{date}</p>
      <DayLine songs={day.songs} context={`home:memory:${day.back.key}`} />
    </section>
  );
}

function DayLine({ songs, context }: { songs: Play[]; context: string }): JSX.Element {
  const { locale } = useTranslation();
  const ref = useRef<HTMLOListElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);
  const times = songs.map((song) => song.at);
  const places = useMemo(
    () =>
      spreadOver(
        songs.map((song) => song.at),
        songs[0].at - LEAD_MS,
        songs[songs.length - 1].at + LEAD_MS,
        width,
        COVER,
        GAP,
      ),
    [songs, width],
  );
  const clock = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const tracks = songs.map((song) => song.track);
  return (
    <ol ref={ref} className={styles.line} data-ready={width > 0 ? "" : undefined}>
      {songs.map((song, index) => (
        <li key={song.track.id} className={styles.song} style={{ width: COVER, transform: `translateX(${places[index]}px)` }}>
          <button
            type="button"
            className={styles.play}
            aria-label={`${clock.format(times[index])}, ${song.track.title}, ${song.track.artists}`}
            title={`${song.track.title}, ${song.track.artists}`}
            onClick={() => playSongs(tracks, index, context)}
          >
            <Cover src={song.track.coverUrl} size={COVER} radius={6} />
          </button>
          <time className={styles.time}>{clock.format(times[index])}</time>
        </li>
      ))}
    </ol>
  );
}
