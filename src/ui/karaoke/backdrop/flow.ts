// 15 fps looks the same as 60 for this slow field and keeps the open view near 6 % CPU
export const FRAME_MS = 1000 / 15;
/** The field is drawn at half the CSS size: it is a blur, detail is never visible. */
export const RENDER_SCALE = 0.5;

export function shouldAnimate(open: boolean, visible: boolean, reducedMotion: boolean): boolean {
  return open && visible && !reducedMotion;
}

export function stillBackground(colors: { color1: string; color2: string }): string {
  return `radial-gradient(120% 90% at 20% 15%, ${colors.color2} 0%, transparent 60%), radial-gradient(100% 80% at 85% 90%, ${colors.color1} 0%, transparent 65%), ${colors.color1}`;
}
