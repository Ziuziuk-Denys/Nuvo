/** A small in-memory log for the error screen's "Copy details". */
export type LogLevel = "error" | "warn" | "info";

interface LogEntry {
  at: string;
  level: LogLevel;
  scope: string;
  message: string;
}

export const LOG_LIMIT = 200;
const entries: LogEntry[] = [];

export function log(level: LogLevel, scope: string, message: string, ...details: unknown[]): void {
  entries.push({ at: new Date().toISOString(), level, scope, message });
  if (entries.length > LOG_LIMIT) entries.splice(0, entries.length - LOG_LIMIT);
  if (level === "error") console.error(`[${scope}] ${message}`, ...details);
  else if (level === "warn") console.warn(`[${scope}] ${message}`, ...details);
}

export function recentLog(): string[] {
  return entries.map((entry) => `${entry.at} ${entry.level} ${entry.scope} ${entry.message}`);
}

export function clearLog(): void {
  entries.length = 0;
}
