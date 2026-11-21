import { useSyncExternalStore } from "react";
import { textLookOf, type Selection } from "../ports/visual";

const KEY = "nuvo.visual";

export interface VisualSettings {
  enabled: boolean;
  stage: boolean;
  template: string;
  scene: Selection | null;
  toured: boolean;
  chosen: boolean;
}

const DEFAULTS: VisualSettings = { enabled: false, stage: false, template: "random", scene: null, toured: false, chosen: false };

const text = (value: unknown) => typeof value === "string";

function readScene(value: unknown): Selection | null {
  if (!value || typeof value !== "object") return null;
  const scene = value as Record<string, unknown>;
  const valid =
    text(scene.background) &&
    Array.isArray(scene.atmosphere) &&
    scene.atmosphere.every(text) &&
    (scene.centrepiece === null || text(scene.centrepiece)) &&
    (scene.lyrics === null || text(scene.lyrics));
  if (!valid) return null;
  const { text: stored, ...rest } = scene;
  const look = textLookOf(stored);
  return { ...(rest as unknown as Selection), ...(look ? { text: look } : {}) };
}

function read(): VisualSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<VisualSettings>;
    return {
      enabled: typeof stored.enabled === "boolean" ? stored.enabled : DEFAULTS.enabled,
      stage: typeof stored.stage === "boolean" ? stored.stage : DEFAULTS.stage,
      template: typeof stored.template === "string" ? stored.template : DEFAULTS.template,
      scene: readScene(stored.scene),
      toured: stored.toured === true,
      chosen: stored.chosen === true,
    };
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function visualSettings(): VisualSettings {
  return current;
}

export function setVisualSettings(change: Partial<VisualSettings>): void {
  current = { ...current, ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // storage blocked: the choice lasts this session
  }
  listeners.forEach((listener) => listener());
}

export function chooseScene(scene: Selection): void {
  setVisualSettings({ scene, template: "own" });
}

export function subscribeVisualSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVisualSettings(): VisualSettings {
  return useSyncExternalStore(subscribeVisualSettings, visualSettings);
}
