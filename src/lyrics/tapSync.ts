export interface SyncLine {
  text: string;
  atMs: number | null;
}

export function detectFormat(text: string): "lrc" | "plain" {
  return /^\s*\[\d+:\d{2}/m.test(text) ? "lrc" : "plain";
}

export function startSync(plain: string): SyncLine[] {
  return plain
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((text) => ({ text, atMs: null }));
}

const withStamp = (lines: SyncLine[], index: number, atMs: number | null) => lines.map((line, at) => (at === index ? { ...line, atMs } : line));

export function stamp(lines: SyncLine[], index: number, atMs: number): { lines: SyncLine[]; next: number } {
  if (index < 0 || index >= lines.length) return { lines, next: index };
  return { lines: withStamp(lines, index, Math.max(0, Math.round(atMs))), next: index + 1 };
}

export function markEnd(lines: SyncLine[], after: number, atMs: number): { lines: SyncLine[]; next: number } {
  if (after < 0 || after >= lines.length || lines[after].atMs === null) return { lines, next: after + 1 };
  const next = [...lines];
  next.splice(after + 1, 0, { text: "", atMs: Math.max(0, Math.round(atMs)) });
  return { lines: next, next: after + 2 };
}

export function nudge(lines: SyncLine[], index: number, deltaMs: number): SyncLine[] {
  const line = lines[index];
  if (!line || line.atMs === null) return lines;
  return withStamp(lines, index, Math.max(0, line.atMs + deltaMs));
}

export function clearStamp(lines: SyncLine[], index: number): SyncLine[] {
  return lines[index] ? withStamp(lines, index, null) : lines;
}

export function isComplete(lines: SyncLine[]): boolean {
  return lines.length > 0 && lines.every((line) => line.atMs !== null);
}

const pad = (value: number) => String(value).padStart(2, "0");

export function formatStamp(ms: number): string {
  const hundredths = Math.floor(ms / 10);
  return `[${pad(Math.floor(hundredths / 6000))}:${pad(Math.floor((hundredths % 6000) / 100))}.${pad(hundredths % 100)}]`;
}

export function toLrc(lines: SyncLine[]): string {
  return lines
    .filter((line) => line.atMs !== null)
    .map((line) => `${formatStamp(line.atMs!)}${line.text ? ` ${line.text}` : ""}`)
    .join("\n");
}
