import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { usePlayerStore } from "../../ports/player";
import {
  BUILT_IN_PRESETS,
  clampGain,
  EQ_FREQUENCIES,
  EQ_MAX_DB,
  EQ_MIN_DB,
  logFrequencies,
  presetNameFor,
  profileGains,
  responseDb,
  selectArtist,
  snapGain,
  subscribeSpectrum,
  useSoundStore,
  type BuiltInPreset,
  type EqGains,
  type Profile,
  type ProfileScope,
} from "../../ports/sound";
import { LabeledSwitch, PanelChip, Switch } from "./controls";
import styles from "./EqPanel.module.css";
import popover from "./popovers.module.css";

const PRESET_KEYS = Object.keys(BUILT_IN_PRESETS) as BuiltInPreset[];
const PLOT_HEIGHT = 220;
// keeps a handle at +12 or -12 dB fully inside the plot
const PLOT_PAD = 12;
const CURVE_POINTS = 256;
const CURVE_FREQS = logFrequencies(CURVE_POINTS);
const BAND_FREQS = new Float32Array(EQ_FREQUENCIES);
const MIN_HZ = 20;
const LOG_SPAN = Math.log(20000 / MIN_HZ);
// the path is drawn in a 1000-wide box stretched to the panel; strokes keep their width
const VIEW_WIDTH = 1000;
const GRID_DB = [12, 6, 0, -6, -12];
const GRID_HZ = [100, 1000, 10000];
const MAX_PRESET_NAME = 32;

const xOf = (hz: number) => Math.log(hz / MIN_HZ) / LOG_SPAN;
const yOf = (db: number) => PLOT_PAD + ((EQ_MAX_DB - Math.min(EQ_MAX_DB, Math.max(EQ_MIN_DB, db))) / (EQ_MAX_DB - EQ_MIN_DB)) * (PLOT_HEIGHT - PLOT_PAD * 2);
const bandLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));
const gridHz = (hz: number) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`);
const gridDb = (db: number) => (db > 0 ? `+${db}` : db < 0 ? `−${-db}` : "0");
const percentX = (hz: number) => `${(xOf(hz) * 100).toFixed(3)}%`;
// a tip over a handle this close to the top would leave the plot, so it hangs under the handle instead
const TIP_FLIP_Y = 36;
const formatDb = (db: number) => `${db > 0 ? "+" : ""}${db.toFixed(1)}`;

function curvePaths(levels: Float32Array): { line: string; area: string } {
  const points = Array.from(levels, (db, index) => `${((index / (levels.length - 1)) * VIEW_WIDTH).toFixed(1)},${yOf(db).toFixed(1)}`);
  const line = `M${points.join("L")}`;
  const zero = yOf(0).toFixed(1);
  return { line, area: `${line}L${VIEW_WIDTH},${zero}L0,${zero}Z` };
}

/** The spectrum as a filled outline from the plot floor: band i of n sits at the centre of its log slice. */
export function spectrumPath(bands: Float32Array): string {
  const floor = PLOT_HEIGHT - PLOT_PAD;
  const span = PLOT_HEIGHT - PLOT_PAD * 2;
  const points = Array.from(bands, (level, index) => {
    const x = ((index + 0.5) / bands.length) * VIEW_WIDTH;
    const y = floor - Math.min(1, Math.max(0, level)) * span;
    return `L${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M0,${floor}${points.join("")}L${VIEW_WIDTH},${floor}Z`;
}

/** Live post-EQ spectrum behind the bands and the clip light; listens only while mounted, so only while the panel is open. */
function useSpectrum(): { pathRef: RefObject<SVGPathElement | null>; clipRef: RefObject<HTMLSpanElement | null> } {
  const pathRef = useRef<SVGPathElement>(null);
  const clipRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // frames arrive every animation frame, so they go straight to the DOM instead of through React state
    try {
      return subscribeSpectrum((frame) => {
        pathRef.current?.setAttribute("d", spectrumPath(frame.bands));
        clipRef.current?.toggleAttribute("data-on", frame.clip);
      });
    } catch {
      // the engine has not started yet: no audio, nothing to draw
      return undefined;
    }
  }, []);
  return { pathRef, clipRef };
}

type Naming = { mode: "save" } | { mode: "rename"; name: string };

/** The equalizer's header controls: Auto gain, Compare, then the master switch. */
export function EqHeader(): JSX.Element {
  const { t } = useTranslation();
  const enabled = useSoundStore((state) => state.eqEnabled);
  const autoGain = useSoundStore((state) => state.autoGain);
  const bypass = useSoundStore((state) => state.bypass);
  const store = useSoundStore.getState();
  return (
    <div className={styles.header}>
      <PanelChip pressed={autoGain} onClick={() => store.setAutoGain(!autoGain)}>
        {t("sound.auto_gain")}
      </PanelChip>
      <PanelChip pressed={bypass} onClick={() => store.setBypass(!bypass)}>
        {t("sound.compare")}
      </PanelChip>
      <span className={styles.divider} aria-hidden="true" />
      <Switch label={t("sound.title")} checked={enabled} onChange={(on) => useSoundStore.getState().setEnabled(on)} />
    </div>
  );
}

/**
 * The ten-band equalizer: a response curve with a handle per band over a dB and Hz grid, the presets
 * under it, then the remember switches and Save as preset. It edits the curve playback uses: the
 * track's, else the artist's, else the global one.
 */
export function EqPanel(): JSX.Element {
  const { t } = useTranslation();
  const enabled = useSoundStore((state) => state.eqEnabled);
  const bypass = useSoundStore((state) => state.bypass);
  const gains = useSoundStore((state) => state.gains);
  const presetName = useSoundStore((state) => state.presetName);
  const customPresets = useSoundStore((state) => state.customPresets);
  const byTrack = useSoundStore((state) => state.byTrack);
  const byArtist = useSoundStore((state) => state.byArtist);
  const trackId = usePlayerStore((state) => state.currentTrack?.id ?? null);
  const artist = usePlayerStore(selectArtist);
  const [dragBand, setDragBand] = useState<number | null>(null);
  const [focusBand, setFocusBand] = useState<number | null>(null);
  const [hoverBand, setHoverBand] = useState<number | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [draftName, setDraftName] = useState("");
  const spectrum = useSpectrum();

  // Compare is a listening aid: leaving the panel always returns to the equalized sound
  useEffect(
    () => () => {
      if (useSoundStore.getState().bypass) useSoundStore.getState().setBypass(false);
    },
    [],
  );

  const trackProfile = trackId !== null ? byTrack[trackId] : undefined;
  const artistProfile = artist !== null ? byArtist[artist.toLowerCase()] : undefined;
  const scope: { kind: ProfileScope; key: string } | null =
    trackProfile !== undefined && trackId !== null
      ? { kind: "track", key: trackId }
      : artistProfile !== undefined && artist !== null
        ? { kind: "artist", key: artist }
        : null;
  const activeProfile = trackProfile ?? artistProfile;
  const shownGains = activeProfile === undefined ? gains : profileGains(activeProfile, customPresets);
  const preferred = typeof activeProfile === "string" ? activeProfile : activeProfile === undefined ? presetName : "custom";
  const shownPreset = presetNameFor(shownGains, preferred, customPresets);
  const shownProfile: Profile = activeProfile ?? (presetName !== "custom" ? presetName : gains);

  const curve = useMemo(() => curvePaths(responseDb(shownGains, CURVE_FREQS)), [shownGains]);
  const bandLevels = useMemo(() => responseDb(shownGains, BAND_FREQS), [shownGains]);

  // every edit is meant to be heard, so it turns the equalizer on and ends a comparison
  const edit = (change: () => void) => {
    const store = useSoundStore.getState();
    if (!store.eqEnabled) store.setEnabled(true);
    if (store.bypass) store.setBypass(false);
    change();
  };

  const commitGains = (next: EqGains) =>
    edit(() => {
      const store = useSoundStore.getState();
      if (!scope) return store.setGains(next);
      const clamped = next.map(clampGain);
      const name = presetNameFor(clamped, shownPreset, customPresets);
      store.setProfile(scope.kind, scope.key, name === "custom" ? clamped : name);
    });

  const setBand = (index: number, db: number) => {
    const next = [...shownGains];
    next[index] = db;
    commitGains(next);
  };

  const choosePreset = (name: string) =>
    edit(() => {
      const store = useSoundStore.getState();
      if (scope) store.setProfile(scope.kind, scope.key, name);
      else store.applyPreset(name);
    });

  const remember = (kind: ProfileScope, key: string | null, on: boolean) => {
    if (key === null) return;
    const store = useSoundStore.getState();
    if (on) store.setProfile(kind, key, shownProfile);
    else store.forget(kind, key);
  };

  const cleanName = draftName.trim().slice(0, MAX_PRESET_NAME);
  const renaming = naming?.mode === "rename" ? naming.name : null;
  const reserved = ["custom", t("sound.custom"), ...PRESET_KEYS, ...PRESET_KEYS.map((key) => t(`sound.presets.${key}`)), ...Object.keys(customPresets)];
  const nameTaken =
    cleanName !== "" && cleanName.toLowerCase() !== renaming?.toLowerCase() && reserved.some((name) => name.toLowerCase() === cleanName.toLowerCase());

  const closeNaming = () => {
    setNaming(null);
    setDraftName("");
  };

  const submitName = () => {
    if (cleanName === "") return closeNaming();
    if (nameTaken || !naming) return;
    const store = useSoundStore.getState();
    if (naming.mode === "rename") {
      store.renameCustomPreset(naming.name, cleanName);
    } else if (scope) {
      store.saveCustomPreset(cleanName, shownGains);
      store.setProfile(scope.kind, scope.key, cleanName);
    } else {
      store.saveCustomPreset(cleanName);
    }
    closeNaming();
  };

  const onHandleDown = (index: number) => (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startDb = shownGains[index];
    const usable = PLOT_HEIGHT - PLOT_PAD * 2;
    setDragBand(index);
    const target = event.currentTarget;
    const move = (moveEvent: globalThis.PointerEvent) => {
      const deltaDb = ((startY - moveEvent.clientY) / usable) * (EQ_MAX_DB - EQ_MIN_DB);
      setBand(index, snapGain(startDb + deltaDb, moveEvent.shiftKey));
    };
    const up = () => {
      setDragBand(null);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const onHandleKey = (index: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.5;
    const moves: Record<string, number> = {
      ArrowUp: shownGains[index] + step,
      ArrowRight: shownGains[index] + step,
      ArrowDown: shownGains[index] - step,
      ArrowLeft: shownGains[index] - step,
      PageUp: shownGains[index] + 3,
      PageDown: shownGains[index] - 3,
      Home: 0,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    setBand(index, snapGain(moves[event.key], event.shiftKey));
  };

  const shownBand = dragBand ?? hoverBand ?? focusBand;
  // the tip keeps its last band while it fades out
  const lastBand = useRef(0);
  if (shownBand !== null) lastBand.current = shownBand;
  const tipBand = lastBand.current;
  const tipY = yOf(bandLevels[tipBand]);
  const bandName = (hz: number) => t(`ui.eq.bands.${hz}`);
  const live = enabled && !bypass;

  return (
    <div className={popover.panel}>
      <div className={styles.eq} data-off={live ? undefined : ""} data-dragging={dragBand !== null ? "" : undefined}>
        <div className={styles.plot} role="group" aria-label={t("ui.eq.curve")}>
          <svg className={styles.curve} viewBox={`0 0 ${VIEW_WIDTH} ${PLOT_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
            <path ref={spectrum.pathRef} className={styles.spectrum} />
            {GRID_HZ.map((hz) => (
              <line key={hz} className={styles.grid} x1={xOf(hz) * VIEW_WIDTH} x2={xOf(hz) * VIEW_WIDTH} y1={PLOT_PAD} y2={PLOT_HEIGHT - PLOT_PAD} />
            ))}
            <path className={styles.area} style={{ d: `path("${curve.area}")` } as CSSProperties} />
            <path className={styles.line} style={{ d: `path("${curve.line}")` } as CSSProperties} />
          </svg>
          {GRID_DB.map((db) => (
            <span key={db} aria-hidden="true">
              <span className={styles.hline} data-zero={db === 0 ? "" : undefined} style={{ top: Math.round(yOf(db)) }} />
              <span className={styles.dbLabel} style={{ top: yOf(db) }}>
                {gridDb(db)}
              </span>
            </span>
          ))}
          {GRID_HZ.map((hz) => (
            <span key={hz} className={styles.hzLabel} style={{ left: percentX(hz) }} aria-hidden="true">
              {gridHz(hz)}
            </span>
          ))}
          {EQ_FREQUENCIES.map((hz, index) => (
            <div
              key={hz}
              role="slider"
              tabIndex={0}
              aria-label={`${bandName(hz)}, ${hz >= 1000 ? t("sound.khz", { value: hz / 1000 }) : t("sound.hz", { value: hz })}`}
              aria-orientation="vertical"
              aria-valuemin={EQ_MIN_DB}
              aria-valuemax={EQ_MAX_DB}
              aria-valuenow={shownGains[index]}
              aria-valuetext={`${formatDb(shownGains[index])} dB`}
              data-active={dragBand === index ? "" : undefined}
              className={styles.handle}
              style={{ left: percentX(hz), translate: `-50% calc(-50% + ${yOf(bandLevels[index]).toFixed(1)}px)` }}
              onPointerDown={onHandleDown(index)}
              onKeyDown={onHandleKey(index)}
              onDoubleClick={() => setBand(index, 0)}
              onPointerEnter={() => setHoverBand(index)}
              onPointerLeave={() => setHoverBand(null)}
              onFocus={() => setFocusBand(index)}
              onBlur={() => setFocusBand(null)}
            />
          ))}
          <span ref={spectrum.clipRef} className={styles.clip} role="img" aria-label={t("ui.eq.clip")} title={t("ui.eq.clip")} />
          <span
            className={styles.tip}
            aria-hidden="true"
            data-on={shownBand !== null ? "" : undefined}
            data-below={tipY < TIP_FLIP_Y ? "" : undefined}
            style={{ left: percentX(EQ_FREQUENCIES[tipBand]), top: `${tipY.toFixed(1)}px` }}
          >
            {bandName(EQ_FREQUENCIES[tipBand])}
          </span>
        </div>
        <div className={styles.bands} aria-hidden="true">
          {EQ_FREQUENCIES.map((hz) => (
            <span key={hz} className={styles.band} style={{ left: percentX(hz) }}>
              {bandLabel(hz)}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.presets}>
        {shownPreset === "custom" ? (
          <span className={styles.customChip} data-pressed="">
            {t("sound.custom")}
          </span>
        ) : null}
        {PRESET_KEYS.map((key) => (
          <PanelChip key={key} pressed={shownPreset === key} onClick={() => choosePreset(key)}>
            {t(`sound.presets.${key}`)}
          </PanelChip>
        ))}
        {Object.keys(customPresets).map((name) => (
          <span key={name} className={styles.ownChip} data-pressed={shownPreset === name || renaming === name ? "" : undefined}>
            <button type="button" aria-pressed={shownPreset === name} className={styles.ownName} onClick={() => choosePreset(name)}>
              {name}
            </button>
            <button
              type="button"
              aria-label={t("sound.rename_preset", { name })}
              className={styles.ownIcon}
              onClick={() => setNaming({ mode: "rename", name })}
            >
              <Icon name="edit" size={16} />
            </button>
            <button
              type="button"
              aria-label={t("sound.delete_preset", { name })}
              className={styles.ownIcon}
              onClick={() => useSoundStore.getState().deleteCustomPreset(name)}
            >
              <Icon name="close" size={16} />
            </button>
          </span>
        ))}
      </div>
      <div className={popover.remember}>
        <LabeledSwitch
          label={t("sound.remember_track")}
          checked={trackProfile !== undefined}
          disabled={trackId === null}
          onChange={(on) => remember("track", trackId, on)}
        />
        <LabeledSwitch
          label={t("sound.remember_artist")}
          checked={artistProfile !== undefined}
          disabled={artist === null}
          onChange={(on) => remember("artist", artist, on)}
        />
        <div className={styles.save}>
          {naming ? (
            <>
              {nameTaken ? (
                <span role="alert" className={styles.taken}>
                  {t("sound.name_taken")}
                </span>
              ) : null}
              <input
                autoFocus
                className={styles.name}
                data-taken={nameTaken ? "" : undefined}
                value={draftName}
                maxLength={MAX_PRESET_NAME}
                placeholder={t("sound.preset_name")}
                aria-label={naming.mode === "rename" ? t("sound.rename_preset", { name: naming.name }) : t("sound.preset_name")}
                aria-invalid={nameTaken}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitName();
                  if (event.key === "Escape") {
                    // the name field's own Escape, not the popover's
                    event.stopPropagation();
                    closeNaming();
                  }
                }}
                onBlur={closeNaming}
              />
            </>
          ) : (
            <button type="button" className={styles.saveChip} onClick={() => setNaming({ mode: "save" })}>
              {t("sound.save_preset")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
