import { useEffect, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { pushLayer } from "../../components/layers";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { openExternal } from "../../ports/system";
import type { Aspect } from "../../ports/visual";
import { Segmented } from "../../screens/settings/controls";
import { CAPTION_STYLES, type CaptionStyle } from "./caption";
import theme from "./theme.module.css";
import styles from "./ExportDone.module.css";

const UPLOAD_URL = "https://www.tiktok.com/tiktokstudio/upload";
const COPIED_MS = 2_000;

interface ExportDoneProps {
  path: string;
  preview: string;
  aspect: Aspect;
  summary: string;
  caption(style: CaptionStyle): string;
  onClose(): void;
}

export function ExportDone({ path, preview, aspect, summary, caption, onClose }: ExportDoneProps): JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [style, setStyle] = useState<CaptionStyle>("song");
  const text = caption(style);

  useEffect(() => pushLayer(onClose), [onClose]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    void navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      () => undefined,
    );
  };

  return createPortal(
    <div className={`${theme.dark} ${styles.screen}`} role="dialog" aria-modal="true" aria-label={t("visual.done.title")}>
      <div className={styles.layout}>
        <div className={styles.clip} data-aspect={aspect}>
          <span className={styles.frame}>{preview ? <img src={preview} alt="" /> : null}</span>
        </div>

        <div className={styles.side}>
          <span className={styles.mark}>
            <Icon name="check" size={24} />
          </span>
          <h2 className={styles.title}>{t("visual.done.title")}</h2>
          <p className={styles.summary}>{summary}</p>

          <div className={styles.actions}>
            <button type="button" className={`${theme.primary} ${styles.big}`} onClick={() => openExternal(UPLOAD_URL)}>
              {t("visual.done.tiktok")}
              <Icon name="external" size={16} />
            </button>
            <button type="button" className={`${theme.secondary} ${styles.big}`} onClick={() => void window.nuvoShell?.reveal(path)}>
              {t("visual.export.show")}
            </button>
          </div>
          <p className={styles.hint}>{t("visual.done.tiktok_hint")}</p>

          <section className={styles.caption}>
            <header>
              <Segmented
                label={t("visual.done.caption")}
                options={CAPTION_STYLES.map((value) => ({ value, label: t(`visual.done.style_${value}`) }))}
                value={style}
                onChange={(next) => {
                  setStyle(next);
                  setCopied(false);
                }}
              />
              <button type="button" className={theme.secondary} onClick={copy} aria-live="polite">
                <Icon name={copied ? "check" : "copy"} size={14} />
                {t(copied ? "visual.done.copied" : "visual.done.copy")}
              </button>
            </header>
            <pre>{text}</pre>
          </section>

          <button type="button" className={styles.close} onClick={onClose}>
            {t("visual.done.close")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
