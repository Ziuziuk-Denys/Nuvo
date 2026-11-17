// controls over a scene sit on this, so they read the same on a white frame and a black one
export const SCRIM = { rgb: [8, 10, 16] as const, alpha: 0.86 };

export const scrimCss = `rgba(${SCRIM.rgb.join(", ")}, ${SCRIM.alpha})`;
