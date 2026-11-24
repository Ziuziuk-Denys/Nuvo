import { readLight, type CoverLight } from "@/ui/light/readLight";

const SAMPLE = 32;

// null for a cover served without CORS headers: it taints the canvas
export function coverLight(image: HTMLImageElement): CoverLight | null {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  try {
    context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
    return readLight(context.getImageData(0, 0, SAMPLE, SAMPLE).data);
  } catch {
    return null;
  }
}
