import { useState, type CSSProperties } from "react";
import { useTranslation } from "@/i18n";
import type { NotchState, NotchTrack } from "@/notch/contracts";
import type { PositionSample } from "@/notch/lib/playback";
import { Icon } from "@/ui/icons/Icon";
import { MorphPlayIcon } from "@/ui/components/MorphPlayIcon";
import type { CoverLight } from "@/ui/light/readLight";
import { Art } from "./Art";
import type { PocketAction, PocketFace } from "./contracts";
import { Seek } from "./Seek";

interface FrontProps {
  state: NotchState | null;
  track: NotchTrack | null;
  coverUrl: string | null;
  sample: PositionSample;
  shape: number[] | null;
  awake: boolean;
  hidden: boolean;
  turnTo: PocketFace | null;
  onAction: (action: PocketAction) => void;
  onFace: (face: PocketFace) => void;
  onLight: (light: CoverLight) => void;
  onClose: () => void;
}

export function Front(props: FrontProps) {
  const { state, track, coverUrl, sample, awake, hidden, turnTo, onAction, onFace } = props;
  const { t } = useTranslation();
  const [lean, setLean] = useState(0);
  const playing = state?.status === "playing" || state?.status === "loading";
  const leanTo = (side: number) => ({ onPointerEnter: () => setLean(side), onPointerLeave: () => setLean(0) });

  return (
    <section className="face front" inert={hidden} aria-label={t("ui.pocket.title")}>
      <span className="room" aria-hidden="true" />
      <div className="object" style={{ "--lean": awake ? lean : 0 } as CSSProperties}>
        <span className="object-shadow" aria-hidden="true" />
        <div className="art">
          <Art src={coverUrl} onLight={props.onLight} />
          <span className="art-edge" aria-hidden="true" />
        </div>
      </div>
      <div className="controls" inert={!awake}>
        <button type="button" className="tool corner-left" aria-label={t("ui.pocket.put_away")} onClick={props.onClose}>
          <Icon name="window-close" size={14} />
        </button>
        <button type="button" className="tool corner-right" aria-label={t("ui.pocket.menu_openApp")} onClick={() => onAction({ type: "focusApp" })}>
          <Icon name="expand" size={14} />
        </button>
        <div className="now">
          {track ? (
            <>
              <span className="now-title">{track.title}</span>
              <span className="now-artist">{track.artist}</span>
            </>
          ) : (
            <span className="now-artist">{t("ui.pocket.nothing")}</span>
          )}
        </div>
        {track ? <Seek sample={sample} shape={props.shape} live={awake && !hidden} onSeek={(positionMs) => onAction({ type: "seek", positionMs })} /> : null}
        <div className="transport" aria-disabled={!track || undefined}>
          <button
            type="button"
            className="tool like"
            aria-label={t(state?.liked ? "ui.island.unlike" : "ui.island.like")}
            aria-pressed={state?.liked ?? false}
            disabled={!track}
            onClick={() => onAction({ type: "like" })}
          >
            <Icon name={state?.liked ? "liked" : "like"} size={18} />
          </button>
          <button
            type="button"
            className="tool"
            aria-label={t("ui.island.previous")}
            disabled={!track}
            {...leanTo(-1)}
            onClick={() => onAction({ type: "prev" })}
          >
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
          <button type="button" className="tool" aria-label={t("ui.island.next")} disabled={!track} {...leanTo(1)} onClick={() => onAction({ type: "next" })}>
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
    </section>
  );
}
