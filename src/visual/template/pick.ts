import type { Template } from "./schema";

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function pickTemplate(trackKey: string, pool: Template[], hasWordTiming: boolean): Template {
  const usable = pool.filter((template) => hasWordTiming || template.liveSafe).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (usable.length === 0) throw new Error("no template can play this track");
  return usable[fnv1a(trackKey) % usable.length];
}
