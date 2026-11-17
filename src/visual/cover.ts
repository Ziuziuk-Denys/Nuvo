import { paletteFrom, type Palette } from "./render/palette";

const PALETTE_PX = 32;
const COVER_PX = 512;

export interface LoadedCover {
  bitmap: ImageBitmap;
  palette: Palette;
}

export async function loadCover(url: string): Promise<LoadedCover> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  const small = new OffscreenCanvas(PALETTE_PX, PALETTE_PX).getContext("2d")!;
  small.drawImage(image, 0, 0, PALETTE_PX, PALETTE_PX);
  const palette = paletteFrom(small.getImageData(0, 0, PALETTE_PX, PALETTE_PX).data);
  const bitmap = await createImageBitmap(image, { resizeWidth: COVER_PX, resizeHeight: COVER_PX, resizeQuality: "high" });
  return { bitmap, palette };
}
