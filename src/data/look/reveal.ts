import { flushSync } from "react-dom";

// motion.css times the root cross-fade while this is set
const SWITCH_ATTRIBUTE = "data-theme-switch";

export function revealThemeChange(apply: () => void): void {
  if (typeof document.startViewTransition !== "function") {
    apply();
    return;
  }
  const root = document.documentElement;
  root.setAttribute(SWITCH_ATTRIBUTE, "");
  // the new snapshot is taken when the callback returns, so the new tokens must already be on the root
  const transition = document.startViewTransition(() => flushSync(apply));
  void transition.finished.finally(() => root.removeAttribute(SWITCH_ATTRIBUTE));
}
