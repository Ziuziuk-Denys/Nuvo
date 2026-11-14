import { useRef, useState, type DragEvent, type JSX } from "react";
import { useShallow } from "zustand/react/shallow";
import { Slider } from "../../components/Slider";
import { Icon } from "../../icons/Icon";
import { DEFAULT_FONTS, useAppearanceStore } from "../../ports/appearance";
import { useTranslation, type TFunction } from "../../ports/i18n";
import {
  MAX_WALLPAPER_BLUR,
  MAX_WALLPAPER_DIM,
  MIN_WALLPAPER_BLUR,
  useCustomizationStore,
  WALLPAPER_BASE,
  wallpaperKind,
  type WallpaperFit,
} from "../../ports/settings";
import { WallpaperMedia } from "../../field/Field";
import { FRAME_CAPS, useEffectsStore, type FrameCap } from "../../effects";
import { Segmented, SettingBlock, SettingGroup, SettingRow, Switch } from "./controls";
import styles from "./sections.module.css";

const ACCEPTED = "image/png,image/jpeg,image/webp,image/avif,image/gif,video/mp4,video/webm";
const PREVIEW_BLUR = 0.25;
const KEYS = "settings.customization.";
const REFUSALS = {
  too_large: "file_too_large",
  empty: "invalid_file_type",
  format: "invalid_file_type",
  read: "read_error",
  write: "save_error",
} as const;

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

function useDropFile(onFile: (file: File | undefined) => void) {
  const [over, setOver] = useState(false);
  const hover = (event: DragEvent, inside: boolean) => {
    if (inside) event.preventDefault();
    setOver(inside);
  };
  return {
    over,
    handlers: {
      onDragOver: (event: DragEvent) => hover(event, true),
      onDragLeave: (event: DragEvent) => hover(event, false),
      onDrop: (event: DragEvent) => {
        hover(event, false);
        event.preventDefault();
        onFile(event.dataTransfer.files.item(0) ?? undefined);
      },
    },
  };
}

function CurrentWallpaper(props: {
  t: TFunction;
  image: string;
  busy: boolean;
  onPick(): void;
  onFile(file: File | undefined): void;
  onRemove(): void;
  onBroken(): void;
}): JSX.Element {
  const { t, image, busy, onPick, onFile, onRemove, onBroken } = props;
  const look = useCustomizationStore(useShallow((store) => ({ blur: store.backgroundBlur, dim: store.backgroundDim, fit: store.backgroundFit })));
  const drop = useDropFile(onFile);
  const kind = wallpaperKind(image);

  return (
    <div className={styles.current} data-over={drop.over ? "" : undefined} {...drop.handlers}>
      <span className={styles.thumb}>
        <WallpaperMedia
          key={image}
          src={image}
          moving={false}
          style={{ objectFit: look.fit, filter: look.blur > 0 ? `blur(${look.blur * PREVIEW_BLUR}px)` : undefined }}
          onError={onBroken}
        />
        {look.dim > 0 ? <span className={styles.thumbWash} style={{ opacity: look.dim / 100 }} /> : null}
      </span>
      <span className={styles.currentText}>
        <span className={styles.currentKind}>{t(KEYS + "kind_" + kind)}</span>
        <span className={styles.currentHint}>{t(KEYS + (kind === "photo" ? "still_hint" : "moving_hint"))}</span>
        <span className={styles.currentActions}>
          <button type="button" className={styles.button} disabled={busy} onClick={onPick}>
            {t(KEYS + (busy ? "copying" : "change_button"))}
          </button>
          <button type="button" className={styles.quietButton} disabled={busy} onClick={onRemove}>
            {t(KEYS + "remove_button")}
          </button>
        </span>
      </span>
    </div>
  );
}

function WallpaperRows({ t }: { t: TFunction }): JSX.Element {
  const look = useCustomizationStore(
    useShallow((store) => ({
      blur: store.backgroundBlur,
      dim: store.backgroundDim,
      fit: store.backgroundFit,
      setBlur: store.setBackgroundBlur,
      setDim: store.setBackgroundDim,
      setFit: store.setBackgroundFit,
    })),
  );
  const fitLabel = t(KEYS + "wallpaper_fit");
  const blurLabel = t(KEYS + "wallpaper_blur");
  const dimLabel = t(KEYS + "wallpaper_dim");
  const fits: { value: WallpaperFit; label: string }[] = [
    { value: "cover", label: t(KEYS + "fit_cover") },
    { value: "contain", label: t(KEYS + "fit_contain") },
  ];
  return (
    <>
      <SettingRow title={fitLabel} control={<Segmented label={fitLabel} options={fits} value={look.fit} onChange={look.setFit} />} />
      <SettingRow
        title={blurLabel}
        control={
          <span className={styles.rowSlider}>
            <Slider
              label={blurLabel}
              value={look.blur}
              min={MIN_WALLPAPER_BLUR}
              max={MAX_WALLPAPER_BLUR}
              step={1}
              format={(px) => px + " px"}
              onChange={look.setBlur}
            />
          </span>
        }
      />
      <SettingRow
        title={dimLabel}
        control={
          <span className={styles.rowSlider}>
            <Slider label={dimLabel} value={look.dim} min={0} max={MAX_WALLPAPER_DIM} step={1} format={(share) => share + "%"} onChange={look.setDim} />
          </span>
        }
      />
    </>
  );
}

function DropTarget({ t, busy, onPick, onFile }: { t: TFunction; busy: boolean; onPick(): void; onFile(file: File | undefined): void }): JSX.Element {
  const drop = useDropFile(onFile);
  return (
    <button type="button" className={styles.drop} disabled={busy} data-over={drop.over ? "" : undefined} onClick={onPick} {...drop.handlers}>
      <span className={styles.dropIcon}>
        <Icon name="image" size={20} />
      </span>
      <span className={styles.dropTitle}>{t(KEYS + (busy ? "copying" : "upload_title"))}</span>
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
  const coverGlow = useCustomizationStore((state) => state.coverGlow);
  const setCoverGlow = useCustomizationStore((state) => state.setCoverGlow);
  const reduceEffects = useEffectsStore((state) => state.reduce);
  const setReduceEffects = useEffectsStore((state) => state.setReduce);
  const fps = useEffectsStore((state) => state.fps);
  const setFps = useEffectsStore((state) => state.setFps);
  const hasWallpaper = wallpaper !== null;
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);
  const openPicker = () => picker.current?.click();

  const accept = (file: File | undefined) => {
    const shell = window.nuvoShell;
    if (!file || busy) return;
    if (!shell) {
      setNote(t(KEYS + "read_error"));
      return;
    }
    setBusy(true);
    setNote(null);
    shell
      .importWallpaper(file)
      .catch(() => ({ ok: false, error: "write" }) as const)
      .then((result) => {
        setBusy(false);
        if (result.ok) setWallpaper(WALLPAPER_BASE + result.name);
        else setNote(t(KEYS + REFUSALS[result.error]));
      });
  };

  const remove = () => {
    setNote(null);
    setWallpaper(null);
  };

  return (
    <>
      <SettingGroup label={t("settings.page.wallpaper")}>
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
            <CurrentWallpaper
              t={t}
              image={wallpaper}
              busy={busy}
              onPick={openPicker}
              onFile={accept}
              onRemove={remove}
              onBroken={() => setNote(t(KEYS + "media_error"))}
            />
          ) : (
            <DropTarget t={t} busy={busy} onPick={openPicker} onFile={accept} />
          )}
          {note ? (
            <p className={styles.note} role="status">
              {note}
            </p>
          ) : null}
        </SettingBlock>
        {wallpaper ? <WallpaperRows t={t} /> : null}
        <SettingRow
          title={t("settings.cover_glow.title")}
          description={t(hasWallpaper ? "settings.cover_glow.disabled_for_wallpaper" : "settings.cover_glow.description")}
          titleKey="settings.cover_glow.title"
          descKey="settings.cover_glow.description"
          explained
          control={<Switch label={t("settings.cover_glow.title")} checked={coverGlow && !hasWallpaper} disabled={hasWallpaper} onChange={setCoverGlow} />}
        />
      </SettingGroup>
      <SettingGroup label={t("settings.page.motion")}>
        <SettingRow
          title={t("settings.reduce_effects.title")}
          description={t("settings.reduce_effects.description")}
          titleKey="settings.reduce_effects.title"
          descKey="settings.reduce_effects.description"
          explained
          control={<Switch label={t("settings.reduce_effects.title")} checked={reduceEffects} onChange={setReduceEffects} />}
        />
        <SettingRow
          title={t("settings.frame_rate.title")}
          description={t("settings.frame_rate.description")}
          titleKey="settings.frame_rate.title"
          descKey="settings.frame_rate.description"
          explained
          control={
            <Segmented
              label={t("settings.frame_rate.title")}
              options={FRAME_CAPS.map((fps) => ({ value: String(fps), label: t("settings.frame_rate.fps", { fps }) }))}
              value={String(fps)}
              onChange={(value) => setFps(Number(value) as FrameCap)}
            />
          }
        />
      </SettingGroup>
    </>
  );
}

export function ResetAllRow(): JSX.Element {
  const { t } = useTranslation();
  return (
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
  );
}
