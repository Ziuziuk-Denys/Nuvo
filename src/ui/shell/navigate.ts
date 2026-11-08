import { flushSync } from "react-dom";
import type { NavigateFunction } from "react-router-dom";
import { reducedEffectsNow } from "../effects";

/** Pages that open from a list and show back and forward in the top bar. */
export const ENTITY_ROUTES = ["/library/playlist", "/artist", "/collection", "/stats/track", "/stats/artist"];

export type NavItem = "home" | "library" | "search" | "recognize" | "stats";

export function isEntityRoute(pathname: string): boolean {
  return ENTITY_ROUTES.includes(pathname);
}

export function activeNav(pathname: string): NavItem | null {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/stats")) return "stats";
  if (pathname === "/library" || isEntityRoute(pathname)) return "library";
  if (pathname === "/search") return "search";
  if (pathname === "/recognize") return "recognize";
  return null;
}

/**
 * The content column takes view-transition-name n-page only while this attribute is on the root,
 * so the theme reveal (a root view transition) keeps revealing the page with the rest of the window.
 */
const PAGE_TRANSITION_ATTRIBUTE = "data-page-transition";
let running = 0;

/** In-app navigation: the old page fades out and the new one rises in, unless motion or effects are reduced. */
export function navigateWithTransition(navigate: NavigateFunction, to: string): void {
  if (typeof document.startViewTransition !== "function" || reducedEffectsNow()) {
    void navigate(to);
    return;
  }
  const root = document.documentElement;
  root.setAttribute(PAGE_TRANSITION_ATTRIBUTE, "");
  running += 1;
  const transition = document.startViewTransition(() => flushSync(() => void navigate(to)));
  void transition.finished.finally(() => {
    running -= 1;
    if (running === 0) root.removeAttribute(PAGE_TRANSITION_ATTRIBUTE);
  });
}
