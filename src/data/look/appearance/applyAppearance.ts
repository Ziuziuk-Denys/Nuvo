import type { FontChoice, FontFileEntry, FontSettings } from "@/data/look/appearanceContracts";

export function cssFamily(name: string): string {
  return `"${name.replace(/["\\]/g, (c) => `\\${c}`)}"`;
}

export const userFontFamily = (id: string) => `nuvo-user-${id.slice(0, 8)}`;

export function familyValue(choice: FontChoice, loaded: ReadonlySet<string>): string | null {
  if (choice.kind === "system") return `${cssFamily(choice.family)}, var(--n-font-stack)`;
  if (choice.kind === "file" && loaded.has(choice.id)) return `${cssFamily(userFontFamily(choice.id))}, var(--n-font-stack)`;
  return null;
}

// Custom properties only: a family name is never concatenated into a stylesheet
export function applyFontSettings(root: HTMLElement, fonts: FontSettings, loaded: ReadonlySet<string>): void {
  const set = (name: string, value: string | null) => (value === null ? root.style.removeProperty(name) : root.style.setProperty(name, value));
  const ui = familyValue(fonts.ui, loaded);
  set("--n-font-ui", ui);
  // the legacy screens read --font-inter
  set("--font-inter", ui);
  set("--n-font-lyrics", familyValue(fonts.lyrics, loaded));
  set("--n-scale", fonts.uiScale === 1 ? null : String(fonts.uiScale));
  set("--n-lyrics-scale", fonts.lyricsScale === 1 ? null : String(fonts.lyricsScale));
}

const loadedFaces = new Map<string, FontFace>();

export async function loadUserFont(file: FontFileEntry): Promise<boolean> {
  if (loadedFaces.has(file.id)) return true;
  try {
    const face = new FontFace(userFontFamily(file.id), `url(nuvo-core://local/fonts/${file.id})`);
    document.fonts.add(await face.load());
    loadedFaces.set(file.id, face);
    return true;
  } catch {
    return false;
  }
}

export function dropUserFonts(keep: ReadonlySet<string>): void {
  for (const [id, face] of loadedFaces) {
    if (keep.has(id)) continue;
    document.fonts.delete(face);
    loadedFaces.delete(id);
  }
}
