import { colorsFor, coverSrc } from "../../ports/covers";

export type ReplayCard = "song" | "time" | "hours";
export type ReplayFormat = "story" | "square";

export interface ReplayImage {
  card: ReplayCard;
  format: ReplayFormat;
  font: string;
  period: string;
  minutes: string;
  minutesLine: string;
  song: { title: string; artist: string; plays: string; cover: string };
  list: { title: string; artist: string; cover: string }[];
  byHour: readonly number[];
  hour: string;
  hourLine: string;
  madeWith: string;
}

const WIDTH = 1080;
const HEIGHT: Record<ReplayFormat, number> = { story: 1920, square: 1080 };
const EDGE = 84;
const INK = "#f4f4f5";
const DIM = "rgba(244, 244, 245, 0.62)";
const ROOM = "#0b0b0d";
const MARK = new Path2D(
  "M32 62A30 30 0 0 1 62 32L87.92 32A14 14 0 0 1 100.04 39L130.14 91.14A16 16 0 0 0 160 83.14L160 50A18 18 0 0 1 178 32L194 32A30 30 0 0 1 224 62L224 194A30 30 0 0 1 194 224L168.08 224A14 14 0 0 1 155.96 217L125.86 164.86A16 16 0 0 0 96 172.86L96 206A18 18 0 0 1 78 224L62 224A30 30 0 0 1 32 194Z",
);

type Context = CanvasRenderingContext2D;

async function loadImage(cover: string, px: number): Promise<HTMLImageElement | null> {
  if (!cover) return null;
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = coverSrc(cover, px, 1);
  return image.decode().then(
    () => image,
    () => null,
  );
}

function drawCover(ctx: Context, image: HTMLImageElement | null, x: number, y: number, size: number, radius: number, object: boolean): void {
  ctx.save();
  if (object) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = size * 0.14;
    ctx.shadowOffsetY = size * 0.06;
  }
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, radius);
  ctx.fillStyle = "#1a1a1d";
  ctx.fill();
  ctx.restore();
  if (image) {
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, radius);
    ctx.clip();
    ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, x, y, size, size);
    ctx.restore();
  }
  const edge = ctx.createLinearGradient(x, y, x, y + size);
  edge.addColorStop(0, "rgba(255, 255, 255, 0.34)");
  edge.addColorStop(0.4, "rgba(255, 255, 255, 0.06)");
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x + 1, y + 1, size - 2, size - 2, radius - 1);
  ctx.stroke();
}

function drawRoom(ctx: Context, color: string, lampX: number, lampY: number, reach: number, height: number): void {
  const picture = ctx.createImageData(WIDTH, height);
  const [r, g, b] = (color.match(/\d+/g) ?? ["128", "144", "176"]).map(Number);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const distance = Math.hypot(x - lampX, y - lampY) / reach;
      const light = 0.64 / (1 + distance * distance * 5);
      // without grain eight bits show bands
      const grain = Math.random() + Math.random() - 1;
      const at = (y * WIDTH + x) * 4;
      picture.data[at] = 11 + r * light + grain;
      picture.data[at + 1] = 11 + g * light + grain;
      picture.data[at + 2] = 13 + b * light + grain;
      picture.data[at + 3] = 255;
    }
  }
  ctx.putImageData(picture, 0, 0);
}

export function fitText(ctx: Pick<Context, "measureText">, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, middle).trimEnd()}…`).width <= width) low = middle;
    else high = middle - 1;
  }
  return `${text.slice(0, low).trimEnd()}…`;
}

export function wrapText(ctx: Pick<Context, "measureText">, text: string, width: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  const words = text.split(/\s+/);
  for (let at = 0; at < words.length; at += 1) {
    const next = line ? `${line} ${words[at]}` : words[at];
    if (line && ctx.measureText(next).width > width) {
      out.push(line);
      line = words[at];
      if (out.length === lines) return [...out.slice(0, -1), fitText(ctx, `${out[lines - 1]} ${words.slice(at).join(" ")}`, width)];
    } else line = next;
  }
  return [...out, fitText(ctx, line, width)].slice(0, lines);
}

function write(ctx: Context, text: string, x: number, y: number, size: number, weight: number, color: string, font: string, tracking = 0): void {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.letterSpacing = `${size * tracking}px`;
  ctx.wordSpacing = tracking < 0 ? `${size * -0.06}px` : "0px";
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function fitSize(ctx: Context, text: string, weight: number, font: string, width: number, start: number, tracking: number): number {
  let size = start;
  for (; size > 40; size -= 4) {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.letterSpacing = `${size * tracking}px`;
    if (ctx.measureText(text).width <= width) break;
  }
  return size;
}

function drawFooter(ctx: Context, image: ReplayImage, height: number): void {
  const y = height - EDGE;
  ctx.save();
  ctx.translate(EDGE - 6, y - 34);
  ctx.scale(44 / 256, 44 / 256);
  ctx.fillStyle = INK;
  ctx.fill(MARK);
  ctx.restore();
  write(ctx, image.madeWith, EDGE + 54, y, 32, 500, DIM, image.font);
}

function drawSong(ctx: Context, image: ReplayImage, cover: HTMLImageElement | null): void {
  const story = image.format === "story";
  const size = story ? WIDTH - EDGE * 2 : 520;
  const top = story ? 330 : 178;
  drawCover(ctx, cover, EDGE, top, size, story ? 36 : 28, true);
  const width = WIDTH - EDGE * 2;
  const titleSize = story ? 92 : 64;
  ctx.font = `700 ${titleSize}px ${image.font}`;
  ctx.letterSpacing = `${titleSize * -0.03}px`;
  const lines = wrapText(ctx, image.song.title, width, story ? 2 : 1);
  let y = top + size + titleSize + (story ? 56 : 20);
  for (const line of lines) {
    write(ctx, line, EDGE, y, titleSize, 700, INK, image.font, -0.03);
    y += titleSize * 1.08;
  }
  y += story ? 4 : -18;
  ctx.font = `500 ${story ? 44 : 34}px ${image.font}`;
  ctx.letterSpacing = "0px";
  write(ctx, fitText(ctx, image.song.artist, width), EDGE, y, story ? 44 : 34, 500, INK, image.font);
  const plays = story ? 38 : 30;
  write(ctx, image.song.plays, EDGE, y + (story ? 64 : 48), plays, 400, DIM, image.font);
}

function drawTime(ctx: Context, image: ReplayImage, covers: (HTMLImageElement | null)[], height: number): void {
  const story = image.format === "story";
  const width = WIDTH - EDGE * 2;
  const size = fitSize(ctx, image.minutes, 700, image.font, width, story ? 380 : 260, -0.045);
  const y = (story ? 330 : 190) + size * 0.74;
  write(ctx, image.minutes, EDGE - size * (image.minutes.startsWith("1") ? 0.012 : 0.04), y, size, 700, INK, image.font, -0.045);
  ctx.font = `500 ${story ? 46 : 36}px ${image.font}`;
  ctx.letterSpacing = "0px";
  write(ctx, fitText(ctx, image.minutesLine, width), EDGE, y + Math.max(story ? 96 : 70, size * 0.34), story ? 46 : 36, 500, INK, image.font);
  const rows = image.list.slice(0, story ? 5 : 3);
  const rowHeight = story ? 148 : 116;
  const art = story ? 112 : 88;
  let at = height - EDGE - (story ? 150 : 96) - rows.length * rowHeight;
  rows.forEach((row, index) => {
    drawCover(ctx, covers[index], EDGE, at, art, 16, false);
    const x = EDGE + art + 32;
    ctx.font = `600 ${story ? 42 : 34}px ${image.font}`;
    write(ctx, fitText(ctx, row.title, WIDTH - EDGE - x), x, at + art * 0.46, story ? 42 : 34, 600, INK, image.font);
    ctx.font = `400 ${story ? 34 : 28}px ${image.font}`;
    write(ctx, fitText(ctx, row.artist, WIDTH - EDGE - x), x, at + art * 0.86, story ? 34 : 28, 400, DIM, image.font);
    at += rowHeight;
  });
}

function drawHours(ctx: Context, image: ReplayImage, height: number): void {
  const story = image.format === "story";
  const radius = story ? 420 : 300;
  const centerX = WIDTH / 2;
  const centerY = story ? 900 : 500;
  const max = Math.max(1, ...image.byHour);
  const peak = image.byHour.indexOf(max);
  ctx.lineCap = "round";
  image.byHour.forEach((value, hour) => {
    const angle = ((hour * 15 - 90) * Math.PI) / 180;
    const inner = radius * 0.54;
    const outer = inner + 4 + (value / max) * (radius - inner);
    ctx.strokeStyle = hour === peak ? INK : `rgba(244, 244, 245, ${0.18 + 0.42 * (value / max)})`;
    ctx.lineWidth = story ? 14 : 10;
    ctx.beginPath();
    ctx.moveTo(centerX + Math.cos(angle) * inner, centerY + Math.sin(angle) * inner);
    ctx.lineTo(centerX + Math.cos(angle) * outer, centerY + Math.sin(angle) * outer);
    ctx.stroke();
  });
  ctx.textAlign = "center";
  write(ctx, image.hour, centerX, centerY + (story ? 42 : 30), story ? 120 : 84, 700, INK, image.font, -0.03);
  ctx.textAlign = "left";
  const size = story ? 60 : 44;
  ctx.font = `600 ${size}px ${image.font}`;
  ctx.letterSpacing = `${size * -0.02}px`;
  let y = story ? height - 360 : height - 190;
  for (const line of wrapText(ctx, image.hourLine, WIDTH - EDGE * 2, story ? 2 : 1)) {
    write(ctx, line, EDGE, y, size, 600, INK, image.font, -0.02);
    y += size * 1.2;
  }
}

export async function renderReplayImage(canvas: HTMLCanvasElement, image: ReplayImage): Promise<void> {
  const height = HEIGHT[image.format];
  const story = image.format === "story";
  const [cover, color, ...covers] = await Promise.all([
    loadImage(image.song.cover, 1000),
    colorsFor(coverSrc(image.song.cover, 64, 1)).then((colors) => colors.color2),
    ...(image.card === "time" ? image.list.slice(0, 5).map((row) => loadImage(row.cover, 256)) : []),
  ]);
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = ROOM;
  ctx.fillRect(0, 0, WIDTH, height);
  drawRoom(ctx, color, image.card === "hours" ? WIDTH / 2 : WIDTH * 0.2, image.card === "time" ? height * 0.12 : height * 0.36, WIDTH, height);
  write(ctx, fitText(ctx, image.period, WIDTH), EDGE, story ? 200 : 130, story ? 52 : 40, 600, INK, image.font, -0.02);
  if (image.card === "song") drawSong(ctx, image, cover);
  else if (image.card === "time") drawTime(ctx, image, covers, height);
  else drawHours(ctx, image, height);
  drawFooter(ctx, image, height);
}
