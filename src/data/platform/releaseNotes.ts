import changelog from "../../../CHANGELOG.md?raw";

export function notesFor(version: string, text: string = changelog): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  const body = lines.slice(start + 1, end < 0 ? undefined : end);
  while (body.length > 0 && !body[0].trim()) body.shift();
  while (body.length > 0 && !body[body.length - 1].trim()) body.pop();
  return body;
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
