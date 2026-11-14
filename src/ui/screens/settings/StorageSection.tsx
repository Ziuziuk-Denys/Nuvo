import { useEffect, useMemo, useState, type CSSProperties, type JSX } from "react";
import { Sheet } from "../../components/Sheet";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import {
  clearStorageCategories,
  formatStorageBytes,
  getAudioCacheLimitBytes,
  getCachedStorageAnalytics,
  openCacheFolder,
  refreshStorageAnalytics,
  setAudioCacheLimitBytes,
  setStorageTabOpen,
  type StorageAnalytics,
  type StorageCategoryId,
} from "../../ports/storage";
import { KeyProtectionRow } from "./KeyProtectionRow";
import { SaveFormatRow } from "./SaveFormatRow";
import { SettingBlock, SettingGroup } from "./controls";
import sections from "./sections.module.css";
import styles from "./storage.module.css";

const GB = 1024 ** 3;
const LIMITS = [0.25 * GB, GB, 2 * GB, 3 * GB, 5 * GB, 10 * GB, 0];
const DEFAULT_LIMIT_INDEX = 3;

// Angles are in degrees, clockwise from the top
export function ringSegment(inner: number, outer: number, from: number, to: number): string {
  const sweep = Math.min(Math.max(to - from, 0.1), 359.99);
  const point = (radius: number, angle: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return `${100 + radius * Math.cos(rad)} ${100 + radius * Math.sin(rad)}`;
  };
  const large = sweep > 180 ? 1 : 0;
  return [
    `M ${point(outer, from)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${point(outer, from + sweep)}`,
    `L ${point(inner, from + sweep)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${point(inner, from)}`,
    "Z",
  ].join(" ");
}

function initialSelection(analytics: StorageAnalytics | null): Set<StorageCategoryId> {
  if (!analytics) return new Set(["covers", "audio", "web"]);
  return new Set(analytics.categories.filter((category) => category.bytes > 0).map((category) => category.id));
}

export function StorageSection(): JSX.Element {
  const { t } = useTranslation();
  const [analytics, setAnalytics] = useState<StorageAnalytics | null>(getCachedStorageAnalytics);
  const [selected, setSelected] = useState<Set<StorageCategoryId>>(() => initialSelection(getCachedStorageAnalytics()));
  const [hovered, setHovered] = useState<StorageCategoryId | null>(null);
  const [limit, setLimit] = useState(getAudioCacheLimitBytes);
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<"idle" | "clearing" | "cleared">("idle");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setStorageTabOpen(true);
    return () => setStorageTabOpen(false);
  }, []);

  useEffect(() => {
    if (analytics) return;
    refreshStorageAnalytics()
      .then((fresh) => {
        setAnalytics(fresh);
        setSelected(initialSelection(fresh));
      })
      .catch(() => setFailed(true));
  }, [analytics]);

  const selectedBytes = useMemo(
    () => analytics?.categories.filter((category) => selected.has(category.id)).reduce((sum, category) => sum + category.bytes, 0) ?? 0,
    [analytics, selected],
  );

  const slices = useMemo(() => {
    const parts = analytics?.categories.filter((category) => selected.has(category.id) && category.bytes > 0) ?? [];
    if (parts.length === 1) return [{ ...parts[0], from: 0, to: 359.99 }];
    let angle = 0;
    return parts.map((category) => {
      const span = (category.bytes / selectedBytes) * 360;
      const gap = Math.min(2, span * 0.35);
      const from = angle + gap / 2;
      const to = Math.max(from + 0.8, angle + span - gap / 2);
      angle += span;
      return { ...category, from, to };
    });
  }, [analytics, selected, selectedBytes]);

  const found = LIMITS.indexOf(limit);
  const limitIndex = found >= 0 ? found : DEFAULT_LIMIT_INDEX;
  const limitLabel = (bytes: number) => (bytes === 0 ? t("settings.storage.no_limit") : bytes < GB ? "250 MB" : `${bytes / GB} GB`);

  const changeLimit = async (bytes: number) => {
    setLimit(bytes);
    await setAudioCacheLimitBytes(bytes);
    setAnalytics(await refreshStorageAnalytics());
  };

  const toggle = (id: StorageCategoryId) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clear = async () => {
    setConfirming(false);
    setState("clearing");
    try {
      await clearStorageCategories([...selected]);
      setAnalytics(await refreshStorageAnalytics());
      setState("cleared");
    } catch {
      setFailed(true);
      setState("idle");
    }
  };

  if (state !== "idle") {
    return (
      <div className={styles.status}>
        {state === "cleared" ? (
          <span className={styles.done}>
            <Icon name="check" size={24} />
          </span>
        ) : null}
        <h3 className={styles.statusTitle}>{t(state === "cleared" ? "settings.storage.cleared_title" : "settings.storage.clearing_title")}</h3>
        <p className={styles.statusText}>{t(state === "cleared" ? "settings.storage.cleared_subtitle" : "settings.storage.clearing_subtitle")}</p>
        {state === "cleared" ? (
          <button type="button" className={styles.secondary} onClick={() => setState("idle")}>
            {t("settings.storage.done_button")}
          </button>
        ) : (
          <span className={styles.progress} />
        )}
      </div>
    );
  }

  const [value, unit] = selectedBytes > 0 ? formatStorageBytes(selectedBytes).split(" ") : ["0", ""];
  const total = analytics?.totalBytes || 1;

  return (
    <>
      <SettingGroup label={t("settings.page.space")}>
        <div className={styles.usage}>
          <div className={styles.categories}>
            {analytics?.categories.map((category) => {
              const share = Math.round((category.bytes / total) * 100);
              return (
                <button
                  key={category.id}
                  type="button"
                  role="checkbox"
                  aria-checked={selected.has(category.id)}
                  className={styles.category}
                  data-hovered={hovered === category.id ? "" : undefined}
                  onClick={() => toggle(category.id)}
                  onMouseEnter={() => setHovered(category.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className={styles.categoryLeft}>
                    <span className={styles.box}>{selected.has(category.id) ? <Icon name="check" size={16} /> : null}</span>
                    <span className={styles.dot} style={{ background: category.color }} />
                    <span className={styles.categoryName}>{t(category.labelKey)}</span>
                    <span className={styles.share}>{category.bytes === 0 ? "0%" : share === 0 ? "<1%" : `${share}%`}</span>
                  </span>
                  <span className={styles.size}>{formatStorageBytes(category.bytes)}</span>
                </button>
              );
            })}
          </div>
          <div className={styles.ringWrap}>
            <div className={styles.ring}>
              <svg viewBox="0 0 200 200" width={136} height={136} aria-hidden="true">
                <circle cx="100" cy="100" r="70" className={styles.ringTrack} />
                {selectedBytes > 0
                  ? slices.map((slice) => (
                      <path
                        key={slice.id}
                        d={hovered === slice.id ? ringSegment(57.5, 83.5, slice.from, slice.to) : ringSegment(58, 82, slice.from, slice.to)}
                        fill={slice.color}
                        onMouseEnter={() => setHovered(slice.id)}
                        onMouseLeave={() => setHovered(null)}
                      />
                    ))
                  : null}
              </svg>
              <span className={styles.ringValue}>
                {value}
                {unit ? <span className={styles.ringUnit}>{unit}</span> : null}
              </span>
            </div>
            <span className={styles.ringCaption}>{t("settings.storage.usage_title")}</span>
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => void openCacheFolder()}>
            <Icon name="folder" size={16} />
            {t("settings.storage.open_folder")}
          </button>
          <button type="button" className={styles.primary} disabled={selectedBytes === 0 || !analytics} onClick={() => setConfirming(true)}>
            {selectedBytes > 0 ? t("settings.storage.clear_button", { size: formatStorageBytes(selectedBytes) }) : t("settings.storage.clear_selected")}
          </button>
        </div>
        {failed ? <p className={sections.note}>{t("settings.cache.local_cache.error")}</p> : null}
        <SettingBlock title={t("settings.storage.cache_limit")} description={t("settings.storage.cache_limit_desc")}>
          <div className={styles.limit}>
            <div className={styles.ticks} style={{ "--at": `${(limitIndex / (LIMITS.length - 1)) * 100}%` } as CSSProperties}>
              <span className={styles.rail} />
              <span className={styles.fill} />
              {LIMITS.map((bytes, index) => (
                <span
                  key={bytes}
                  className={styles.tick}
                  data-passed={index <= limitIndex ? "" : undefined}
                  style={{ left: `${(index / (LIMITS.length - 1)) * 100}%` }}
                />
              ))}
              <span className={styles.thumb} />
              <input
                type="range"
                min={0}
                max={LIMITS.length - 1}
                step={1}
                value={limitIndex}
                aria-label={t("settings.storage.cache_limit")}
                aria-valuetext={limitLabel(LIMITS[limitIndex])}
                className={styles.range}
                onChange={(event) => void changeLimit(LIMITS[Number(event.target.value)])}
              />
            </div>
            <div className={styles.labels}>
              {LIMITS.map((bytes, index) => (
                <span
                  key={bytes}
                  className={styles.label}
                  data-active={index === limitIndex ? "" : undefined}
                  style={{ left: `${(index / (LIMITS.length - 1)) * 100}%` }}
                  onClick={() => void changeLimit(bytes)}
                >
                  {limitLabel(bytes)}
                </span>
              ))}
            </div>
          </div>
        </SettingBlock>
      </SettingGroup>

      <SettingGroup label={t("settings.page.saving")}>
        <SaveFormatRow />
      </SettingGroup>

      <SettingGroup>
        <KeyProtectionRow />
      </SettingGroup>

      <Sheet
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("settings.storage.clear_selected")}
        actions={[
          { label: t("common.cancel"), onClick: () => setConfirming(false) },
          { label: t("ui.settings.clear"), onClick: () => void clear(), primary: true },
        ]}
      >
        {t("ui.settings.clear_cache_confirm")}
      </Sheet>
    </>
  );
}
