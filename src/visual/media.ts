import type { Template } from "./template/schema";

export interface Media {
  url: string;
  kind: "image" | "video";
}

const MAX_IMAGE_PX = 4096;

export function mediaFor(template: Template, media: Media | null): Media | null {
  const uses = [template.background, ...template.layers].some(({ params }) => params.source === 1 || params.video === 1);
  return uses ? media : null;
}

function openImage(url: string): HTMLImageElement {
  return Object.assign(new Image(), { crossOrigin: "anonymous", src: url });
}

export async function loadImage(url: string): Promise<ImageBitmap> {
  const image = openImage(url);
  await image.decode();
  const scale = Math.min(1, MAX_IMAGE_PX / Math.max(image.naturalWidth, image.naturalHeight));
  if (scale === 1) return createImageBitmap(image);
  return createImageBitmap(image, {
    resizeWidth: Math.max(1, Math.round(image.naturalWidth * scale)),
    resizeHeight: Math.max(1, Math.round(image.naturalHeight * scale)),
    resizeQuality: "high",
  });
}

export function openVideo(url: string): HTMLVideoElement {
  return Object.assign(document.createElement("video"), {
    crossOrigin: "anonymous",
    muted: true,
    loop: true,
    playsInline: true,
    preload: "auto",
    src: url,
  });
}

export async function loadVideo(url: string): Promise<HTMLVideoElement> {
  const video = openVideo(url);
  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve;
    video.onerror = reject;
  });
  // a file whose picture cannot be decoded still loads for its sound
  if (video.videoWidth === 0) throw new Error("the video has no picture that plays here");
  return video;
}

export async function probe({ url, kind }: Media): Promise<void> {
  if (kind === "video") return void (await loadVideo(url));
  const image = openImage(url);
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });
}

export async function loadStill({ url, kind }: Media): Promise<ImageBitmap> {
  return kind === "image" ? loadImage(url) : createImageBitmap(await loadVideo(url));
}
