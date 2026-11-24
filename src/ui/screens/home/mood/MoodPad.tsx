import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "../../../components/Button";
import { Cover } from "../../../components/Cover";
import { useReducedEffects } from "../../../effects";
import { Icon } from "../../../icons/Icon";
import { coverSrc } from "../../../ports/covers";
import { kept, moodMap, type MoodMap } from "../../../ports/homeMoments";
import { playSongs } from "../../../ports/homeShelves";
import { useTranslation } from "../../../ports/i18n";
import { recsChanged, type Track } from "../../../ports/recs";
import { useThemeMode } from "../../../ports/theme";
import { firstArtist } from "../../../recs/notInterestedItems";
import { ArtistLinks } from "../../../shell/ArtistLinks";
import { useTrackMenu } from "../../entity/useTrackMenu";
import { ShelfHeading } from "../ShelfHeading";
import { moodName, moodTracks, pickMix, startPlace, tasteRanks, type Place } from "./mood";
import { createMoodField, type MoodField } from "./moodField";
import styles from "./MoodPad.module.css";

const LISTED = 5;
const KEY_STEP = 0.04;
const COVER_PX = 96;
const CONTEXT = "mix:mood-pad";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const percent = (value: number) => Math.round(value * 100);

function useMoodMap(offline: boolean): MoodMap | null {
  const [map, setMap] = useState<MoodMap | null>(null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      const found = await moodMap();
      const here = found && offline ? await kept(found.points.map((point) => point.track)) : null;
      if (live && found) setMap(here ? { ...found, points: found.points.filter((point) => here.has(point.track.id)) } : found);
    };
    void load();
    recsChanged.addEventListener("change", load);
    return () => {
      live = false;
      recsChanged.removeEventListener("change", load);
    };
  }, [offline]);
  return map;
}

export function MoodPad({ offline }: { offline: boolean }): JSX.Element | null {
  const { t } = useTranslation();
  const map = useMoodMap(offline);
  if (!map || map.analysed === 0) return null;
  if (map.analysed < map.needed) {
    return (
      <section aria-label={t("ui.home.mood.title")} data-mood="learning">
        <ShelfHeading title={t("ui.home.mood.title")} />
        <p className={styles.learning}>{t("ui.home.mood.learning", { count: map.needed - map.analysed })}</p>
        <div className={styles.steps} aria-hidden="true">
          {Array.from({ length: map.needed }, (_, index) => (
            <span key={index} data-on={index < map.analysed ? "" : undefined} />
          ))}
        </div>
      </section>
    );
  }
  if (map.points.length < map.needed) return null;
  return <Pad key={map.points.length} map={map} />;
}

function Pad({ map }: { map: MoodMap }): JSX.Element {
  const { t } = useTranslation();
  const dark = useThemeMode() === "dark";
  const still = useReducedEffects();
  const menu = useTrackMenu();
  const { points } = map;
  const ranks = useMemo(() => tasteRanks(points), [points]);
  const [at, setAt] = useState<Place>(() => startPlace(points));
  const picked = useMemo(() => pickMix(points, ranks, at), [points, ranks, at]);
  const tracks = useMemo(() => moodTracks(points, picked), [points, picked]);
  const name = t(moodName(at));
  const names = [...new Set(tracks.map((track) => firstArtist(track)))].slice(0, 3).join(", ");

  const padRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const field = useRef<MoodField | null>(null);
  const frame = useRef(0);
  const run = () => {
    if (frame.current) return;
    const tick = (now: number) => {
      const ink = getComputedStyle(canvasRef.current!).color;
      frame.current = field.current!.draw(now, { dark, ink, still }) ? requestAnimationFrame(tick) : 0;
    };
    frame.current = requestAnimationFrame(tick);
  };
  const runRef = useRef(run);
  useLayoutEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    const made = createMoodField(canvasRef.current!, () => runRef.current());
    field.current = made;
    made.points(points, (cover) => coverSrc(cover, COVER_PX, 1));
    const observer = new ResizeObserver(([entry]) => {
      made.resize(entry.contentRect.width, window.devicePixelRatio);
      runRef.current();
    });
    observer.observe(padRef.current!);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [points]);

  useEffect(() => {
    field.current?.aim(at, picked);
    runRef.current();
  }, [at, picked, dark]);

  const aimAt = (event: PointerEvent<HTMLElement>) => {
    const box = padRef.current!.getBoundingClientRect();
    setAt({ x: clamp((event.clientX - box.left) / box.width), y: clamp(1 - (event.clientY - box.top) / box.height) });
  };
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    aimAt(event);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) aimAt(event);
  };
  const play = (index = 0) => playSongs(tracks, index, CONTEXT);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const dx = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const dy = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
    if (event.key === "Enter") play();
    if (dx === 0 && dy === 0) return;
    event.preventDefault();
    setAt(({ x, y }) => ({ x: clamp(x + dx * KEY_STEP), y: clamp(y + dy * KEY_STEP) }));
  };

  return (
    <section aria-label={t("ui.home.mood.title")} data-mood="ready">
      <ShelfHeading title={t("ui.home.mood.title")} />
      <div className={styles.row}>
        <div
          ref={padRef}
          className={styles.pad}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onDoubleClick={() => play()}
          style={{ "--x": at.x, "--y": 1 - at.y } as CSSProperties}
        >
          <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
          <span className={`${styles.axis} ${styles.top}`}>{t("ui.home.mood.bright")}</span>
          <span className={`${styles.axis} ${styles.bottom}`}>{t("ui.home.mood.dark")}</span>
          <span className={`${styles.axis} ${styles.left}`}>{t("ui.home.mood.calm")}</span>
          <span className={`${styles.axis} ${styles.right}`}>{t("ui.home.mood.energetic")}</span>
          <div
            role="slider"
            tabIndex={0}
            className={styles.lamp}
            aria-label={t("ui.home.mood.handle")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent(at.x)}
            aria-valuetext={t("ui.home.mood.value", { energy: percent(at.x), brightness: percent(at.y) })}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className={styles.mix}>
          <h3 key={name} className={styles.name}>
            {name}
          </h3>
          <p className={styles.names}>{t("ui.home.mood.close_to", { names })}</p>
          <ol className={styles.songs}>
            {tracks.slice(0, LISTED).map((track, index) => (
              <MoodSong key={track.id} track={track} onPlay={() => play(index)} onContextMenu={menu.onContextMenu(track)} />
            ))}
          </ol>
          <Button variant="primary" className={styles.play} onClick={() => play()}>
            <Icon name="play" size={16} />
            {t("ui.home.mood.play", { count: tracks.length })}
          </Button>
        </div>
      </div>
      {menu.element}
    </section>
  );
}

function MoodSong({ track, onPlay, onContextMenu }: { track: Track; onPlay(): void; onContextMenu: JSX.IntrinsicElements["li"]["onContextMenu"] }): JSX.Element {
  return (
    <li className={styles.song} data-song={track.id} onContextMenu={onContextMenu}>
      <button type="button" className={styles.start} aria-label={`${track.title}, ${track.artists}`} onClick={onPlay}>
        <Cover src={track.coverUrl} size={40} radius={5} />
      </button>
      <span className={styles.text}>
        <span className={styles.title}>{track.title}</span>
        <span className={styles.artist}>
          <ArtistLinks track={track} />
        </span>
      </span>
    </li>
  );
}
