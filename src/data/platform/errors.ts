import { log } from "./log";

/** Chromium reports this when a resize observer settles late; it is not an app error. */
const BENIGN = /ResizeObserver loop/;

/** Logs uncaught errors and unhandled rejections. Returns the uninstall. */
export function installErrorHandlers(target: Window = window): () => void {
  const onError = (event: ErrorEvent) => {
    const message = event.message || String(event.error);
    if (BENIGN.test(message)) return;
    log("error", "window", message, event.error);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    log("error", "window", reason instanceof Error ? reason.message : String(reason), reason);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
