export const COVER_BUCKETS = [64, 128, 256, 512, 1024] as const;
const DEFAULT_BUCKET = 512;

export function coverBucket(devicePx: number): number {
  if (!Number.isFinite(devicePx) || devicePx <= 0) return DEFAULT_BUCKET;
  return COVER_BUCKETS.find((bucket) => bucket >= devicePx) ?? 1024;
}

export function coverUrl(base: string, src: string, cssPx: number, dpr: number): string {
  if (!src) return "";
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(src)?.[1]?.toLowerCase();
  if (scheme === "https") {
    const size = coverBucket(Math.ceil(cssPx * Math.max(1, dpr)));
    return `${base}/v1/covers?src=${encodeURIComponent(src)}&size=${size}`;
  }
  // the daemon fetches https only, so a plain-http cover shows the placeholder without a request
  if (scheme === "http") return "";
  return src;
}
