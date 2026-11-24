import { coverKey } from "./components/coverUrl";
import { reducedEffectsNow } from "./effects";
import { DURATION_MS, EASE, SPRING } from "./motion";

export const COVER = "[data-cover]";
const PRESSABLE = "a, button, [role=button], [role=row], [data-flip]";
const FRESH_MS = 700;
const SEARCH_FRAMES = 24;
const SMALLEST_PX = 36;
const HERO_PX = 120;
const PAINT_MS = 600;
const REVEAL_AT = 0.65;
const REVEAL_RISE_PX = 6;

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
  back: boolean;
}

interface Flight {
  key: string;
  ghost: HTMLElement;
  target: HTMLElement;
  cancel(): void;
}

let departure: Departure | null = null;
let flight: Flight | null = null;
let landed: HTMLElement | null = null;
let search = 0;

const keyOf = (cover: HTMLElement) => coverKey(cover.dataset.cover ?? "");

const inView = (box: Box) => box.width >= SMALLEST_PX && box.top < window.innerHeight && box.top + box.height > 0;

const painted = (cover: HTMLElement) => {
  const image = cover.querySelector("img");
  return image !== null && image.complete && image.naturalWidth > 0;
};

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

// the outermost frame drawn at the cover's own size, so a placeholder behind it hides with it
function slotOf(cover: HTMLElement): HTMLElement {
  let slot = cover;
  for (
    let frame = cover.parentElement;
    frame && frame.offsetWidth === cover.offsetWidth && frame.offsetHeight === cover.offsetHeight;
    frame = frame.parentElement
  )
    slot = frame;
  return slot;
}

export function depart(cover: HTMLElement | null | undefined, back = false): Departure | null {
  const key = cover ? keyOf(cover) : "";
  const box = cover?.getBoundingClientRect();
  if (!cover || !box || !key || !inView(box) || !painted(cover)) return null;
  // a cover still in the air leaves from where it is
  const from = flight?.key === key ? flight.ghost.getBoundingClientRect() : box;
  const art = cover.cloneNode(true) as HTMLElement;
  return { key, box: { left: from.left, top: from.top, width: from.width, height: from.height }, art, at: performance.now(), back };
}

interface Landing {
  target: HTMLElement;
  box?: Box;
  layer?: string;
  reveal?: boolean;
}

export function fly(from: Departure, { target, box = restingBox(target), layer = "45", reveal = false }: Landing): void {
  flight?.cancel();
  if (reducedEffectsNow()) return;
  const slot = slotOf(target);
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
    borderRadius: getComputedStyle(slot).borderRadius,
    transformOrigin: "0 0",
    pointerEvents: "none",
  });
  document.body.append(ghost);

  const duration = DURATION_MS.page;
  const start = `translate(${from.box.left - box.left}px, ${from.box.top - box.top}px) scale(${from.box.width / box.width}, ${from.box.height / box.height})`;
  const move = ghost.animate([{ transform: start }, { transform: "none" }], { duration, easing: SPRING, fill: "forwards" });
  const hide = slot.animate([{ opacity: 0 }, { opacity: 0 }], { duration: duration + PAINT_MS });
  const around = reveal ? [...(slot.parentElement?.children ?? [])].filter((node) => node !== slot) : [];
  const rising = around.map((node) =>
    node.animate([{ opacity: 0, transform: `translateY(${REVEAL_RISE_PX}px)` }], {
      delay: duration * REVEAL_AT,
      duration: duration * (1 - REVEAL_AT),
      easing: `cubic-bezier(${EASE.out.join(", ")})`,
      fill: "backwards",
    }),
  );

  let timer = 0;
  const cancel = () => {
    window.clearTimeout(timer);
    window.removeEventListener("wheel", cancel, true);
    target.removeEventListener("load", cancel, true);
    for (const animation of [move, hide, ...rising]) animation.cancel();
    ghost.remove();
    if (flight?.ghost === ghost) flight = null;
  };
  // a cover that has not loaded yet keeps the one that flew, for a moment
  move.onfinish = () => {
    if (painted(target)) return cancel();
    target.addEventListener("load", cancel, true);
    timer = window.setTimeout(cancel, PAINT_MS);
  };
  window.addEventListener("wheel", cancel, { capture: true, passive: true });
  landed = target;
  flight = { key: from.key, ghost, target, cancel };
}

function landing(from: Departure): HTMLElement | null {
  const same = [...document.querySelectorAll<HTMLElement>(`[data-page] ${COVER}`)].filter(
    (cover) => keyOf(cover) === from.key && inView(cover.getBoundingClientRect()),
  );
  return same.reduce<HTMLElement | null>((best, cover) => (best && best.offsetWidth >= cover.offsetWidth ? best : cover), null);
}

const PLAYER = "[data-phase]";

// the view rises with the cover in it, so its resting place is read inside the view
export function flyToPlayer(open: boolean): void {
  const bar = document.querySelector<HTMLElement>(`[data-island] ${COVER}`);
  const stage = [...document.querySelectorAll<HTMLElement>(`${PLAYER} ${COVER}`)].at(-1);
  const view = stage?.closest(PLAYER)?.getBoundingClientRect();
  if (!bar || !stage || !view || !stage.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return;
  const from = depart(open ? bar : stage);
  if (!from) return;
  const box = stage.getBoundingClientRect();
  if (open)
    fly(from, { target: stage, box: { left: box.left - view.left, top: box.top - view.top, width: box.width, height: box.height }, layer: "75", reveal: true });
  else fly(from, { target: bar, box: bar.getBoundingClientRect(), layer: "75" });
}

export function arrive(): void {
  cancelAnimationFrame(search);
  const from = departure;
  departure = null;
  if (flight && !flight.target.isConnected) flight.cancel();
  if (!from || performance.now() - from.at > FRESH_MS || reducedEffectsNow()) return;
  let frames = 0;
  const look = () => {
    const target = landing(from);
    if (target) fly(from, { target, reveal: !from.back && target.offsetWidth >= HERO_PX });
    else if (++frames < SEARCH_FRAMES) search = requestAnimationFrame(look);
  };
  look();
}

export function watchDepartures(): () => void {
  const onClick = (event: MouseEvent) => {
    const pressed = event.target instanceof Element ? event.target.closest(PRESSABLE) : null;
    departure = depart(pressed?.querySelector<HTMLElement>(COVER));
  };
  // popstate comes after the router has drawn the page, so a step back is read from the event before it
  const onTraverse = (event: Event) => {
    if ((event as Event & { navigationType?: string }).navigationType !== "traverse") return;
    departure = landed?.isConnected ? depart(landed, true) : null;
  };
  const entries = (window as { navigation?: EventTarget }).navigation;
  window.addEventListener("click", onClick, true);
  entries?.addEventListener("navigate", onTraverse);
  return () => {
    window.removeEventListener("click", onClick, true);
    entries?.removeEventListener("navigate", onTraverse);
  };
}
