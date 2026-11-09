import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Popover } from "../../components/Popover";
import { Slider } from "../../components/Slider";
import { TextField } from "../../components/TextField";
import { Icon } from "../../icons/Icon";
import { cssFamily, familyValue, userFontFamily, useAppearanceStore, type FontChoice, type FontFileEntry, type FontSettings } from "../../ports/appearance";
import { useTranslation } from "../../ports/i18n";
import { SettingBlock, SettingGroup, SettingRow } from "./controls";
import styles from "./look.module.css";
import sections from "./sections.module.css";

const ROW_PX = 36;
const LIST_PX = 288;
const SAVE_DELAY_MS = 400;
type Slot = "ui" | "lyrics";
type Option = { choice: FontChoice; label: string };

const sameChoice = (a: FontChoice, b: FontChoice) => JSON.stringify(a) === JSON.stringify(b);

function previewFamily(choice: FontChoice): string | undefined {
  if (choice.kind === "file") return `${cssFamily(userFontFamily(choice.id))}, var(--n-font-stack)`;
  return familyValue(choice, new Set()) ?? undefined;
}

function useFontSaver(): (fonts: FontSettings) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (fonts) => {
    useAppearanceStore.setState((s) => ({ saved: { ...s.saved, fonts } }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void useAppearanceStore.getState().save({ fonts }), SAVE_DELAY_MS);
  };
}

export function FontsGroup(): JSX.Element {
  const { t } = useTranslation();
  const fonts = useAppearanceStore((s) => s.saved.fonts);
  const files = useAppearanceStore((s) => s.saved.fontFiles);
  const [system, setSystem] = useState<string[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [open, setOpen] = useState<Slot | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [preview, setPreview] = useState<FontChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveFonts = useFontSaver();

  const scan = (rescan: boolean) =>
    void window.nuvoShell?.listSystemFonts(rescan).then((result) => {
      setListFailed(!result.ok);
      setSystem(result.ok ? result.families : []);
    });
  useEffect(() => scan(false), []);

  const options = useMemo<Option[]>(
    () => [
      { choice: { kind: "default" }, label: t("appearance.fonts.default") },
      ...files.map((file) => ({ choice: { kind: "file" as const, id: file.id }, label: file.family })),
      ...(system ?? []).map((family) => ({ choice: { kind: "system" as const, family }, label: family })),
    ],
    [files, system, t],
  );

  const label = (choice: FontChoice) =>
    choice.kind === "system"
      ? choice.family
      : choice.kind === "file"
        ? (files.find((f) => f.id === choice.id)?.family ?? t("appearance.fonts.default"))
        : t("appearance.fonts.default");
  const missing = (choice: FontChoice) =>
    (choice.kind === "system" && system !== null && !listFailed && !system.includes(choice.family)) ||
    (choice.kind === "file" && !files.some((f) => f.id === choice.id));

  const save = async (patch: Parameters<ReturnType<typeof useAppearanceStore.getState>["save"]>[0]) => {
    const ok = await useAppearanceStore.getState().save(patch);
    setError(ok ? null : t("appearance.errors.save_failed"));
    return ok;
  };

  const choose = (slot: Slot, choice: FontChoice) => {
    setOpen(null);
    setPreview(null);
    void save({ fonts: { ...fonts, [slot]: choice } });
  };

  const loadFile = async (slot: Slot) => {
    setError(null);
    const result = await window.nuvoShell?.importFontFile();
    if (!result) return;
    if (!result.ok) {
      if (result.error !== "cancelled") setError(t(`appearance.fonts.errors.${result.error}`));
      return;
    }
    const known = files.some((f) => f.id === result.file.id);
    const fontFiles = known ? files : [...files, result.file];
    const ok = await save({ fontFiles, fonts: { ...fonts, [slot]: { kind: "file", id: result.file.id } } });
    if (!ok && !known) void window.nuvoShell?.deleteFontFile(result.file.id);
  };

  const removeFile = async (file: FontFileEntry) => {
    if (await save({ fontFiles: files.filter((f) => f.id !== file.id) })) void window.nuvoShell?.deleteFontFile(file.id);
  };

  const slotRow = (slot: Slot) => {
    const title = t(`appearance.fonts.${slot}`);
    return (
      <SettingRow
        key={slot}
        title={title}
        titleKey={`appearance.fonts.${slot}`}
        descKey="appearance.fonts.title"
        description={missing(fonts[slot]) ? t("appearance.fonts.missing") : undefined}
        explained
        control={
          <div className={styles.fontControls}>
            <button
              type="button"
              className={styles.fontName}
              style={{ fontFamily: previewFamily(fonts[slot]) }}
              aria-haspopup="listbox"
              aria-label={`${title}: ${label(fonts[slot])}`}
              onClick={(event) => {
                setAnchor(event.currentTarget);
                setOpen(slot);
              }}
            >
              <span>{label(fonts[slot])}</span>
              <Icon name="chevron-down" size={14} />
            </button>
            <button type="button" className={sections.button} onClick={() => void loadFile(slot)}>
              {t("appearance.fonts.load_file")}
            </button>
            {fonts[slot].kind !== "default" ? (
              <button
                type="button"
                className={styles.iconAction}
                title={t("appearance.fonts.reset")}
                aria-label={`${title}: ${t("appearance.fonts.reset")}`}
                onClick={() => choose(slot, { kind: "default" })}
              >
                <Icon name="undo" size={16} />
              </button>
            ) : null}
          </div>
        }
      />
    );
  };

  return (
    <SettingGroup label={t("appearance.fonts.title")}>
      {slotRow("ui")}
      {slotRow("lyrics")}
      <SettingBlock title={t("appearance.fonts.ui_size")} titleKey="appearance.fonts.ui_size" descKey="appearance.fonts.title">
        <div className={styles.sample} aria-hidden="true">
          <span style={{ fontFamily: previewFamily(open === "ui" && preview ? preview : fonts.ui) }}>{t("appearance.fonts.sample_ui")}</span>
          <span className={styles.lyricSample} style={{ fontFamily: previewFamily(open === "lyrics" && preview ? preview : fonts.lyrics) }}>
            {t("appearance.fonts.sample_lyrics")}
          </span>
          <span style={{ fontFamily: previewFamily(open === "ui" && preview ? preview : fonts.ui) }}>{t("appearance.fonts.sample_cyrillic")}</span>
        </div>
        <div className={sections.wallpaperSliders}>
          <label className={sections.sliderField}>
            <span>{t("appearance.fonts.ui_size")}</span>
            <Slider
              label={t("appearance.fonts.ui_size")}
              min={90}
              max={120}
              step={5}
              value={Math.round(fonts.uiScale * 100)}
              format={(v) => `${v}%`}
              onChange={(v) => saveFonts({ ...fonts, uiScale: v / 100 })}
            />
          </label>
          <label className={sections.sliderField}>
            <span>{t("appearance.fonts.lyrics_size")}</span>
            <Slider
              label={t("appearance.fonts.lyrics_size")}
              min={80}
              max={140}
              step={5}
              value={Math.round(fonts.lyricsScale * 100)}
              format={(v) => `${v}%`}
              onChange={(v) => saveFonts({ ...fonts, lyricsScale: v / 100 })}
            />
          </label>
        </div>
      </SettingBlock>
      {files.length > 0 ? (
        <SettingBlock
          title={t("appearance.fonts.files")}
          titleKey="appearance.fonts.files"
          description={t("appearance.fonts.licence")}
          descKey="appearance.fonts.title"
        >
          <ul className={styles.fileList}>
            {files.map((file) => {
              const inUse = [fonts.ui, fonts.lyrics].some((c) => c.kind === "file" && c.id === file.id);
              return (
                <li key={file.id} className={styles.fileRow}>
                  <span style={{ fontFamily: previewFamily({ kind: "file", id: file.id }) }}>{file.family}</span>
                  <button
                    type="button"
                    className={styles.iconAction}
                    aria-label={t("appearance.fonts.delete", { name: file.family })}
                    title={t("appearance.fonts.delete", { name: file.family })}
                    disabled={inUse}
                    onClick={() => void removeFile(file)}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </SettingBlock>
      ) : null}
      {listFailed ? <p className={sections.note}>{t("appearance.fonts.no_list")}</p> : null}
      {error ? <p className={styles.problem}>{error}</p> : null}

      {open ? (
        <Popover
          open
          anchor={anchor}
          solid
          title={t(`appearance.fonts.${open}`)}
          width={300}
          onClose={() => {
            setOpen(null);
            setPreview(null);
          }}
        >
          <FontList options={options} current={fonts[open]} onPreview={setPreview} onChoose={(choice) => choose(open, choice)} onRescan={() => scan(true)} />
        </Popover>
      ) : null}
    </SettingGroup>
  );
}

function FontList({
  options,
  current,
  onPreview,
  onChoose,
  onRescan,
}: {
  options: Option[];
  current: FontChoice;
  onPreview: (choice: FontChoice | null) => void;
  onChoose: (choice: FontChoice) => void;
  onRescan: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())), [options, query]);
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      shown.findIndex((o) => sameChoice(o.choice, current)),
    ),
  );
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_PX,
    overscan: 6,
    initialRect: { width: 280, height: LIST_PX },
    initialOffset: () => Math.max(0, index * ROW_PX - LIST_PX / 2),
  });

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && shown[index]) {
      event.preventDefault();
      onChoose(shown[index].choice);
      return;
    }
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const clamped = Math.min(shown.length - 1, Math.max(0, next));
    setIndex(clamped);
    virtualizer.scrollToIndex(clamped);
    onPreview(shown[clamped]?.choice ?? null);
  };

  return (
    <div className={styles.fontPicker} onKeyDown={onKey} onPointerLeave={() => onPreview(null)}>
      <TextField
        label={t("appearance.fonts.search")}
        value={query}
        placeholder={t("appearance.fonts.search")}
        onClear={() => setQuery("")}
        onChange={(text) => {
          setQuery(text);
          setIndex(0);
        }}
      />
      <div
        ref={scroller}
        className={`${styles.fontList} n-scroll`}
        role="listbox"
        aria-label={t("appearance.fonts.list")}
        aria-activedescendant={shown.length ? `font-option-${index}` : undefined}
        tabIndex={0}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const option = shown[item.index];
            return (
              <div
                key={item.key}
                id={`font-option-${item.index}`}
                role="option"
                aria-selected={item.index === index}
                className={styles.fontOption}
                style={{ transform: `translateY(${item.start}px)`, fontFamily: previewFamily(option.choice) }}
                onPointerEnter={() => onPreview(option.choice)}
                onClick={() => onChoose(option.choice)}
              >
                <span>{option.label}</span>
                {sameChoice(option.choice, current) ? <Icon name="check" size={14} /> : null}
              </div>
            );
          })}
        </div>
      </div>
      <button type="button" className={styles.textAction} onClick={onRescan}>
        <Icon name="refresh" size={14} />
        {t("appearance.fonts.rescan")}
      </button>
    </div>
  );
}
