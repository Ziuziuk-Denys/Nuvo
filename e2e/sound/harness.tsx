import "@/ui/tokens.css";
import { applyPresetTokens } from "@/data/look/apply";
import { getPreset } from "@/data/look/presets";
import { createRoot } from "react-dom/client";
import { usePlayerStore } from "@/engine/compat";
import { connectSound, usePlayerSnapshot } from "@/features/sound/engineLink";
import { useSoundStore } from "@/features/sound/store/soundStore";
import { EqPanel } from "@/ui/shell/popovers/EqPanel";
import { SleepPanel } from "@/ui/shell/popovers/SleepPanel";
import { useAbLoopStore } from "@/features/sound/useAbLoop";
import { useSleepStore } from "@/features/sound/useSleepTimer";
import { SpeedPanel } from "@/ui/shell/popovers/SpeedPanel";
import { TEMPO_PRESETS } from "@/features/sound/lib/tempo";
import { setLocale } from "@/i18n";

// Query params: theme, lang, scene=custom|off|paused|clip|sleep|speed|speed-custom, sleep=1, loop=1
const params = new URLSearchParams(location.search);
const scene = params.get("scene") ?? "preset";
document.documentElement.dataset.theme = params.get("theme") ?? "light";
if (params.get("lang")) void setLocale(params.get("lang") ?? "en");

const fakeAnalyser = {
  frequencyBinCount: 2048,
  fftSize: 4096,
  context: { sampleRate: 48000 },
  getFloatTimeDomainData(out: Float32Array) {
    out.fill(scene === "clip" ? 1 : 0.4);
  },
  getByteFrequencyData(out: Uint8Array) {
    for (let bin = 0; bin < out.length; bin++) {
      const hz = Math.max(1, bin * (24000 / out.length));
      const slope = 185 - 15 * Math.log2(Math.max(hz, 50) / 50);
      const bumps = 18 * Math.sin(Math.log2(hz) * 2.3) + 10 * Math.sin(Math.log2(hz) * 5.1);
      out[bin] = Math.max(0, Math.min(255, slope + bumps));
    }
  },
};
const noop = () => undefined;
connectSound(
  {
    setEq: noop,
    setTrackGainDb: noop,
    analyser: () => fakeAnalyser as never,
    setSleepLevel: noop,
    seekMasked: noop,
    seek: noop,
    pauseForSleep: noop,
    livePositionMs: () => 84_000,
    setTempo: noop,
    setTempoResolver: noop,
  },
  () => noop,
);

function setPlayer(state: Record<string, unknown>) {
  usePlayerSnapshot.setState(state);
  usePlayerStore.setState(state);
}

setPlayer({
  status: scene === "paused" ? "paused" : "playing",
  currentTrack: { id: "t1", title: "Teardrop", artists: "Massive Attack", durationMs: 330_000 },
  durationMs: 330_000,
  positionMs: 84_000,
});
if (scene === "sleep" || params.get("sleep")) {
  useSleepStore.setState({
    plan: { target: { kind: "minutes", minutes: 30 }, stopAt: Date.now() + 754_000 },
    remainingMs: 754_000,
  });
}
if (params.get("loop")) {
  setTimeout(() => {
    useAbLoopStore.getState().setPoint("a", 96_000);
    useAbLoopStore.getState().setPoint("b", 171_000);
  }, 50);
}
if (scene === "speed" || scene === "speed-custom") {
  const preset = scene === "speed" ? TEMPO_PRESETS.slowedReverb : { ...TEMPO_PRESETS.slowed, rate: 0.92, pitchSemitones: -1.4 };
  setPlayer({
    playbackRate: preset.rate,
    pitchSemitones: preset.pitchSemitones,
    isPitchLinked: preset.pitchLinked,
    isReverbEnabled: preset.reverb !== null,
    reverbLevel: preset.reverb ?? 0.35,
  });
  useSoundStore.getState().rememberTempo("track", "t1", preset);
  useSoundStore.getState().rememberTempo("artist", "Massive Attack", preset);
}
const sound = useSoundStore.getState();
sound.setEnabled(scene !== "off");
sound.applyPreset("vocal");
if (scene === "custom") {
  sound.setGains([3, 2.5, 1, 0, -1.5, 0, 1.5, 3, 4.5, 4]);
  sound.saveCustomPreset("Late night");
  sound.setGain(7, 5);
  sound.rememberForArtist("Massive Attack");
}

const dark = document.documentElement.dataset.theme === "dark";
document.documentElement.classList.toggle("dark", dark);
document.documentElement.dataset.ui = "nuvo";
applyPresetTokens(document.documentElement, getPreset("nuvo"), dark ? "dark" : "light");
const width = scene === "speed" || scene === "speed-custom" ? 300 : scene === "sleep" ? 340 : 560;
const skeleton = dark ? "rgb(255 255 255 / 0.08)" : "rgb(0 0 0 / 0.06)";

createRoot(document.getElementById("root")!).render(
  <div
    style={{
      position: "relative",
      minHeight: "100vh",
      padding: 24,
      background: "var(--n-field)",
      color: "var(--n-ink)",
      fontFamily: "-apple-system, system-ui, sans-serif",
    }}
  >
    <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: 0.7 }} aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => (
        <div key={index} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: skeleton }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ width: 220, height: 10, borderRadius: 4, background: skeleton }} />
            <div style={{ width: 140, height: 8, borderRadius: 4, background: skeleton }} />
          </div>
        </div>
      ))}
    </div>
    <div
      style={{
        position: "absolute",
        left: 24,
        top: 24,
        width,
        borderRadius: 14,
        padding: 16,
        background: dark ? "rgb(255 255 255 / 0.07)" : "rgb(0 0 0 / 0.05)",
        backdropFilter: "blur(40px) saturate(1.5)",
      }}
    >
      {scene === "speed" || scene === "speed-custom" ? <SpeedPanel /> : scene === "sleep" ? <SleepPanel /> : <EqPanel />}
    </div>
  </div>,
);
