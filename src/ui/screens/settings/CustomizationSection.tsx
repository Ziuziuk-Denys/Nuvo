import { useRef, useState, type DragEvent, type JSX } from "react";
import { useShallow } from "zustand/react/shallow";
import { Slider } from "../../components/Slider";
import { Icon } from "../../icons/Icon";
import { DEFAULT_FONTS, useAppearanceStore } from "../../ports/appearance";
import { useTranslation, type TFunction } from "../../ports/i18n";
import { MIN_WALLPAPER_BLUR, useCustomizationStore } from "../../ports/settings";
import { useLook } from "../../ports/theme";
import { SettingBlock, SettingGroup, SettingRow } from "./controls";
import { CustomCssBlock, ResetAppearanceRow } from "./CustomCssBlock";
import styles from "./sections.module.css";

const LARGEST_IMAGE = 30 * 1024 * 1024;
const ACCEPTED = "image/png,image/jpeg,image/webp,image/gif,image/avif";
const KEYS = "settings.customization.";

export async function resetCustomization(): Promise<void> {
  const look = useCustomizationStore.getState();
  look.resetAll();
  look.setPreset("nuvo");
  const appearance = useAppearanceStore.getState();
  const saved = await appearance.save({
    active: { presetId: "nuvo" },
    fonts: DEFAULT_FONTS,
    customCss: { ...appearance.saved.customCss, enabled: false },
  });
  if (saved && appearance.safe) await appearance.setSafe(false);
}

function asDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const loader = new FileReader();
    loader.addEventListener("load", () => resolve(typeof loader.result === "string" ? loader.result : null));
    loader.addEventListener("error", () => reject(loader.error));
    loader.readAsDataURL(file);
  });
}

function WallpaperEditor({ t, image, onPick, onRemove }: { t: TFunction; image: string; onPick(): void; onRemove(): void }): JSX.Element {
  const { blurPx, dimPercent, setBlurPx, setDimPercent } = useCustomizationStore(
    useShallow((store) => ({
      blurPx: store.backgroundBlur,
      dimPercent: store.backgroundDim,
      setBlurPx: store.setBackgroundBlur,
      setDimPercent: store.setBackgroundDim,
    })),
  );
  const blurLabel = t(KEYS + "wallpaper_blur");
  const dimLabel = t(KEYS + "wallpaper_dim");
  const removeLabel = t(KEYS + "remove_button");

  return (
    <div className={styles.wallpaper}>
      <div className={styles.preview}>
        <img alt="" src={image} style={blurPx > 0 ? { filter: `blur(${blurPx}px)` } : undefined} />
        <span style={{ opacity: dimPercent * 0.01 }} className={styles.previewDim} />
        <span className={styles.previewActions}>
          <button type="button" className={styles.overlayButton} onClick={onPick}>
            <Icon name="import" size={16} />
            {t(KEYS + "change_button")}
          </button>
          <button type="button" className={styles.overlayIcon} title={removeLabel} aria-label={removeLabel} onClick={onRemove}>
            <Icon name="trash" size={16} />
          </button>
        </span>
      </div>
      <div className={styles.wallpaperSliders}>
        <label className={styles.sliderField}>
          <span>{blurLabel}</span>
          <Slider label={blurLabel} value={blurPx} max={30} min={MIN_WALLPAPER_BLUR} step={1} format={(px) => px + "px"} onChange={setBlurPx} />
        </label>
        <label className={styles.sliderField}>
          <span>{dimLabel}</span>
          <Slider label={dimLabel} value={dimPercent} max={80} min={0} step={1} format={(share) => share + "%"} onChange={setDimPercent} />
        </label>
      </div>
    </div>
  );
}

function DropTarget({ t, onPick, onFile }: { t: TFunction; onPick(): void; onFile(file: File | undefined): void }): JSX.Element {
  const [hovering, setHovering] = useState(false);
  const over = (event: DragEvent, inside: boolean) => {
    if (inside) event.preventDefault();
    setHovering(inside);
  };

  return (
    <button
      type="button"
      className={styles.drop}
      data-over={hovering ? "" : undefined}
      onClick={onPick}
      onDragOver={(event) => over(event, true)}
      onDragLeave={(event) => over(event, false)}
      onDrop={(event) => {
        over(event, false);
        event.preventDefault();
        onFile(event.dataTransfer.files.item(0) ?? undefined);
      }}
    >
      <span className={styles.dropIcon}>
        <Icon name="image" size={20} />
      </span>
      <span className={styles.dropTitle}>{t(KEYS + "upload_title")}</span>
      <span className={styles.dropHint}>{t(KEYS + "upload_hint")}</span>
    </button>
  );
}

export function CustomizationSection(): JSX.Element {
  const { t } = useTranslation();
  const [note, setNote] = useState<string | null>(null);
  const { wallpaper, setWallpaper } = useCustomizationStore(
    useShallow((store) => ({ wallpaper: store.backgroundImage, setWallpaper: store.setBackgroundImage })),
  );
  const darkMode = useLook().mode === "dark";
  const picker = useRef<HTMLInputElement | null>(null);
  const openPicker = () => picker.current?.click();

  const accept = (file: File | undefined) => {
    if (!file) return;
    const tooLarge = file.size > LARGEST_IMAGE ? "file_too_large" : null;
    const refusal = file.type.startsWith("image/") ? tooLarge : "invalid_file_type";
    if (refusal) {
      setNote(t(KEYS + refusal));
      return;
    }
    asDataUrl(file).then(
      (url) => {
        if (url === null) return;
        setWallpaper(url);
        setNote(darkMode ? null : t(KEYS + "dark_theme_only"));
      },
      () => setNote(t(KEYS + "read_error")),
    );
  };

  const remove = () => {
    setNote(null);
    setWallpaper(null);
  };

  return (
    <SettingGroup>
      <input
        ref={picker}
        type="file"
        accept={ACCEPTED}
        hidden
        onChange={(event) => {
          const input = event.currentTarget;
          accept(input.files?.[0]);
          input.value = "";
        }}
      />
      <SettingBlock
        titleKey={KEYS + "wallpaper_title"}
        descKey={KEYS + "wallpaper_description"}
        title={t(KEYS + "wallpaper_title")}
        description={t(KEYS + "wallpaper_description")}
      >
        {wallpaper ? (
          <WallpaperEditor t={t} image={wallpaper} onPick={openPicker} onRemove={remove} />
        ) : (
          <DropTarget t={t} onPick={openPicker} onFile={accept} />
        )}
        {note ? <p className={styles.note}>{note}</p> : null}
      </SettingBlock>
      <CustomCssBlock />
      <ResetAppearanceRow />
      <SettingRow
        explained
        titleKey={KEYS + "reset_all"}
        descKey={KEYS + "reset_all_desc"}
        title={t(KEYS + "reset_all")}
        description={t(KEYS + "reset_all_desc")}
        control={
          <button type="button" className={styles.button} onClick={() => void resetCustomization()}>
            {t("ui.settings.reset")}
          </button>
        }
      />
    </SettingGroup>
  );
}
