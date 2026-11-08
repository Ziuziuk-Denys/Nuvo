/** The bug report as plain text. The core section arrives redacted; this module scrubs it once more and adds no paths, tokens, titles or the proxy address. */
export interface AppFacts {
  version: string;
  platform: string;
  packaged: boolean;
  compositor: string;
}

// Only these fields of the core section are printed, at any depth. A field the daemon adds later stays out until it is listed here.
const KNOWN_FIELDS = new Set([
  "version",
  "uptimeSecs",
  "phase",
  "locked",
  "schemaVersion",
  "dbBytes",
  "cache",
  "usedBytes",
  "limitBytes",
  "entries",
  "pinned",
  "covers",
  "bytes",
  "count",
  "deps",
  "checkedAt",
  "tools",
  "name",
  "path",
  "status",
  "neededBy",
  "networkCheck",
  "rows",
  "summary",
  "code",
  "service",
  "check",
  "host",
  "ok",
  "ms",
  "detail",
]);

function keepKnown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(keepKnown);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => KNOWN_FIELDS.has(key))
        .map(([key, inner]) => [key, keepKnown(inner)]),
    );
  }
  return value;
}

const SECRET_PARAM = /(^|[?&;\s])([a-z0-9_.-]*(?:token|key|secret|session|auth|sig)[a-z0-9_.-]*)=[^\s&;"'#]*/gi;

/** Free text from logs: credentials, secret parameters, home paths and what was playing go. */
function scrubText(text: string): string {
  return text
    .replace(/((?:proxy-)?authorization|set-cookie|cookie)(["']?\s*[:=]\s*)[^\r\n]*/gi, "$1: <redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/(now[ _-]?playing["']?\s*[:=]?\s*)[^\r\n]*/gi, "$1<redacted>")
    .replace(/(\b(?:title|artist|album|track)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n,;&}]*)/gi, "$1<redacted>")
    .replace(SECRET_PARAM, "$1$2=<redacted>")
    .replace(/\/(?:run\/)?media\/[^/\s"'\\]+/g, "~")
    .replace(/\/(?:home|Users)\/[^/\s"'\\]+/g, "~")
    .replace(/[A-Za-z]:\\{1,2}Users\\{1,2}[^\\/\s"']+/g, "~")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/"'?#]*@/gi, "$1")
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s"'?#]*)[?#][^\s"']*/gi, "$1");
}

export function formatReport(app: AppFacts | null, daemon: unknown, now: Date): string {
  const lines = [`Nuvo bug report, ${now.toISOString()}`, "", "App"];
  if (app) lines.push(`  version ${app.version}`, `  platform ${app.platform}`, `  packaged ${app.packaged}`, `  compositor ${app.compositor}`);
  else lines.push("  not running in the desktop shell");
  lines.push("", "Core");
  if (daemon === null) {
    lines.push("  did not answer");
  } else {
    // the log goes out as plain lines, so a header or a title is scrubbed on its own line
    lines.push(JSON.stringify(keepKnown(daemon), null, 2));
    const text = typeof (daemon as { log?: unknown }).log === "string" ? (daemon as { log: string }).log : "";
    if (text !== "") lines.push("", "Log", ...text.split("\n").map((line) => `  ${line}`));
  }
  return scrubText(lines.join("\n"));
}

export const ISSUES_URL = "https://github.com/Ziuziuk-Denys/nuvo/issues/new";
/** Browsers and GitHub refuse much longer links; the diagnostics are cut to fit. */
const MAX_URL = 7500;

/** The issue text the browser opens: what happened, then the version and system, then the reviewed diagnostics if chosen. */
export function issueBody(version: string, system: string, diagnostics: string | null): string {
  const lines = ["**What happened**", "", "", "**Steps to see it again**", "", "", "---", `Nuvo ${version} on ${system}`];
  if (diagnostics) lines.push("", "<details><summary>Diagnostics</summary>", "", "```text", diagnostics, "```", "", "</details>");
  return lines.join("\n");
}

export function issueUrl(version: string, system: string, diagnostics: string | null): string {
  const link = (text: string | null) => `${ISSUES_URL}?${new URLSearchParams({ body: issueBody(version, system, text) })}`;
  let text = diagnostics;
  while (text && link(text).length > MAX_URL) text = `${text.slice(0, Math.floor(text.length * 0.8))}\n…`;
  return link(text);
}
