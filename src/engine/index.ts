/** The engine port. One engine per renderer, set once by `startEngine`. */
import { useSyncExternalStore } from "react";
import type { CatalogPort } from "./adapters";
import type { Alternative } from "./sources/ports";
import { bootEngine, type BootDeps, type Booted } from "./boot";
import type { Engine } from "./engine";
import type { PlayerView, RepeatMode } from "./types";

let booted: Booted | null = null;

export function startEngine(deps: BootDeps): Booted {
  booted ??= bootEngine(deps);
  return booted;
}

/** Tears the engine down and allows a fresh `startEngine` (host shutdown, hot reload). */
export function stopEngine(): void {
  booted?.dispose();
  booted = null;
}

export function player(): Engine {
  if (!booted) throw new Error("engine not started");
  return booted.engine;
}

/** The catalog the engine was booted with (playlist suggestions). */
export function catalog(): CatalogPort {
  if (!booted) throw new Error("engine not started");
  return booted.catalog;
}

/** The sound module's whole view of the engine. */
export function soundBus() {
  if (!booted) throw new Error("engine not started");
  return booted.decks.soundBus;
}

export function clock() {
  if (!booted) throw new Error("engine not started");
  return booted.decks.clock;
}

/** Output devices: the picker's list and the choice. */
export function outputs() {
  if (!booted) throw new Error("engine not started");
  return booted.output;
}

/** Module scope so React keeps one subscription across renders. */
const subscribeToPlayer = (listener: () => void) => player().subscribe(listener);

export function usePlayerView<T>(selector: (view: PlayerView) => T): T {
  const engine = player();
  return useSyncExternalStore(subscribeToPlayer, () => selector(engine.getView()));
}

/** The repeat control order: off, all, one; a station skips all. */
export function nextRepeat(mode: RepeatMode, station: boolean): RepeatMode {
  const order: RepeatMode[] = station ? ["off", "one"] : ["off", "all", "one"];
  return order[(order.indexOf(mode) + 1) % order.length];
}

export { stateLine, streamHover, fallbackHover, STATE_LINE_EN, STATE_LINE_RU } from "./stateLine";
export { gainFromSlider, sliderFromGain } from "./tempo";
export { isStation } from "./types";
export type { PlayerView, QueueEntry, RepeatMode, Track, SurfaceState, RemoteCommand } from "./types";
export type { TransitionPolicy, TransitionInput, TransitionPlan, SpanResolver } from "./audio/decks";
export type { SpectrumFrame, SpectrumListener } from "./audio/spectrum";

/** A save started: fetch whatever it waits for. Safe before the engine starts (no-op). */
export function kickDownloads(): void {
  booted?.downloads.kick();
}

/**
 * "Choose source": `alternative` plays this track from now on, or the original again when null.
 * The cached copy goes too, so the next play is the chosen one.
 */
export async function chooseSource(trackId: string, alternative: Omit<Alternative, "reason"> | null): Promise<void> {
  if (!booted) return;
  if (alternative) await booted.resolver.choose(trackId, alternative);
  else await booted.resolver.reject(trackId);
  await booted.resolver.dropCached(trackId);
}

/** After a playlist is kept offline: the idle fill of kept tracks arms now instead of after the next pause. */
export function kickOfflineFill(): void {
  if (booted) booted.precache.statusChanged(booted.engine.getView().status);
}
