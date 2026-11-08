import type { JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { playerEngine, usePlayerState, usePlayerStore } from "../../ports/player";
import { applyTempo, presetOf, readPlayerTempo, selectArtist, TEMPO_PRESETS, useSoundStore, type ProfileScope, type TempoPresetKey } from "../../ports/sound";
import { LabeledSwitch, OptionRow, PanelChip, Ruler } from "./controls";
import styles from "./popovers.module.css";

const PRESET_LABELS: Record<TempoPresetKey, string> = {
  normal: "sound.tempo.normal",
  slowed: "sound.tempo.slowed",
  slowedReverb: "sound.tempo.slowed_reverb",
  spedUp: "sound.tempo.sped_up",
  nightcore: "sound.tempo.nightcore",
  daycore: "sound.tempo.daycore",
};
const PRESET_KEYS = Object.keys(TEMPO_PRESETS) as TempoPresetKey[];

/** Ruler ranges: speed and pitch reset to neutral from the pill, the reverb amount has no reset. */
const SPEED_RANGE = { min: 0.5, max: 2, step: 0.05, neutral: 1 };
const PITCH_RANGE = { min: -12, max: 12, step: 0.5, neutral: 0 };
const REVERB_RANGE = { min: 0.05, max: 1, step: 0.05 };

/** Turning reverb on at an almost silent amount would sound like nothing happened, so it starts from a usable level. */
const AUDIBLE_REVERB = 0.1;
const STARTING_REVERB = 0.4;

function speedText(rate: number): string {
  return "x" + rate.toFixed(2);
}

function semitoneText(semitones: number): string {
  const sign = semitones > 0 ? "+" : "";
  return sign + semitones.toFixed(1) + " st";
}

function percentText(share: number): string {
  return Math.round(share * 100) + "%";
}

/** Speed, pitch and reverb, live through the engine: preset chips, two rulers, three option rows and the remember switches. */
export function SpeedPanel(): JSX.Element {
  const { t } = useTranslation();
  const live = usePlayerState();
  const rate = live.playbackRate ?? 1;
  const pitch = live.pitchSemitones ?? 0;
  const linked = live.isPitchLinked ?? true;
  const reverbOn = live.isReverbEnabled ?? false;
  const reverbLevel = live.reverbLevel ?? 0.35;
  const active = presetOf({ rate, pitchSemitones: pitch, pitchLinked: linked, reverb: reverbOn ? reverbLevel : null });

  const trackId = usePlayerStore((state) => state.currentTrack?.id ?? null);
  const artist = usePlayerStore(selectArtist);
  const trackRemembered = useSoundStore((state) => trackId !== null && state.tempoByTrack[trackId] !== undefined);
  const artistRemembered = useSoundStore((state) => artist !== null && state.tempoByArtist[artist.toLowerCase()] !== undefined);

  const remember = (scope: ProfileScope, key: string | null, on: boolean) => {
    if (key === null) return;
    const sound = useSoundStore.getState();
    if (on) sound.rememberTempo(scope, key, readPlayerTempo());
    else sound.forgetTempo(scope, key);
  };

  const options = [
    {
      name: "player.link_speed_pitch",
      hint: t(linked ? "player.link_speed_pitch_hint" : "player.key_lock_hint"),
      on: linked,
      set: (next: boolean) => playerEngine.setIsPitchLinked(next),
    },
    {
      name: "player.keep_speed_across_tracks",
      hint: t("player.keep_speed_hint"),
      on: live.keepSpeedAcrossTracks ?? true,
      set: (next: boolean) => playerEngine.setKeepSpeedAcrossTracks(next),
    },
    {
      name: "player.reverb",
      hint: t("player.reverb_hint"),
      on: reverbOn,
      set: (next: boolean) => {
        if (next && reverbLevel < AUDIBLE_REVERB) playerEngine.setReverbLevel(STARTING_REVERB);
        playerEngine.setIsReverbEnabled(next);
      },
    },
  ];

  return (
    <div className={styles.panel}>
      <div className={styles.chips}>
        {PRESET_KEYS.map((key) => (
          <PanelChip key={key} pressed={active === key} onClick={() => applyTempo(TEMPO_PRESETS[key])}>
            {t(PRESET_LABELS[key])}
          </PanelChip>
        ))}
        {/* kept in the row so the panel height never jumps when no preset matches */}
        <span className={styles.customChip} data-pressed="" data-shown={active === null ? "" : undefined} aria-hidden={active !== null ? true : undefined}>
          {t("sound.custom")}
        </span>
      </div>
      <Ruler {...SPEED_RANGE} label={t("player.speed")} value={rate} format={speedText} onChange={(next) => playerEngine.setPlaybackRate(next)} />
      <Ruler {...PITCH_RANGE} label={t("player.pitch")} value={pitch} format={semitoneText} onChange={(next) => playerEngine.setPitchSemitones(next)} />
      <div className={styles.options}>
        {options.map(({ name, hint, on, set }) => (
          <OptionRow key={name} title={t(name)} label={t(name)} hint={hint} checked={on} onChange={set} />
        ))}
        {reverbOn ? (
          <div className={styles.reveal}>
            <Ruler
              {...REVERB_RANGE}
              label={t("player.reverb_amount")}
              value={reverbLevel}
              format={percentText}
              onChange={(next) => playerEngine.setReverbLevel(next)}
            />
          </div>
        ) : null}
      </div>
      <div className={styles.remember}>
        <LabeledSwitch
          label={t("sound.remember_track")}
          checked={trackRemembered}
          disabled={trackId === null}
          onChange={(on) => remember("track", trackId, on)}
        />
        <LabeledSwitch
          label={t("sound.remember_artist")}
          checked={artistRemembered}
          disabled={artist === null}
          onChange={(on) => remember("artist", artist, on)}
        />
      </div>
    </div>
  );
}
