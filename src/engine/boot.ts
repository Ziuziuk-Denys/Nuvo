import { createContinuation, createMatchAdapter, type CatalogPort } from "./adapters";
import { OutputController, type MediaDevicesLike, type SinkTarget } from "./audio/output";
import { DeckController } from "./audio/decks";
import pitchWorkletUrl from "./audio/pitch.worklet.ts?worker&url";
import { runCommand, type LibraryPort } from "./commands";
import { Engine } from "./engine";
import { artworkData, bindMediaSession, MediaSessionMirror } from "./mediaSession";
import { PoolRefresher } from "./poolRefresher";
import { seededRandom } from "./shuffle";
import { createDaemonClient } from "./sources/daemon";
import type { YoutubePort } from "./sources/ports";
import { DownloadFetcher } from "./downloadFetcher";
import { PrecacheScheduler } from "./sources/precache";
import { offlineMode } from "./offlineMode";
import { SourceResolver } from "./sources/resolver";
import { SurfaceSender, toSurfaceState } from "./surface";
import { isLocalId, type Cause, type RemoteCommand, type SurfaceState, type Track } from "./types";

/** Late enough that the daemon has opened the library. */
const REPORTS_FLUSH_DELAY_MS = 3000;

export const CORE_BASE_URL = "nuvo-core://local";

export interface EqBand {
  type: BiquadFilterType;
  frequency: number;
  q: number;
}

export interface BootDeps {
  youtube: YoutubePort;
  catalog: CatalogPort;
  library: LibraryPort & { isLiked(trackId: string): boolean; onLikedChange(listener: () => void): () => void };
  lyrics: { follow(track: Track | null): void; prefetch(track: Track): void };
  covers: { warm(url: string): void; drawn(url: string): string };
  notify(notice: { kind: "error" | "info"; text: string; detail?: string }): void;
  askForSignIn(): void;
  offerSignIn(): boolean;
  network: { checkSoon(cause: Cause | "http_403"): void };
  eqBands: EqBand[];
  transitionContext: ConstructorParameters<typeof DeckController>[0]["transitionContext"];
}

export interface Booted {
  engine: Engine;
  decks: DeckController;
  output: OutputController;
  resolver: SourceResolver;
  precache: PrecacheScheduler;
  downloads: DownloadFetcher;
  catalog: CatalogPort;
  dispose(): void;
}

interface ShellLike {
  sendPlayerState(state: SurfaceState): void;
  onRemoteCommand(callback: (command: RemoteCommand) => void): () => void;
  onBeforeQuit(callback: () => void): () => void;
  quitReady(): void;
  onNetworkChanged(callback: () => void): () => void;
  systemMuted?(): Promise<boolean | null>;
  unmuteSystem?(): Promise<void>;
}

interface DevAudio {
  context: AudioContext | null;
  elements: [HTMLAudioElement, HTMLAudioElement] | null;
  sources: WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>;
}

function devAudio(): DevAudio {
  const fresh: DevAudio = { context: null, elements: null, sources: new WeakMap() };
  if (!import.meta.env.DEV) return fresh;
  const holder = globalThis as unknown as { __nuvoAudio?: DevAudio };
  holder.__nuvoAudio ??= fresh;
  return holder.__nuvoAudio;
}

export function fullyCachedCheck(
  daemon: { probeLocal(trackId: string): Promise<{ ok: boolean }>; probeCache(trackId: string): Promise<unknown | null> },
  resolver: { isKnownCached(trackId: string): boolean },
): (trackId: string) => Promise<boolean> {
  return async (trackId) => {
    if (isLocalId(trackId)) return (await daemon.probeLocal(trackId)).ok;
    return resolver.isKnownCached(trackId) || (await daemon.probeCache(trackId)) !== null;
  };
}

export function bootEngine(deps: BootDeps): Booted {
  const shared = devAudio();
  const elements = (shared.elements ??= [new Audio(), new Audio()]);
  const daemon = createDaemonClient(CORE_BASE_URL);
  const random = seededRandom(Date.now() >>> 0);
  const match = createMatchAdapter(CORE_BASE_URL, deps.catalog);
  const resolver = new SourceResolver({
    daemon,
    youtube: deps.youtube,
    match,
    now: Date.now,
    online: () => navigator.onLine && !offlineMode.isOn(),
    offerSignIn: deps.offerSignIn,
    objectUrls: { create: (blob) => URL.createObjectURL(blob), revoke: (url) => URL.revokeObjectURL(url) },
  });
  const decks = new DeckController({
    elements,
    createContext: () => {
      try {
        if (!shared.context || shared.context.state === "closed") shared.context = new AudioContext({ latencyHint: "playback" });
        return shared.context;
      } catch {
        return null;
      }
    },
    graph: {
      bands: deps.eqBands,
      random,
      sources: shared.sources,
      loadPitch: async (context) => {
        try {
          await context.audioWorklet.addModule(pitchWorkletUrl);
          return new AudioWorkletNode(context, "nuvo-pitch", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
        } catch {
          return null;
        }
      },
    },
    cacheUrl: (trackId) => (isLocalId(trackId) ? daemon.localUrl(trackId) : daemon.cacheUrl(trackId)),
    isFullyCached: fullyCachedCheck(daemon, resolver),
    dropCached: (trackId) => (isLocalId(trackId) ? Promise.resolve() : resolver.dropCached(trackId)),
    transitionContext: deps.transitionContext,
    log: (message, error) => console.warn(message, error ?? ""),
  });
  const precache = new PrecacheScheduler({
    daemon,
    resolve: (track, options) => resolver.resolve(track, options),
    isCached: async (trackId) => resolver.isKnownCached(trackId) || (await daemon.probeCache(trackId)) !== null,
    markCached: (trackId) => resolver.markCached(trackId),
    now: Date.now,
    log: (message, error) => console.warn(message, error ?? ""),
  });
  const downloads = new DownloadFetcher({
    base: CORE_BASE_URL,
    fetch: (input, init) => fetch(input, init),
    ensureCached: (track, signal) => precache.ensureCached(track, signal),
    log: (message, error) => console.warn(message, error ?? ""),
  });
  downloads.kick();
  const sessionArtwork = async (cover: string) => {
    const url = deps.covers.drawn(cover);
    if (!url) return null;
    return url.startsWith(CORE_BASE_URL) ? artworkData(url, (input, init) => fetch(input, init)) : url;
  };
  const mirror = "mediaSession" in navigator ? new MediaSessionMirror(navigator.mediaSession, (init) => new MediaMetadata(init), sessionArtwork) : undefined;
  const engine = new Engine({
    decks,
    resolver,
    continuation: createContinuation(CORE_BASE_URL, deps.catalog, (input, init) => fetch(input, init), match),
    postReport: async (body) => {
      const response = await fetch(`${CORE_BASE_URL}/v1/me/playback/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`play report ${response.status}`);
    },
    storage: localStorage,
    now: Date.now,
    random,
    newId: () => crypto.randomUUID(),
    notify: deps.notify,
    askForSignIn: deps.askForSignIn,
    network: deps.network,
    online: () => navigator.onLine && !offlineMode.isOn(),
    lyrics: deps.lyrics,
    covers: deps.covers,
    precache,
    mediaSession: mirror,
    log: (message, error) => console.warn(message, error ?? ""),
  });
  const unbindSession = mirror
    ? bindMediaSession(navigator.mediaSession, {
        play: () => engine.play(),
        pause: () => engine.pause(),
        next: () => engine.next(),
        previous: () => engine.previous(),
        seekTo: (ms) => engine.seekTo(ms),
        positionMs: () => engine.livePositionMs(),
        durationMs: () => engine.getView().durationMs,
      })
    : null;

  const statusListeners = new Set<(status: ReturnType<Engine["getView"]>["status"]) => void>();
  let lastStatus = engine.getView().status;
  const unsubscribeStatus = engine.subscribe((view) => {
    if (view.status === lastStatus) return;
    lastStatus = view.status;
    statusListeners.forEach((listener) => listener(view.status));
  });
  const pool = new PoolRefresher({
    base: CORE_BASE_URL,
    catalog: deps.catalog,
    fetch: (input, init) => fetch(input, init),
    storage: localStorage,
    now: Date.now,
    busy: () => ["playing", "loading"].includes(engine.getView().status),
    onStatus: (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    log: (message, error) => console.warn(message, error ?? ""),
  });
  const output = new OutputController(
    navigator.mediaDevices as unknown as MediaDevicesLike,
    () => {
      const context = decks.audioContext as (AudioContext & SinkTarget) | null;
      const sinks: SinkTarget[] = elements as unknown as SinkTarget[];
      // Chromium rejects setSinkId on an element feeding a context (AbortError): move the context sink
      return context && typeof context.setSinkId === "function" ? [context] : sinks;
    },
    {
      status: () => engine.getView().status,
      pauseForDeviceLoss: () => engine.pauseFor("device_lost"),
      resume: () => engine.resume(),
      onCommand: (listener) => engine.onCommand(listener),
      onStatus: (listener) => {
        statusListeners.add(listener);
        return () => statusListeners.delete(listener);
      },
      pauseOnDeviceLoss: () => engine.pauseOnDeviceLoss,
      remembered: () => engine.rememberedOutput,
      remember: (device) => engine.setRememberedOutput(device),
      setOutput: (view) => engine.setOutput(view),
    },
    Date.now,
    {
      contextState: () => {
        const context = decks.audioContext;
        // a context the system suspended under a playing track gets one more start before it counts as stopped
        if (context?.state === "suspended") void context.resume().catch(() => undefined);
        return context?.state ?? null;
      },
      systemMuted: () => (window as unknown as { nuvoShell?: ShellLike }).nuvoShell?.systemMuted?.() ?? Promise.resolve(null),
      unmuteSystem: () => (window as unknown as { nuvoShell?: ShellLike }).nuvoShell?.unmuteSystem?.() ?? Promise.resolve(),
    },
  );
  void output.init().catch((error) => console.warn("output devices unavailable", error));

  const warmUp = () => navigator.onLine && deps.youtube.warmUp();
  const idle = "requestIdleCallback" in window ? window.requestIdleCallback(warmUp, { timeout: 5000 }) : null;
  const warmTimer = idle === null ? setTimeout(warmUp, 2000) : null;
  const networkChanged = () => {
    engine.networkChanged();
    warmUp();
  };
  window.addEventListener("online", networkChanged);

  const releases: Array<() => void> = [offlineMode.subscribe(networkChanged)];
  const shell = (window as unknown as { nuvoShell?: ShellLike }).nuvoShell;
  let sender: SurfaceSender | null = null;
  if (shell) {
    const surface = new SurfaceSender(
      () => toSurfaceState(engine.getView(), { liked: deps.library.isLiked(engine.getView().current?.track.id ?? ""), now: Date.now() }),
      (state) => shell.sendPlayerState(state),
      Date.now,
    );
    sender = surface;
    releases.push(engine.subscribe(() => surface.poke()));
    releases.push(deps.library.onLikedChange(() => surface.poke()));
    surface.poke();
    releases.push(shell.onRemoteCommand((command) => runCommand(engine, deps.library, command)));
    releases.push(shell.onNetworkChanged(networkChanged));
    releases.push(
      shell.onBeforeQuit(() => {
        void engine.beforeQuit().finally(() => shell.quitReady());
      }),
    );
  }

  const reportsTimer = setTimeout(() => void engine.flushReports(), REPORTS_FLUSH_DELAY_MS);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(reportsTimer);
    window.removeEventListener("online", networkChanged);
    if (idle !== null) window.cancelIdleCallback(idle);
    if (warmTimer !== null) clearTimeout(warmTimer);
    for (const release of releases) release();
    sender?.dispose();
    pool.dispose();
    unsubscribeStatus();
    statusListeners.clear();
    output.dispose();
    unbindSession?.();
    engine.dispose();
    decks.dispose();
    resolver.forgetCached();
    precache.dispose();
    downloads.dispose();
    // The disposed decks closed the context; a closed context and its source nodes cannot serve a new boot.
    shared.context = null;
    shared.elements = null;
    shared.sources = new WeakMap();
  };
  return { engine, decks, output, resolver, precache, downloads, catalog: deps.catalog, dispose };
}
