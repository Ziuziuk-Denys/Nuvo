/** Rules for the karaoke background. */

/** The field moves slowly (about 5 of 255 in 2 s): 15 frames a second look the same as 60 and keep the open view near 6 % CPU. */
export const FRAME_MS = 1000 / 15;
/** The field is drawn at half the CSS size: it is a blur, detail is never visible. */
export const RENDER_SCALE = 0.5;

export function shouldAnimate(open: boolean, visible: boolean, reducedMotion: boolean): boolean {
  return open && visible && !reducedMotion;
}

/** The still field: the cover's bright colour from the top left over its darker one. */
export function stillBackground(colors: { color1: string; color2: string }): string {
  return `radial-gradient(120% 90% at 20% 15%, ${colors.color2} 0%, transparent 60%), radial-gradient(100% 80% at 85% 90%, ${colors.color1} 0%, transparent 65%), ${colors.color1}`;
}
