import type { NetCheck } from "../ports/system";

export type Advice = "offline" | "proxy_failed" | "blocked" | "refused" | "tls_intercepted" | "clock";

const AS_IS: ReadonlySet<string> = new Set(["offline", "proxy_failed", "tls_intercepted", "clock"]);
const UNREACHABLE: ReadonlySet<string> = new Set(["blocked", "dns_failed", "timeout"]);

// YouTube passing the check while streams fail means this address is refused (flagged VPN exit)
export function adviceFor(check: NetCheck, cause: string | null): Advice | null {
  const code = check.code ?? "";
  if (AS_IS.has(code)) return code as Advice;
  if (check.service === "YouTube" && UNREACHABLE.has(code)) return "blocked";
  return cause === "http_403" || cause === "blocked" ? "refused" : null;
}

export function checkHeadline(check: NetCheck): { key: string; vars?: Record<string, string> } {
  const advice = adviceFor(check, null);
  if (advice) return { key: `ui.network_advice.${advice}` };
  if (check.code && check.service) return { key: "ui.settings.check_service", vars: { service: check.service } };
  return { key: "ui.settings.check_clear" };
}
