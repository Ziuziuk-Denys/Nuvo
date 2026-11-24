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

let boundNavigate: NavigateFunction | null = null;

export function bindNavigate(navigate: NavigateFunction): void {
  boundNavigate = navigate;
}

export function goTo(href: string): void {
  if (boundNavigate) navigateWithTransition(boundNavigate, href);
}

// Animates the live page rather than a view transition: a page snapshot paints above the player and hides its glass
const PAGE_IN: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

export function navigateWithTransition(navigate: NavigateFunction, to: string): void {
  flushSync(() => void navigate(to));
  if (reducedEffectsNow()) return;
  document.querySelector<HTMLElement>("[data-page]")?.animate?.(PAGE_IN, { duration: DURATION_MS.quick, easing: `cubic-bezier(${EASE.out.join(", ")})` });
}
