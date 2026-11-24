import { useTranslation } from "@/i18n";
import type { NotchState, NotchTrack } from "@/notch/contracts";
import type { PositionSample } from "@/notch/lib/playback";
import { MorphPlayIcon } from "@/ui/components/MorphPlayIcon";
import { Icon } from "@/ui/icons/Icon";
import { Art } from "./Art";
import type { PocketAction, PocketFace } from "./contracts";
import { Seek } from "./Seek";

interface FrontProps {
  state: NotchState | null;
  track: NotchTrack | null;
  coverUrl: string | null;
  sample: PositionSample;
  awake: boolean;
  hidden: boolean;
  turnTo: PocketFace | null;
  onAction: (action: PocketAction) => void;
  onFace: (face: PocketFace) => void;
  onClose: () => void;
}

export function Front({ state, track, coverUrl, sample, awake, hidden, turnTo, onAction, onFace, onClose }: FrontProps) {
  const { t } = useTranslation();
  const playing = state?.status === "playing" || state?.status === "loading";
  const liked = state?.liked ?? false;

  return (
    <section className="face front" inert={hidden} aria-label={t("ui.pocket.title")}>
      <Art src={coverUrl} />
      <div className="controls" data-empty={!track || undefined}>
        <span className="shade" aria-hidden="true" />
        <div className="corners">
          <button type="button" className="tool" aria-label={t("ui.pocket.put_away")} onClick={onClose}>
            <Icon name="window-close" size={14} />
          </button>
          <button type="button" className="tool" aria-label={t("ui.pocket.menu_openApp")} onClick={() => onAction({ type: "focusApp" })}>
            <Icon name="expand" size={14} />
          </button>
        </div>
        <div className="deck">
          {track ? (
            <>
              <span className="now-title">{track.title}</span>
              <span className="now-artist">{track.artist}</span>
              <Seek sample={sample} live={awake && !hidden && playing} onSeek={(positionMs) => onAction({ type: "seek", positionMs })} />
            </>
          ) : (
            <span className="now-artist">{t("ui.pocket.nothing")}</span>
          )}
          <div className="transport">
            <button
              type="button"
              className="tool like"
              aria-label={t(liked ? "ui.island.unlike" : "ui.island.like")}
              aria-pressed={liked}
              disabled={!track}
              onClick={() => onAction({ type: "like" })}
            >
              <Icon name={liked ? "liked" : "like"} size={18} />
            </button>
            <button type="button" className="tool" aria-label={t("ui.island.previous")} disabled={!track} onClick={() => onAction({ type: "prev" })}>
              <Icon name="previous" size={20} />
            </button>
            <button
              type="button"
              className="tool play"
              aria-label={t(playing ? "ui.island.pause" : "ui.island.play")}
              disabled={!track}
              onClick={() => onAction({ type: "togglePlay" })}
            >
              <MorphPlayIcon playing={playing} size={30} />
            </button>
            <button type="button" className="tool" aria-label={t("ui.island.next")} disabled={!track} onClick={() => onAction({ type: "next" })}>
              <Icon name="next" size={20} />
            </button>
            <button
              type="button"
              className="tool"
              aria-label={t(turnTo === "queue" ? "ui.notch.up_next" : "ui.notch.lyrics")}
              disabled={!turnTo}
              onClick={() => turnTo && onFace(turnTo)}
            >
              <Icon name={turnTo === "queue" ? "queue" : "lyrics"} size={18} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
