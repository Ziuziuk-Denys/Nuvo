import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import type { NotchLyrics, NotchTrack } from "@/notch/contracts";
import { activeLineIndex, msUntilNextLine, positionAt, type PositionSample } from "@/notch/lib/playback";
import { MorphPlayIcon } from "@/ui/components/MorphPlayIcon";
import { Icon } from "@/ui/icons/Icon";
import type { PocketAction, PocketFace } from "./contracts";

type TimedLine = NotchLyrics["lines"][number];

interface BackProps {
  face: PocketFace;
  faces: PocketFace[];
  coverUrl: string | null;
  lines: TimedLine[];
  upNext: NotchTrack[];
  sample: PositionSample;
  playing: boolean;
  onAction: (action: PocketAction) => void;
  onFace: (face: PocketFace) => void;
}

const NAMES = { lyrics: "ui.notch.lyrics", queue: "ui.notch.up_next" } as const;
const TURN_MS = 200;

export function Back({ face, faces, coverUrl, lines, upNext, sample, playing, onAction, onFace }: BackProps) {
  const { t } = useTranslation();
  const [shown, setShown] = useState<"lyrics" | "queue">("lyrics");
  const hidden = face === "cover";
  if (face !== "cover" && face !== shown) setShown(face);
  const mounted = useLinger(!hidden, TURN_MS);

  return (
    <section className="face back" inert={hidden} aria-label={t(NAMES[shown])}>
      {mounted ? (
        shown === "lyrics" ? (
          <Lyrics lines={lines} sample={sample} playing={playing} onAction={onAction} />
        ) : (
          <ul className="queue">
            {upNext.map((track, at) => (
              <li key={`${track.id}-${at}`}>
                <button type="button" className="queue-row" onClick={() => onAction({ type: "playUpNext", trackId: track.id })}>
                  {track.coverUrl ? (
                    <img src={track.coverUrl} alt="" width={36} height={36} loading="lazy" draggable={false} />
                  ) : (
                    <span className="queue-blank" />
                  )}
                  <span className="queue-text">
                    <span>{track.title}</span>
                    <span>{track.artist}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      <div className="back-row">
        <button type="button" className="back-cover" aria-label={t("ui.pocket.turn_back")} onClick={() => onFace("cover")}>
          {coverUrl ? <img src={coverUrl} alt="" draggable={false} /> : <Icon name="nuvo-mark" size={16} />}
        </button>
        {faces.map((name) =>
          name === "cover" ? null : (
            <button key={name} type="button" className="word" aria-pressed={shown === name} onClick={() => onFace(name)}>
              {t(NAMES[name])}
            </button>
          ),
        )}
        <button
          type="button"
          className="tool back-play"
          aria-label={t(playing ? "ui.island.pause" : "ui.island.play")}
          onClick={() => onAction({ type: "togglePlay" })}
        >
          <MorphPlayIcon playing={playing} size={18} />
        </button>
      </div>
    </section>
  );
}

function useLinger(on: boolean, ms: number): boolean {
  const [held, setHeld] = useState(on);
  useEffect(() => {
    if (on) setHeld(true);
    else {
      const timer = setTimeout(() => setHeld(false), ms);
      return () => clearTimeout(timer);
    }
  }, [on, ms]);
  return on || held;
}

function useTick(items: ReadonlyArray<{ timeMs: number }>, sample: PositionSample): number {
  const [index, setIndex] = useState(-1);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const position = positionAt(sample, Date.now());
      setIndex(activeLineIndex(items as TimedLine[], position));
      const wait = sample.playing ? msUntilNextLine(items as TimedLine[], position) : null;
      if (wait !== null) timer = setTimeout(update, wait);
    };
    update();
    return () => clearTimeout(timer);
  }, [items, sample]);
  return index;
}

interface LyricsProps {
  lines: TimedLine[];
  sample: PositionSample;
  playing: boolean;
  onAction: (action: PocketAction) => void;
}

function Lyrics({ lines, sample, onAction }: LyricsProps) {
  const index = useTick(lines, sample);
  const list = useRef<HTMLOListElement>(null);

  useLayoutEffect(() => {
    const box = list.current;
    if (!box) return;
    const place = () => {
      const row = box.children[Math.max(0, index)] as HTMLElement | undefined;
      if (row) box.style.transform = `translateY(${-(row.offsetTop + row.offsetHeight / 2)}px)`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(box);
    return () => observer.disconnect();
  }, [index, lines]);

  return (
    <div className="lines">
      <ol ref={list}>
        {lines.map((line, at) => (
          <li key={at} data-at={at === index ? "now" : Math.abs(at - index) < 5 ? "near" : "far"}>
            <button type="button" tabIndex={-1} onClick={() => onAction({ type: "seek", positionMs: line.timeMs })}>
              {at === index && line.words ? <Words words={line.words} sample={sample} /> : line.text}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Words({ words, sample }: { words: NonNullable<TimedLine["words"]>; sample: PositionSample }) {
  const sung = useTick(words, sample);
  return words.map((word, at) => (
    <span key={at} className="sung" data-on={at <= sung}>
      {word.text}
    </span>
  ));
}
