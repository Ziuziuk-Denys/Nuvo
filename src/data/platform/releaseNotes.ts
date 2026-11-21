import changelog from "../../../CHANGELOG.md?raw";

const TRANSLATION_HEADINGS: Record<string, string> = { ru: "### По-русски" };

function trimmed(lines: string[]): string[] {
  const body = [...lines];
  while (body.length > 0 && !body[0].trim()) body.shift();
  while (body.length > 0 && !body[body.length - 1].trim()) body.pop();
  return body;
}

function until(lines: string[], from: number, prefix: string): string[] {
  const end = lines.findIndex((line, index) => index > from && line.startsWith(prefix));
  return lines.slice(from + 1, end < 0 ? undefined : end);
}

export function notesFor(version: string, locale: string = "en", text: string = changelog): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start < 0) return [];
  const section = until(lines, start, "## ");
  const heading = TRANSLATION_HEADINGS[locale];
  const translated = heading ? section.findIndex((line) => line.trim() === heading) : -1;
  if (translated >= 0) {
    const notes = trimmed(until(section, translated, "### "));
    if (notes.length > 0) return notes;
  }
  return trimmed(until(section, -1, "### "));
}

const SEEN_KEY = "nuvo.whatsNewSeen";

export function takeWhatsNew(version: string, hasNotes: boolean): boolean {
  try {
    const seen = localStorage.getItem(SEEN_KEY);
    localStorage.setItem(SEEN_KEY, version);
    return seen !== null && seen !== version && hasNotes;
  } catch {
    return false;
  }
}
