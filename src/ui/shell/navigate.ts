import { flushSync } from "react-dom";
import type { NavigateFunction } from "react-router-dom";
import { reducedEffectsNow } from "../effects";
import { DURATION_MS, EASE } from "../motion";

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

// Animates the live page rather than a view transition: a page snapshot paints above the player and hides its glass
const PAGE_IN: Keyframe[] = [
  { opacity: 0, transform: "translateY(12px)" },
  { opacity: 1, transform: "none" },
];

export function navigateWithTransition(navigate: NavigateFunction, to: string): void {
  flushSync(() => void navigate(to));
  if (reducedEffectsNow()) return;
  document.querySelector<HTMLElement>("[data-page]")?.animate?.(PAGE_IN, { duration: DURATION_MS.page, easing: `cubic-bezier(${EASE.out.join(", ")})` });
}
