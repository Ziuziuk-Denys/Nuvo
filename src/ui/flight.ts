import { coverKey } from "./components/coverUrl";
import { reducedEffectsNow } from "./effects";
import { DURATION_MS, SPRING } from "./motion";

export const COVER = "[data-cover]";
const HERO = "[data-hero-cover]";
const PRESSABLE = "a, button, [role=button], [role=row], [data-flip]";
const FRESH_MS = 700;
const SEARCH_FRAMES = 24;
const SMALLEST_PX = 36;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Departure {
  key: string;
  box: Box;
  art: HTMLElement;
  at: number;
}

interface Flight {
  key: string;
  ghost: HTMLElement;
  cancel(): void;
}

let departure: Departure | null = null;
let flight: Flight | null = null;
let search = 0;

const keyOf = (cover: HTMLElement) => coverKey(cover.dataset.cover ?? "");

const inView = (box: Box) => box.width >= SMALLEST_PX && box.top < window.innerHeight && box.top + box.height > 0;

// a page still rising in is measured where it will rest
function restingBox(cover: HTMLElement): Box {
  const { left, top, width, height } = cover.getBoundingClientRect();
  let x = 0;
  let y = 0;
  for (let node: HTMLElement | null = cover; node; node = node.parentElement) {
    if (!node.getAnimations().some((animation) => animation.playState === "running")) continue;
    const shift = new DOMMatrixReadOnly(getComputedStyle(node).transform);
    x += shift.e;
    y += shift.f;
  }
  return { left: left - x, top: top - y, width, height };
}

export function depart(cover: HTMLElement | null | undefined): Departure | null {
  const key = cover ? keyOf(cover) : "";
  const box = cover?.getBoundingClientRect();
  if (!cover || !box || !key || !inView(box)) return null;
  // a cover still in the air leaves from where it is
  const from = flight?.key === key ? flight.ghost.getBoundingClientRect() : box;
  const art = cover.cloneNode(true) as HTMLElement;
  return { key, box: { left: from.left, top: from.top, width: from.width, height: from.height }, art, at: performance.now() };
}

export function fly(from: Departure, target: HTMLElement, box: Box = restingBox(target), layer = "45"): void {
  flight?.cancel();
  if (reducedEffectsNow()) return;
  const ghost = from.art;
  ghost.removeAttribute("data-cover");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    zIndex: layer,
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    borderRadius: getComputedStyle(target).borderRadius,
    transformOrigin: "0 0",
    pointerEvents: "none",
  });
  document.body.append(ghost);
  const options = { duration: DURATION_MS.page, easing: SPRING };
  const start = `translate(${from.box.left - box.left}px, ${from.box.top - box.top}px) scale(${from.box.width / box.width}, ${from.box.height / box.height})`;
  const move = ghost.animate([{ transform: start }, { transform: "none" }], options);
  const hide = target.animate([{ opacity: 0 }, { opacity: 0 }], options);
  const current: Flight = {
    key: from.key,
    ghost,
    cancel() {
      move.cancel();
      hide.cancel();
      ghost.remove();
      if (flight === current) flight = null;
    },
  };
  move.onfinish = current.cancel;
  flight = current;
}

function landing(from: Departure): HTMLElement | null {
  const same = [...document.querySelectorAll<HTMLElement>(`[data-page] ${COVER}`)].filter(
    (cover) => keyOf(cover) === from.key && inView(cover.getBoundingClientRect()),
  );
  const hero = same.find((cover) => cover.closest(HERO));
  return hero ?? same.reduce<HTMLElement | null>((best, cover) => (best && best.offsetWidth >= cover.offsetWidth ? best : cover), null);
}

const PLAYER = "[data-phase]";

// the view rises with the cover in it, so its resting place is read inside the view
export function flyToPlayer(open: boolean): void {
  const bar = document.querySelector<HTMLElement>(`[data-island] ${COVER}`);
  const stage = document.querySelector<HTMLElement>(`${PLAYER} ${COVER}`);
  const view = stage?.closest(PLAYER)?.getBoundingClientRect();
  if (!bar || !stage || !view || !stage.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return;
  const from = depart(open ? bar : stage);
  if (!from) return;
  const box = stage.getBoundingClientRect();
  if (open) fly(from, stage, { left: box.left - view.left, top: box.top - view.top, width: box.width, height: box.height }, "75");
  else fly(from, bar, bar.getBoundingClientRect(), "75");
}

export function arrive(): void {
  cancelAnimationFrame(search);
  const from = departure;
  departure = null;
  if (!from || performance.now() - from.at > FRESH_MS || reducedEffectsNow()) return;
  let frames = 0;
  const look = () => {
    const target = landing(from);
    if (target) fly(from, target);
    else if (++frames < SEARCH_FRAMES) search = requestAnimationFrame(look);
  };
  look();
}

export function watchDepartures(): () => void {
  const onClick = (event: MouseEvent) => {
    const pressed = event.target instanceof Element ? event.target.closest(PRESSABLE) : null;
    departure = depart(pressed?.querySelector<HTMLElement>(COVER));
  };
  const onPop = () => {
    departure = depart(document.querySelector<HTMLElement>(`[data-page] ${HERO} ${COVER}`));
  };
  window.addEventListener("click", onClick, true);
  window.addEventListener("popstate", onPop, true);
  return () => {
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("popstate", onPop, true);
  };
}
