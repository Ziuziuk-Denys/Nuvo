import type { TFunction } from "../../ports/i18n";
import type { Session } from "../../ports/recognize";

const ERRORS = new Set(["no_capture", "network", "busy", "tool_missing", "decode_failed", "unavailable", "unsupported", "core_down", "locked"]);
const LINK_ERRORS = new Set([
  "invalid_link",
  "unsupported",
  "unavailable",
  "login_required",
  "age_gated",
  "drm",
  "blocked",
  "throttled",
  "tool_missing",
  "decode_failed",
  "proxy_unsupported",
]);

export function recognizeText(session: Exclude<Session, { phase: "found" }>, reachable: boolean, t: TFunction): { title: string; line: string } {
  if (session.phase === "listening") {
    if (session.step === "wait") return { title: t("ui.recognize.waiting_title"), line: t("ui.recognize.waiting", { seconds: session.seconds }) };
    if (session.step === "check") {
      const title = t("ui.recognize.checking_title");
      const part = t("ui.recognize.checking", { attempt: session.attempt, of: session.of });
      return { title, line: session.voiceRemoved ? `${part} · ${t("ui.recognize.voice_removed")}` : part };
    }
    if (session.input === "file") return { title: t("ui.recognize.reading_title"), line: session.detail ?? "" };
    if (session.input === "link") return { title: t("ui.recognize.reading_link_title"), line: session.detail ?? "" };
    return { title: t("ui.recognize.listening_title"), line: t(`ui.recognize.listening_${session.input}`) };
  }
  if (session.phase === "not_found") return { title: t("ui.recognize.none_title"), line: t("ui.recognize.none") };
  if (session.phase === "failed") {
    if (session.code === "no_capture") {
      const device = session.input === "system" ? "system" : "microphone";
      return { title: t(`ui.recognize.no_access_title_${device}`), line: t(`ui.recognize.no_access_${device}`) };
    }
    if (session.code === "network" && !reachable) return offline(t);
    if (session.input === "link" && LINK_ERRORS.has(session.code))
      return { title: t("ui.recognize.failed_title"), line: t(`ui.recognize.error_link.${session.code}`) };
    const code = ERRORS.has(session.code) ? session.code : "failed";
    return { title: t("ui.recognize.failed_title"), line: t(`ui.recognize.error.${code}`) };
  }
  return reachable ? { title: t("ui.recognize.idle_title"), line: t("ui.recognize.idle") } : offline(t);
}

function offline(t: TFunction): { title: string; line: string } {
  return { title: t("ui.recognize.offline_title"), line: t("ui.recognize.offline") };
}
