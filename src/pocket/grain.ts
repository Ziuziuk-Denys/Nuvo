const TILE = 96;
let made: string | null = null;

export function grain(): string {
  if (made) return made;
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const context = canvas.getContext("2d");
  if (!context) return "none";
  const tile = context.createImageData(TILE, TILE);
  for (let i = 0; i < tile.data.length; i += 4) {
    tile.data.fill(Math.random() * 255, i, i + 3);
    tile.data[i + 3] = 14;
  }
  context.putImageData(tile, 0, 0);
  made = `url(${canvas.toDataURL()}) 0 0 / ${TILE / 2}px`;
  return made;
}
