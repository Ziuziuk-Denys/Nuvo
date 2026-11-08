import { Bars } from "./Bars";
import { Cover } from "./Cover";
import { NuvoGlyph } from "./icons";
import { Marquee } from "./Marquee";
import type { NotchTrack } from "./contracts";
import type { IslandMode } from "./lib/geometry";

interface CompactFaceProps {
  mode: IslandMode;
  track: NotchTrack | null;
  playing: boolean;
  accent: string;
  onAccent: (color: string) => void;
  onFocusApp: () => void;
}

export function CompactFace({ mode, track, playing, accent, onAccent, onFocusApp }: CompactFaceProps) {
  if (!track) {
    return (
      <div className="compact compact-idle">
        <NuvoGlyph className="idle-glyph" size={18} />
      </div>
    );
  }
  const visible = mode === "live" || mode === "hover";
  return (
    <div className="compact">
      <button type="button" className="compact-cover" aria-label="Open Nuvo" onClick={onFocusApp}>
        <Cover src={track.coverUrl} size={22} radius={5} onAccent={onAccent} />
      </button>
      {mode === "hover" ? (
        <button type="button" className="compact-title" onClick={onFocusApp}>
          <Marquee text={track.title} />
        </button>
      ) : (
        <span className="compact-gap" />
      )}
      <span className="compact-bars">
        <Bars playing={playing && visible} color={accent} />
      </span>
    </div>
  );
}
