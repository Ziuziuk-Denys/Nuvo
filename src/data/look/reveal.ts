/** A look change revealed in a circle from the click point; at once with reduced motion or no View Transitions. */
const REVEAL_MS = 420;

export function revealThemeChange(apply: () => void, origin?: { x: number; y: number }): void {
  const doc = document as Document & { startViewTransition?: (update: () => void) => { ready: Promise<void> } };
  if (!doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    apply();
    return;
  }
  const x = origin?.x ?? innerWidth / 2;
  const y = origin?.y ?? innerHeight / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const transition = doc.startViewTransition(apply);
  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: REVEAL_MS, easing: "cubic-bezier(.2,.7,.2,1)", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => undefined);
}
