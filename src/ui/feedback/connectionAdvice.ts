import type { NetCheck } from "../ports/system";

export type Advice = "offline" | "proxy_failed" | "blocked" | "refused" | "tls_intercepted" | "clock";

const AS_IS: ReadonlySet<string> = new Set(["offline", "proxy_failed", "tls_intercepted", "clock"]);
const UNREACHABLE: ReadonlySet<string> = new Set(["blocked", "dns_failed", "timeout"]);

/**
 * The one thing to tell the user. The check reaches hosts; `cause` is what playback saw. YouTube answering the check
 * while its streams fail means this address is refused (a flagged VPN exit), not that the site is blocked.
 */
export function adviceFor(check: NetCheck, cause: string | null): Advice | null {
  const code = check.code ?? "";
  if (AS_IS.has(code)) return code as Advice;
  if (check.service === "YouTube" && UNREACHABLE.has(code)) return "blocked";
  return cause === "http_403" || cause === "blocked" ? "refused" : null;
}

/** The check's result in one sentence of the user's language: what is wrong and what to do, or that all is well. */
export function checkHeadline(check: NetCheck): { key: string; vars?: Record<string, string> } {
  const advice = adviceFor(check, null);
  if (advice) return { key: `ui.network_advice.${advice}` };
  if (check.code && check.service) return { key: "ui.settings.check_service", vars: { service: check.service } };
  return { key: "ui.settings.check_clear" };
}
