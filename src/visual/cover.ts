import { paletteFrom, type Palette } from "./render/palette";

const PALETTE_PX = 32;
const COVER_PX = 512;

export interface LoadedCover {
  bitmap: ImageBitmap;
  palette: Palette;
}

export function centreSquare(width: number, height: number): { x: number; y: number; side: number } {
  const side = Math.min(width, height);
  return { x: (width - side) / 2, y: (height - side) / 2, side };
}

export async function loadCover(url: string): Promise<LoadedCover> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  const { x, y, side } = centreSquare(image.naturalWidth, image.naturalHeight);
  const small = new OffscreenCanvas(PALETTE_PX, PALETTE_PX).getContext("2d")!;
  small.drawImage(image, x, y, side, side, 0, 0, PALETTE_PX, PALETTE_PX);
  const palette = paletteFrom(small.getImageData(0, 0, PALETTE_PX, PALETTE_PX).data);
  const bitmap = await createImageBitmap(image, x, y, side, side, { resizeWidth: COVER_PX, resizeHeight: COVER_PX, resizeQuality: "high" });
  return { bitmap, palette };
}
