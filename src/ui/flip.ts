import { Component, type ReactNode, type RefObject } from "react";
import { reducedEffectsNow } from "./effects";
import { DURATION_MS, EASE, ENTRANCE_SCALE } from "./motion";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlipPlan {
  moves: { key: string; dx: number; dy: number }[];
  enters: string[];
  exits: string[];
}

interface Snapshot {
  boxes: Map<string, Box>;
  nodes: Map<string, HTMLElement>;
}

export const MAX_ANIMATED = 120;
const FLIP_ID = "n-flip";
const SWAP_RISE_PX = 8;
const easeOut = `cubic-bezier(${EASE.out.join(", ")})`;
const easeIn = `cubic-bezier(${EASE.in.join(", ")})`;

export function planFlip(before: Map<string, Box>, after: Map<string, Box>, view: { top: number; bottom: number }): FlipPlan | null {
  const seen = (box: Box) => box.y + box.height > view.top && box.y < view.bottom;
  const far = view.bottom - view.top;
  const plan: FlipPlan = { moves: [], enters: [], exits: [] };
  for (const [key, box] of after) {
    const old = before.get(key);
    if (old && Math.abs(old.y - box.y) <= far && (seen(old) || seen(box))) {
      const dx = old.x - box.x;
      const dy = old.y - box.y;
      if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) plan.moves.push({ key, dx, dy });
    } else if (seen(box)) plan.enters.push(key);
  }
  for (const [key, old] of before) {
    const now = after.get(key);
    if (seen(old) && (!now || (Math.abs(old.y - now.y) > far && !seen(now)))) plan.exits.push(key);
  }
  return plan.moves.length + plan.enters.length + plan.exits.length > MAX_ANIMATED ? null : plan;
}

function measure(container: HTMLElement): Snapshot {
  const origin = container.getBoundingClientRect();
  const boxes = new Map<string, Box>();
  const nodes = new Map<string, HTMLElement>();
  for (const node of container.querySelectorAll<HTMLElement>("[data-flip]")) {
    if (node.dataset.flipGhost !== undefined) continue;
    const key = node.dataset.flip ?? "";
    const rect = node.getBoundingClientRect();
    boxes.set(key, { x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height });
    nodes.set(key, node);
  }
  return { boxes, nodes };
}

function settle(container: HTMLElement): void {
  for (const node of container.querySelectorAll<HTMLElement>("[data-flip]")) {
    for (const animation of node.getAnimations()) {
      if (animation.id === FLIP_ID) animation.cancel();
      else if (animation instanceof CSSTransition) animation.finish();
    }
  }
}

function ghost(container: HTMLElement, node: HTMLElement, box: Box): void {
  const copy = node.cloneNode(true) as HTMLElement;
  copy.dataset.flipGhost = "";
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  Object.assign(copy.style, {
    position: "absolute",
    top: `${box.y}px`,
    left: `${box.x}px`,
    width: `${box.width}px`,
    margin: "0",
    transform: "none",
    pointerEvents: "none",
  });
  container.append(copy);
  const fade = copy.animate([{ opacity: 1 }, { opacity: 0, transform: `scale(${ENTRANCE_SCALE})` }], { duration: DURATION_MS.quick, easing: easeIn });
  fade.onfinish = () => copy.remove();
  fade.oncancel = () => copy.remove();
}

function play(container: HTMLElement, before: Snapshot, scroller: HTMLElement | null): void {
  settle(container);
  const after = measure(container);
  const origin = container.getBoundingClientRect();
  const frame = scroller?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
  const plan = planFlip(before.boxes, after.boxes, { top: frame.top - origin.top, bottom: frame.bottom - origin.top });
  if (!plan) return;
  const options = { duration: DURATION_MS.base, easing: easeOut, id: FLIP_ID };
  for (const { key, dx, dy } of plan.moves) {
    // added on top of the slot's own translateY, so virtual rows keep their place
    after.nodes.get(key)?.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { ...options, composite: "add" });
  }
  for (const key of plan.enters) {
    const node = after.nodes.get(key);
    node?.animate([{ opacity: 0 }, { opacity: 1 }], options);
    node?.animate([{ transform: `scale(${ENTRANCE_SCALE})` }, { transform: "scale(1)" }], { ...options, composite: "add" });
  }
  for (const key of plan.exits) {
    const node = before.nodes.get(key);
    const box = before.boxes.get(key);
    if (node && box) ghost(container, node, box);
  }
}

interface FlipProps {
  token: unknown;
  target: RefObject<HTMLElement | null>;
  scroller: RefObject<HTMLElement | null>;
  children: ReactNode;
}

// a class: only getSnapshotBeforeUpdate reads the old positions before React moves the DOM
export class Flip extends Component<FlipProps, object, Snapshot | null> {
  getSnapshotBeforeUpdate(previous: FlipProps): Snapshot | null {
    const node = this.props.target.current;
    if (previous.token === this.props.token || !node || typeof node.animate !== "function" || reducedEffectsNow()) return null;
    return measure(node);
  }

  componentDidUpdate(_previous: FlipProps, _state: object, snapshot: Snapshot | null): void {
    const node = this.props.target.current;
    if (snapshot && node) play(node, snapshot, this.props.scroller.current);
  }

  render(): ReactNode {
    return this.props.children;
  }
}

interface Leaving {
  node: HTMLElement;
  top: number;
  left: number;
  width: number;
  height: number;
}

interface SwapProps {
  view: string;
  target: RefObject<HTMLElement | null>;
  scroller: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export class Swap extends Component<SwapProps, object, Leaving | null> {
  getSnapshotBeforeUpdate(previous: SwapProps): Leaving | null {
    const node = this.props.target.current;
    if (previous.view === this.props.view || !node || typeof node.animate !== "function") return null;
    // only the part on screen fades, so a long list does not stretch the page while it goes
    const visible = (this.props.scroller.current?.getBoundingClientRect().bottom ?? window.innerHeight) - node.getBoundingClientRect().top;
    return { node, top: node.offsetTop, left: node.offsetLeft, width: node.offsetWidth, height: Math.max(0, Math.min(node.offsetHeight, visible)) };
  }

  componentDidUpdate(_previous: SwapProps, _state: object, old: Leaving | null): void {
    const next = this.props.target.current;
    if (!old || !next || next === old.node || !next.parentElement) return;
    const reduced = reducedEffectsNow();
    next.animate(
      [
        { opacity: 0, transform: reduced ? "none" : `translateY(${SWAP_RISE_PX}px)` },
        { opacity: 1, transform: "none" },
      ],
      {
        duration: reduced ? DURATION_MS.quick : DURATION_MS.base,
        easing: easeOut,
      },
    );
    Object.assign(old.node.style, {
      position: "absolute",
      top: `${old.top}px`,
      left: `${old.left}px`,
      width: `${old.width}px`,
      height: `${old.height}px`,
      margin: "0",
      overflow: "hidden",
      pointerEvents: "none",
    });
    old.node.setAttribute("aria-hidden", "true");
    old.node.inert = true;
    next.parentElement.append(old.node);
    const fade = old.node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DURATION_MS.quick, easing: easeIn });
    fade.onfinish = () => old.node.remove();
    fade.oncancel = () => old.node.remove();
  }

  render(): ReactNode {
    return this.props.children;
  }
}
