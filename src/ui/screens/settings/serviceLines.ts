import type { TFunction } from "../../ports/i18n";
import type { ServiceCheck } from "../../ports/system";

const NAMED: Record<string, string> = { Lyrics: "lyrics", Recognition: "recognition", Tools: "tools", Updates: "updates" };

export function serviceName(service: string, t: TFunction): string {
  const key = NAMED[service];
  return key ? t(`ui.settings.service.${key}`) : service;
}

export interface ServiceLine {
  name: string;
  status: string;
  advice: string | null;
}

/** Advice names no service: it sits under the service's own line. Offline needs none, the headline says it. */
export function serviceLine(check: ServiceCheck, proxied: boolean, t: TFunction): ServiceLine {
  const timed = check.state === "works" || check.state === "slow";
  const quiet = check.state === "works" || check.state === "offline";
  const adviceKey = check.state === "blocked" && proxied ? "blocked_proxied" : check.state;
  return {
    name: serviceName(check.service, t),
    status: t(`ui.settings.service_state.${check.state}`, timed ? { ms: check.ms } : undefined),
    advice: quiet ? null : t(`ui.settings.service_advice.${adviceKey}`),
  };
}

/** Lines with the same advice in a row share it once, after the last of them. */
export function serviceLines(checks: ServiceCheck[], proxied: boolean, t: TFunction): ServiceLine[] {
  const lines = checks.map((check) => serviceLine(check, proxied, t));
  return lines.map((line, index) => (line.advice && lines[index + 1]?.advice === line.advice ? { ...line, advice: null } : line));
}
