import { useCallback, useRef, useState, type CSSProperties, type JSX } from "react";
import { Popover } from "../../components/Popover";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { clipEstimate, exportClip, templateThumbnail, type ClipRequest, type Quality } from "../../ports/visual";
import { Segmented, Switch } from "../../screens/settings/controls";
import { formatTime } from "../../shell/island/Scrubber";
import theme from "./theme.module.css";
import { captionFor } from "./caption";
import { ExportDone } from "./ExportDone";
import { usePreview } from "./usePreview";
import styles from "./ExportClip.module.css";

const QUALITIES: { value: Quality; label: string }[] = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
];
const RATES: { value: "30" | "60"; label: string }[] = [
  { value: "30", label: "30 fps" },
  { value: "60", label: "60 fps" },
];
const FADE_MS = 800;
const ASPECT_LABEL = { tall: "9:16", square: "1:1", wide: "16:9" } as const;

type State = { kind: "idle" } | { kind: "working"; done: number } | { kind: "saved"; path: string } | { kind: "failed"; message: string };

const megabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;

export function ExportClip({
  request: clip,
  songMs,
  artists,
}: {
  request: Omit<ClipRequest, "quality" | "fps" | "fadeMs">;
  songMs: number;
  artists: string;
}): JSX.Element {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<Quality>("1080p");
  const [fps, setFps] = useState<"30" | "60">("60");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [whole, setWhole] = useState(false);
  const [fade, setFade] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const request = whole && songMs > 0 ? { ...clip, fromMs: 0, lenMs: Math.round(songMs) } : clip;
  const { template, coverUrl, aspect, fromMs, lenMs } = request;
  const preview = usePreview(useCallback(() => templateThumbnail(template, coverUrl), [template, coverUrl]));
  const estimate = clipEstimate(aspect, quality, Number(fps), lenMs);
  const working = state.kind === "working";

  const start = async () => {
    abort.current = new AbortController();
    setState({ kind: "working", done: 0 });
    const result = await exportClip(
      { ...request, quality, fps: Number(fps), fadeMs: fade ? FADE_MS : 0 },
      (done) => setState({ kind: "working", done }),
      abort.current.signal,
    );
    abort.current = null;
    if (!result) setState({ kind: "idle" });
    else if ("path" in result) {
      setOpen(false);
      setState({ kind: "saved", path: result.path });
    } else setState({ kind: "failed", message: result.error });
  };
  const finish = useCallback(() => setState({ kind: "idle" }), []);
  const close = () => {
    if (working) return;
    setOpen(false);
    if (state.kind !== "idle") setState({ kind: "idle" });
  };

  return (
    <>
      <button ref={setAnchor} type="button" className={theme.secondary} onClick={() => setOpen(true)} data-tour="studio-export">
        <Icon name="export" size={16} />
        {t("visual.export.open")}
      </button>
      <Popover open={open} anchor={anchor} onClose={close} title={t("visual.export.title")} width={320} solid className={theme.dark}>
        <div className={styles.sheet}>
          <div className={styles.clip}>
            <span className={styles.frame} data-aspect={aspect}>
              {preview ? <img src={preview} alt="" /> : null}
            </span>
            <div className={styles.clipText}>
              <b>{request.name}</b>
              <span>
                {formatTime(fromMs)} – {formatTime(fromMs + lenMs)}
              </span>
              <span>
                {ASPECT_LABEL[aspect]} · {formatTime(lenMs)}
              </span>
            </div>
          </div>

          <div className={styles.group}>
            <span className={styles.label}>{t("visual.export.length")}</span>
            <Segmented
              label={t("visual.export.length")}
              options={[
                { value: "clip", label: t("visual.export.clip", { length: formatTime(clip.lenMs) }) },
                { value: "song", label: t("visual.export.song", { length: formatTime(songMs) }) },
              ]}
              value={whole ? "song" : "clip"}
              onChange={(next) => setWhole(next === "song")}
            />
          </div>

          <div className={styles.group} role="group" aria-label={t("visual.export.quality")}>
            <span className={styles.label}>{t("visual.export.quality")}</span>
            <div className={styles.qualities}>
              {QUALITIES.map((item) => {
                const size = clipEstimate(aspect, item.value, Number(fps), lenMs);
                return (
                  <button
                    key={item.value}
                    type="button"
                    className={styles.quality}
                    aria-pressed={quality === item.value}
                    aria-label={item.label}
                    disabled={working}
                    onClick={() => setQuality(item.value)}
                  >
                    <b>{item.label}</b>
                    <span>
                      {size.width}×{size.height}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.group}>
            <span className={styles.label}>{t("visual.export.smoothness")}</span>
            <Segmented label={t("visual.export.smoothness")} options={RATES} value={fps} onChange={setFps} />
          </div>

          <label className={styles.toggle}>
            <span>{t("visual.export.fade")}</span>
            <Switch checked={fade} onChange={setFade} label={t("visual.export.fade")} />
          </label>

          <div className={styles.summary}>
            <span>MP4 · H.264 · AAC</span>
            <span>{t("visual.export.about", { size: megabytes(estimate.bytes) })}</span>
          </div>

          {state.kind === "failed" ? <p className={styles.error}>{state.message}</p> : null}

          {state.kind !== "saved" ? (
            <div className={styles.action}>
              <button
                type="button"
                className={styles.go}
                data-working={working ? "" : undefined}
                style={{ "--done": working ? state.done : 0 } as CSSProperties}
                disabled={working}
                aria-live="polite"
                onClick={() => void start()}
              >
                <span className={styles.fill} />
                <span className={styles.goText}>
                  {working ? t("visual.export.rendering", { percent: String(Math.round(state.done * 100)) }) : t("visual.export.start")}
                </span>
              </button>
              {working ? (
                <button type="button" className={theme.icon} onClick={() => abort.current?.abort()} aria-label={t("visual.export.cancel")}>
                  <Icon name="close" size={16} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </Popover>
      {state.kind === "saved" ? (
        <ExportDone
          path={state.path}
          preview={preview}
          aspect={aspect}
          summary={`${request.name} · ${formatTime(lenMs)} · ${estimate.width}×${estimate.height} · ${fps} fps`}
          caption={(style) =>
            captionFor({ title: request.name, artists, lines: request.lines, fromMs, toMs: fromMs + lenMs, credit: t("visual.done.credit"), style })
          }
          onClose={finish}
        />
      ) : null}
    </>
  );
}
