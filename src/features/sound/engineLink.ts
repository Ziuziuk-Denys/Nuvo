import { create } from "zustand";
import type { Engine } from "@/engine/engine";
import type { EqState } from "@/engine/audio/graph";
import type { Status, TuningState, Track } from "@/engine/types";
import type { TempoSettings } from "./lib/tempo";

export interface PlayerSnapshot extends TuningState {
  currentTrack: Track | null;
  status: Status;
  positionMs: number;
  durationMs: number;
  queue: Track[];
  currentIndex: number;
}

export type PlayerState = PlayerSnapshot;

const EMPTY: PlayerSnapshot = {
  currentTrack: null,
  status: "idle",
  positionMs: 0,
  durationMs: 0,
  playbackRate: 1,
  pitchSemitones: 0,
  isPitchLinked: true,
  isReverbEnabled: false,
  reverbLevel: 0.35,
  keepSpeedAcrossTracks: true,
  queue: [],
  currentIndex: -1,
};

export const usePlayerSnapshot = create<PlayerSnapshot>(() => EMPTY);

export interface SoundBackend {
  setEq(state: EqState): void;
  setTrackGainDb(trackId: string, db: number): void;
  analyser(): AnalyserNode | null;
  setSleepLevel(multiplier: number): void;
  seekMasked(positionMs: number): void;
  seek(positionMs: number): void;
  pauseForSleep(): void;
  livePositionMs(): number;
  setTempo(settings: TempoSettings): void;
  setTempoResolver(resolve: ((track: Track) => TempoSettings) | null): void;
}

export type SnapshotMirror = (push: (snapshot: PlayerSnapshot) => void) => () => void;

let backend: SoundBackend | null = null;

export function connectSound(next: SoundBackend, mirror: SnapshotMirror): () => void {
  backend = next;
  const stop = mirror((snapshot) => usePlayerSnapshot.setState(snapshot));
  return () => {
    stop();
    if (backend === next) backend = null;
  };
}

interface Bus {
  shapeEq(state: EqState, rampSeconds?: number): void;
  setTrackGainDb(trackId: string, db: number): void;
  analyser(): AnalyserNode | null;
  setSleepLevel(multiplier: number): void;
  seekMasked(positionMs: number): void;
}

export function engineSound(engine: Engine, bus: Bus, livePositionMs: () => number): { backend: SoundBackend; mirror: SnapshotMirror } {
  return {
    backend: {
      setEq: (state) => bus.shapeEq(state),
      setTrackGainDb: (trackId, db) => bus.setTrackGainDb(trackId, db),
      analyser: () => bus.analyser(),
      setSleepLevel: (multiplier) => bus.setSleepLevel(multiplier),
      seekMasked: (positionMs) => bus.seekMasked(positionMs),
      seek: (positionMs) => engine.seekTo(positionMs),
      pauseForSleep: () => engine.pauseFor("sleep"),
      livePositionMs,
      setTempo: (settings) => {
        // One call: a linked tempo derives its semitones from the rate, so the pitch stage never flickers.
        engine.setTempo(
          settings.pitchLinked ? { rate: settings.rate, linked: true } : { rate: settings.rate, semitones: settings.pitchSemitones, linked: false },
        );
        engine.setReverb(settings.reverb === null ? { on: false } : { on: true, level: settings.reverb });
      },
      setTempoResolver: (resolve) =>
        engine.setTempoResolver(
          resolve
            ? (track) => {
                const t = resolve(track);
                return { rate: t.rate, semitones: t.pitchSemitones, linked: t.pitchLinked, reverb: t.reverb };
              }
            : null,
        ),
    },
    mirror: (push) => {
      const send = () => {
        const view = engine.getView();
        push({
          currentTrack: view.current?.track ?? null,
          status: view.status,
          positionMs: view.positionMs,
          durationMs: view.durationMs,
          playbackRate: view.tempo.rate,
          pitchSemitones: view.tempo.semitones,
          isPitchLinked: view.tempo.linked,
          isReverbEnabled: view.reverb.on,
          reverbLevel: view.reverb.level,
          keepSpeedAcrossTracks: view.tempo.keepAcrossTracks,
          queue: view.entries.map((e) => e.track),
          currentIndex: view.index,
        });
      };
      send();
      return engine.subscribe(send);
    },
  };
}

export const soundActions: SoundBackend = {
  setEq: (state) => backend?.setEq(state),
  setTrackGainDb: (trackId, db) => backend?.setTrackGainDb(trackId, db),
  analyser: () => backend?.analyser() ?? null,
  setSleepLevel: (multiplier) => backend?.setSleepLevel(multiplier),
  seekMasked: (positionMs) => backend?.seekMasked(positionMs),
  seek: (positionMs) => backend?.seek(positionMs),
  pauseForSleep: () => backend?.pauseForSleep(),
  livePositionMs: () => backend?.livePositionMs() ?? usePlayerSnapshot.getState().positionMs,
  setTempo: (settings) => backend?.setTempo(settings),
  setTempoResolver: (resolve) => backend?.setTempoResolver(resolve),
};
