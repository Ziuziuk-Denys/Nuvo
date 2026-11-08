import { Cover } from "./Cover";
import { HeartIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon } from "./icons";
import { Scrubber } from "./Scrubber";
import type { NotchAction, NotchState, NotchTrack } from "./contracts";
import type { LyricLine, PositionSample } from "./lib/playback";

export type ExpandedView = "now" | "lyrics" | "upNext";

export const VIEWS: Array<{ id: ExpandedView; label: string }> = [
  { id: "now", label: "Now playing" },
  { id: "lyrics", label: "Lyrics" },
  { id: "upNext", label: "Up next" },
];

const LYRIC_ROW = 32;

interface ExpandedFaceProps {
  state: NotchState & { track: NotchTrack };
  sample: PositionSample;
  view: ExpandedView;
  live: boolean;
  lines: LyricLine[];
  lineIndex: number;
  showLyrics: boolean;
  accent: string;
  onView: (view: ExpandedView) => void;
  onAction: (action: NotchAction) => void;
  onHold: (holding: boolean) => void;
}

export function ExpandedFace(props: ExpandedFaceProps) {
  const { view, onView } = props;
  return (
    <div className="expanded" data-view={view}>
      <div className="view" key={view}>
        {view === "now" && <NowView {...props} />}
        {view === "lyrics" && <LyricsView lines={props.lines} index={props.lineIndex} />}
        {view === "upNext" && <UpNextView tracks={props.state.upNext} onAction={props.onAction} />}
      </div>
      <div className="dots">
        {VIEWS.map((item) => (
          <button key={item.id} type="button" className="dot" aria-label={item.label} aria-pressed={view === item.id} onClick={() => onView(item.id)} />
        ))}
      </div>
    </div>
  );
}

function NowView({ state, sample, live, lines, lineIndex, showLyrics, accent, onAction, onHold }: ExpandedFaceProps) {
  const { track } = state;
  const focusApp = () => onAction({ type: "focusApp" });
  const playing = state.status === "playing";
  const current = lines[lineIndex];
  const next = lines[lineIndex + 1];
  return (
    <div className="now">
      <div className="now-header">
        <button type="button" className="now-cover" aria-label="Open Nuvo" onClick={focusApp}>
          <Cover src={track.coverUrl} size={56} radius={12} />
        </button>
        <div className="now-text">
          <button type="button" className="now-title" onClick={focusApp}>
            {track.title}
          </button>
          <span className="now-artist">{track.artist}</span>
        </div>
        <button
          type="button"
          className="icon-button like"
          aria-label="Like"
          aria-pressed={state.liked}
          style={state.liked ? { color: accent } : undefined}
          onClick={() => onAction({ type: "like" })}
        >
          <HeartIcon filled={state.liked} size={20} />
        </button>
      </div>
      <Scrubber sample={sample} live={live} accent={accent} onSeek={(positionMs) => onAction({ type: "seek", positionMs })} onHold={onHold} />
      <div className="transport">
        <button type="button" className="icon-button skip" aria-label="Previous track" onClick={() => onAction({ type: "prev" })}>
          <PreviousIcon size={22} />
        </button>
        <button type="button" className="icon-button play" aria-label={playing ? "Pause" : "Play"} onClick={() => onAction({ type: "togglePlay" })}>
          {playing ? <PauseIcon size={28} /> : <PlayIcon size={28} />}
        </button>
        <button type="button" className="icon-button skip" aria-label="Next track" onClick={() => onAction({ type: "next" })}>
          <NextIcon size={22} />
        </button>
      </div>
      {showLyrics && lines.length > 0 && (
        <div className="lyric-strip" aria-live="polite">
          <span className="lyric-current" key={`c${lineIndex}`}>
            {current?.text ?? ""}
          </span>
          <span className="lyric-next" key={`n${lineIndex}`}>
            {next?.text ?? ""}
          </span>
        </div>
      )}
    </div>
  );
}

function LyricsView({ lines, index }: { lines: LyricLine[]; index: number }) {
  if (lines.length === 0) return <p className="empty">No synced lyrics for this track</p>;
  return (
    <div className="lyrics-window">
      <ol className="lyrics-list" style={{ transform: `translateY(${(1 - index) * LYRIC_ROW}px)` }}>
        {lines.map((line, i) => (
          <li key={i} className="lyrics-line" data-state={i === index ? "current" : "other"}>
            <span className="lyrics-text">{line.text || " "}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function UpNextView({ tracks, onAction }: { tracks: NotchTrack[]; onAction: (action: NotchAction) => void }) {
  if (tracks.length === 0) return <p className="empty">Nothing queued after this track</p>;
  return (
    <ul className="up-next">
      {tracks.slice(0, 3).map((track) => (
        <li key={track.id}>
          <button type="button" className="up-next-row" onClick={() => onAction({ type: "playUpNext", trackId: track.id })}>
            <Cover src={track.coverUrl} size={28} radius={6} />
            <span className="up-next-text">
              <span className="up-next-title">{track.title}</span>
              <span className="up-next-artist">{track.artist}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
