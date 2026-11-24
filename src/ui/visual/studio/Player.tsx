import type { JSX } from "react";
import { MorphPlayIcon } from "../../components/MorphPlayIcon";
import { useTranslation } from "../../ports/i18n";
import type { Line } from "../../ports/lyrics";
import { playerEngine, usePlayerStore } from "../../ports/player";
import type { Aspect, Media, Template } from "../../ports/visual";
import { formatTime } from "../../shell/island/Scrubber";
import { Stage } from "../Stage";
import { WatermarkPreview } from "./WatermarkPreview";
import theme from "./theme.module.css";
import styles from "./Player.module.css";

interface PlayerProps {
  template: Template;
  aspect: Aspect;
  coverUrl: string;
  lines: Line[];
  media: Media | null;
  range: [number, number];
}

export function Player({ template, aspect, coverUrl, lines, media, range }: PlayerProps): JSX.Element {
  const { t } = useTranslation();
  const status = usePlayerStore((state) => state.status);
  const positionMs = usePlayerStore((state) => state.positionMs);
  const durationMs = usePlayerStore((state) => state.durationMs);
  const playing = status === "playing" || status === "loading";

  return (
    <section className={theme.panel} data-tour="studio-player">
      <div className={styles.viewport}>
        <div className={styles.frame} data-aspect={aspect}>
          <Stage className={styles.canvas} template={template} aspect={aspect} coverUrl={coverUrl} lines={lines} media={media} />
          <WatermarkPreview />
        </div>
      </div>
      <footer className={styles.transport}>
        <span className={styles.time}>
          <b>{formatTime(positionMs)}</b> / {formatTime(durationMs)}
        </span>
        <button
          type="button"
          className={styles.play}
          aria-label={t(playing ? "ui.karaoke.pause" : "ui.karaoke.play")}
          onClick={() => void playerEngine.togglePlayPause()}
        >
          <MorphPlayIcon playing={playing} size={16} />
        </button>
        <span className={styles.time}>
          {formatTime(range[0])} – {formatTime(range[1])}
        </span>
      </footer>
    </section>
  );
}
