import type { Preset, PresetMode, Tokens } from "./presets";

const ink = (percent: number) => `color-mix(in srgb, var(--n-ink) ${percent}%, transparent)`;

// Written inline so they win over the static defaults in the base stylesheet
const OLDER_NAMES: Record<string, string> = {
  "bg-canvas": "var(--n-deep)",
  "bg-panel": "var(--n-deep)",
  "bg-surface": "var(--n-raised)",
  "bg-elevated": "var(--n-raised)",
  "bg-primary": "var(--n-field)",
  "bg-overlay": "color-mix(in srgb, var(--n-field) 96%, transparent)",
  "bg-glass": "color-mix(in srgb, var(--n-field) 55%, transparent)",
  "bg-toolbox": ink(4),
  "bg-toolbox-active": ink(8),
  "border-primary": "var(--n-hair)",
  "border-secondary": ink(20),
  "border-tertiary": "var(--n-ink-3)",
  "border-toolbox-divider": "var(--n-hair)",
  "border-white-alpha-14": "var(--n-hair)",
  "border-white-alpha-33": ink(25),
  "text-primary": "var(--n-ink)",
  "text-secondary": "var(--n-ink-2)",
  "text-tertiary": "var(--n-ink-3)",
  "accent-primary": "var(--n-accent)",
  "accent-secondary": "var(--n-accent)",
  "accent-tertiary": "var(--n-accent)",
  "btn-primary-bg": "var(--n-ink)",
  "btn-primary-text": "var(--n-field)",
};

export function applyTokens(root: HTMLElement, key: string, tokens: Tokens): void {
  const stale: string[] = [];
  for (let i = 0; i < root.style.length; i += 1) {
    const name = root.style.item(i);
    if (name.startsWith("--n-") && !(name.slice(2) in tokens)) stale.push(name);
  }
  for (const name of stale) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(`--${name}`, value);
  for (const [name, value] of Object.entries(OLDER_NAMES)) root.style.setProperty(`--${name}`, value);
  root.dataset.look = key;
}

export function applyPresetTokens(root: HTMLElement, preset: Preset, mode: PresetMode): void {
  const tokens = preset.tokens[mode] ?? preset.tokens[preset.modes[0]] ?? {};
  applyTokens(root, `${preset.id}:${mode}`, tokens);
}
