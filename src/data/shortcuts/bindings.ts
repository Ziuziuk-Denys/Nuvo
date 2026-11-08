/** Default bindings, the daemon's copy of the user's changes, and the one-time move of the old renderer settings. */
import { parseAccelerator } from "./accelerator";
import type { Scope, StoredBindings } from "./registry";

export interface DefaultBinding {
  app: string | null;
  global: string | null;
}

/** Spec 3.1. app.palette and app.show are listed for conflicts and migration; their own modules register them. */
export const DEFAULT_BINDINGS: Record<string, DefaultBinding> = {
  "player.toggle": { app: "Space", global: null },
  "player.next": { app: "Control+Right", global: null },
  "player.previous": { app: "Control+Left", global: null },
  "player.seek-forward": { app: "Right", global: null },
  "player.seek-back": { app: "Left", global: null },
  "player.volume-up": { app: "Up", global: null },
  "player.volume-down": { app: "Down", global: null },
  "player.mute": { app: "M", global: null },
  "library.like-toggle": { app: null, global: "Alt+Shift+L" },
  "nav.search": { app: "/", global: null },
  "nav.queue": { app: "Q", global: null },
  "nav.lyrics": { app: "F", global: null },
  "nav.recognize": { app: "Control+Shift+R", global: null },
  "loop.set-a": { app: "[", global: null },
  "loop.set-b": { app: "]", global: null },
  "loop.clear": { app: "\\", global: null },
  "app.palette": { app: "Control+K", global: null },
  "app.quit": { app: "Control+Q", global: null },
  "app.fullscreen": { app: "F11", global: null },
  "app.show": { app: null, global: null },
};

/** The old renderer's persisted shortcuts. */
export const LEGACY_SHORTCUTS_KEY = "nuvo_shortcuts_settings_v1";

const LEGACY_FIELDS: Record<"global" | "mainApp", Record<string, string>> = {
  global: { quickLikeSong: "library.like-toggle" },
  mainApp: {
    playPause: "player.toggle",
    nextTrack: "player.next",
    prevTrack: "player.previous",
    seekForward: "player.seek-forward",
    seekBackward: "player.seek-back",
    volumeUp: "player.volume-up",
    volumeDown: "player.volume-down",
    toggleMute: "player.mute",
    search: "nav.search",
    toggleQueue: "nav.queue",
    toggleFullscreen: "nav.lyrics",
    loopA: "loop.set-a",
    loopB: "loop.set-b",
    loopClear: "loop.clear",
  },
};

export function emptyBindings(): StoredBindings {
  return { version: 1, app: {}, global: {} };
}

/** The old settings as stored bindings: canonical, only real changes, the global one wins a cross-scope clash; null without the key. */
export function migrateLegacyBindings(raw: string | null, defaults: Record<string, DefaultBinding> = DEFAULT_BINDINGS): StoredBindings | null {
  if (raw === null) return null;
  const result = emptyBindings();
  let state: Record<string, unknown> | undefined;
  try {
    state = (JSON.parse(raw) as { state?: Record<string, unknown> } | null)?.state;
  } catch {
    return result;
  }
  if (!state || typeof state !== "object") return result;
  const scopes: Array<["global" | "mainApp", Scope]> = [
    ["global", "global"],
    ["mainApp", "app"],
  ];
  for (const [field, scope] of scopes) {
    const values = state[field] as Record<string, unknown> | undefined;
    if (!values || typeof values !== "object") continue;
    for (const [name, value] of Object.entries(values)) {
      const id = LEGACY_FIELDS[field][name];
      // the old app could not clear a binding, so an empty value is not a choice
      if (!id || typeof value !== "string" || value.trim() === "") continue;
      const accelerator = parseAccelerator(value);
      if (accelerator && accelerator !== defaults[id]?.[scope]) result[scope][id] = accelerator;
    }
  }
  const effective = (scope: Scope, id: string) => (Object.hasOwn(result[scope], id) ? result[scope][id] : (defaults[id]?.[scope] ?? null));
  for (const id of Object.keys(defaults)) {
    const accelerator = effective("global", id);
    if (!accelerator) continue;
    for (const other of Object.keys(defaults)) {
      if (other === id || effective("app", other) !== accelerator) continue;
      delete result.app[other];
      if (defaults[other].app === accelerator) result.app[other] = null;
    }
  }
  return result;
}

function scopeMap(value: unknown): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (!value || typeof value !== "object") return out;
  for (const [id, accelerator] of Object.entries(value)) {
    if (accelerator === null || typeof accelerator === "string") out[id] = accelerator;
  }
  return out;
}

export function toStoredBindings(value: unknown): StoredBindings | null {
  const stored = value as { version?: unknown; app?: unknown; global?: unknown } | null;
  if (!stored || stored.version !== 1) return null;
  return { version: 1, app: scopeMap(stored.app), global: scopeMap(stored.global) };
}

export type LoadResult = { state: "ok"; bindings: StoredBindings | null } | { state: "unavailable" };

export function createBindingsClient(base: string, doFetch: typeof fetch) {
  const url = `${base}/v1/shortcuts`;
  return {
    /** Unavailable when the library is locked (423) or the daemon is starting or down. */
    async load(): Promise<LoadResult> {
      try {
        const response = await doFetch(url);
        if (!response.ok) return { state: "unavailable" };
        const body = (await response.json()) as { bindings?: unknown };
        return { state: "ok", bindings: toStoredBindings(body.bindings) };
      } catch {
        return { state: "unavailable" };
      }
    },
    async save(bindings: StoredBindings): Promise<boolean> {
      try {
        const response = await doFetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bindings) });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}

export type BindingsClient = ReturnType<typeof createBindingsClient>;
