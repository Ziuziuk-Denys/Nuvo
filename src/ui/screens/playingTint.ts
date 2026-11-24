import type { CSSProperties } from "react";
import { coverSrc, useCoverColors } from "../ports/covers";
import { usePlayingCover } from "../ports/player";

const SAMPLE_PX = 64;

export function usePlayingTint(shown: boolean): CSSProperties | undefined {
  const cover = usePlayingCover();
  const { color2 } = useCoverColors(shown && cover ? coverSrc(cover, SAMPLE_PX, 1) : undefined);
  return shown && cover ? ({ "--n-playing": color2 } as CSSProperties) : undefined;
}
