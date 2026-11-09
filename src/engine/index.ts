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

export function stopEngine(): void {
  booted?.dispose();
  booted = null;
}

export function player(): Engine {
  if (!booted) throw new Error("engine not started");
  return booted.engine;
}

export function catalog(): CatalogPort {
  if (!booted) throw new Error("engine not started");
  return booted.catalog;
}

export function soundBus() {
  if (!booted) throw new Error("engine not started");
  return booted.decks.soundBus;
}

export function clock() {
  if (!booted) throw new Error("engine not started");
  return booted.decks.clock;
}

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

export function kickDownloads(): void {
  booted?.downloads.kick();
}

export async function chooseSource(trackId: string, alternative: Omit<Alternative, "reason"> | null): Promise<void> {
  if (!booted) return;
  if (alternative) await booted.resolver.choose(trackId, alternative);
  else await booted.resolver.reject(trackId);
  await booted.resolver.dropCached(trackId);
}

export function kickOfflineFill(): void {
  if (booted) booted.precache.statusChanged(booted.engine.getView().status);
}
