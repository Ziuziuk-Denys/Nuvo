import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { useTranslation } from "@/i18n";
import { MorphPlayIcon } from "@/ui/components/MorphPlayIcon";
import { Icon } from "@/ui/icons/Icon";
import { AddPage } from "./AddPage";
import { Cover } from "./Cover";
import { Deck } from "./Deck";
import { LyricsPage } from "./LyricsPage";
import { Scrubber } from "./Scrubber";
import type { NotchAction, NotchPlaylists, NotchState, NotchTrack } from "./contracts";
import type { NotchPage } from "./lib/geometry";
import type { LyricLine, PositionSample } from "./lib/playback";

const SWIPE_PX = 40;

interface ExpandedFaceProps {
  state: NotchState & { track: NotchTrack };
  sample: PositionSample;
  page: NotchPage;
  pages: NotchPage[];
  height: number;
  live: boolean;
  lines: LyricLine[];
  lineIndex: number;
  playlists: NotchPlaylists | null;
  accent: string;
  nudge: boolean;
  onPage: (page: NotchPage) => void;
  onFlip: (direction: number) => void;
  onAction: (action: NotchAction) => void;
  onHold: (holding: boolean) => void;
  onAdded: () => void;
}

export function ExpandedFace(props: ExpandedFaceProps) {
  const { state, page, pages, height, accent, onPage, onFlip, onAction } = props;
  const { t } = useTranslation();
  const index = pages.indexOf(page);
  const next = index >= 0 ? (pages[index + 1] ?? null) : null;
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const [turn, setTurn] = useState({ page, index, count: 0, from: "cover", forward: true });
  if (turn.page !== page) {
    const real = turn.index >= 0 && index >= 0;
    setTurn({
      page,
      index: index >= 0 ? index : 0,
      count: real ? turn.count + 1 : 0,
      from: Math.min(turn.index, index) === 0 ? "cover" : "mini",
      forward: index > turn.index,
    });
  }

  const layer = (name: NotchPage) => ({
    className: `page ${name}`,
    "data-on": page === name,
    "data-side": page === "add" || name === "add" ? undefined : pages.indexOf(name) < index ? "left" : "right",
  });

  return (
    <div
      className="expanded"
      data-view={page}
      data-ahead={pages.length - 1}
      style={{ "--page-height": height } as CSSProperties}
      onPointerDown={(event: PointerEvent) => {
        const control = (event.target as Element).closest("[data-control]");
        swipe.current = event.pointerType === "touch" && !control ? { x: event.clientX, y: event.clientY } : null;
      }}
      onPointerUp={(event: PointerEvent) => {
        const from = swipe.current;
        swipe.current = null;
        if (!from) return;
        const dx = event.clientX - from.x;
        if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(event.clientY - from.y)) onFlip(-Math.sign(dx));
      }}
    >
      <span className="lamp" style={{ "--light": accent } as CSSProperties} aria-hidden="true" />
      <div className="pages">
        {turn.count > 0 && <span key={turn.count} className="flying-sheet" data-from={turn.from} data-forward={turn.forward} aria-hidden="true" />}
        <div {...layer("now")}>
          <NowPage {...props} />
        </div>
        {pages.includes("lyrics") && (
          <div {...layer("lyrics")}>
            <LyricsPage lines={props.lines} index={props.lineIndex} />
          </div>
        )}
        {pages.includes("upNext") && (
          <div {...layer("upNext")}>
            <UpNextPage tracks={state.upNext} onAction={onAction} />
          </div>
        )}
        <div {...layer("add")}>
          {page === "add" && <AddPage trackId={state.track.id} playlists={props.playlists} accent={accent} onAction={onAction} onDone={props.onAdded} />}
        </div>
        <Deck
          track={state.track}
          page={page}
          next={next}
          ahead={index >= 0 ? pages.length - 1 - index : 0}
          nudge={props.nudge}
          onPage={onPage}
          onFocusApp={() => onAction({ type: "focusApp" })}
        />
        <button
          type="button"
          className="icon-button plus"
          data-on={page === "now" || page === "add"}
          aria-label={page === "add" ? t("ui.notch.back") : t("ui.add.title")}
          onClick={() => onPage(page === "add" ? "now" : "add")}
        >
          <Icon name="add" size={20} />
        </button>
      </div>
    </div>
  );
}

function NowPage({ state, sample, live, accent, onAction, onHold }: ExpandedFaceProps) {
  const { t } = useTranslation();
  const { track } = state;
  const playing = state.status === "playing" || state.status === "loading";
  return (
    <>
      <button type="button" className="now-title" onClick={() => onAction({ type: "focusApp" })}>
        {track.title}
      </button>
      <span className="now-artist">{track.artist}</span>
      <Scrubber sample={sample} live={live} accent={accent} onSeek={(positionMs) => onAction({ type: "seek", positionMs })} onHold={onHold} />
      <div className="transport">
        <button type="button" className="icon-button opinion dislike" aria-label={t("ui.recs.dislike")} onClick={() => onAction({ type: "dislike" })}>
          <Icon name="dislike" size={20} />
        </button>
        <button type="button" className="icon-button skip" aria-label={t("ui.island.previous")} onClick={() => onAction({ type: "prev" })}>
          <Icon name="previous" size={24} />
        </button>
        <button
          type="button"
          className="icon-button play"
          aria-label={playing ? t("ui.island.pause") : t("ui.island.play")}
          onClick={() => onAction({ type: "togglePlay" })}
        >
          <MorphPlayIcon playing={playing} size={34} />
        </button>
        <button type="button" className="icon-button skip" aria-label={t("ui.island.next")} onClick={() => onAction({ type: "next" })}>
          <Icon name="next" size={24} />
        </button>
        <button
          type="button"
          className="icon-button opinion like"
          aria-label={t("ui.island.like")}
          aria-pressed={state.liked}
          style={state.liked ? { color: accent } : undefined}
          onClick={() => onAction({ type: "like" })}
        >
          <Icon name={state.liked ? "liked" : "like"} size={20} />
        </button>
      </div>
    </>
  );
}

function UpNextPage({ tracks, onAction }: { tracks: NotchTrack[]; onAction: (action: NotchAction) => void }) {
  return (
    <ul className="rows">
      {tracks.map((track) => (
        <li key={track.id}>
          <button type="button" className="row" onClick={() => onAction({ type: "playUpNext", trackId: track.id })}>
            <Cover src={track.coverUrl} size={34} radius={7} />
            <span className="row-text">
              <span className="row-title">{track.title}</span>
              <span className="row-meta">{track.artist}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
