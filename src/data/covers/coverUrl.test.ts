import { describe, expect, it } from "vitest";
import { coverBucket, coverUrl } from "./coverUrl";

const BASE = "nuvo-core://local";
const daemon = (src: string, size: number) => `${BASE}/v1/covers?src=${encodeURIComponent(src)}&size=${size}`;

describe("coverUrl", () => {
  it("sends https covers through the daemon at the bucket for the drawn size", () => {
    const src = "https://lh3.googleusercontent.com/abc=w544-h544-l90-rj";
    expect(coverUrl(BASE, src, 40, 2)).toBe(daemon(src, 128));
    expect(coverUrl(BASE, src, 40, 1)).toBe(daemon(src, 64));
    expect(coverUrl(BASE, src, 200, 2)).toBe(daemon(src, 512));
    expect(coverUrl(BASE, src, 2000, 2)).toBe(daemon(src, 1024));
    expect(coverUrl(BASE, src, 40, 0.5)).toBe(daemon(src, 64));
  });

  it("leaves local covers alone and asks nothing for http or empty sources (Review Focus 5)", () => {
    for (const local of ["nuvo-core://local/v1/me/playlists/p1/cover", "data:image/png;base64,AAAA", "blob:nuvo/123", "/assets/liked.png"]) {
      expect(coverUrl(BASE, local, 40, 2)).toBe(local);
    }
    expect(coverUrl(BASE, "http://i1.sndcdn.com/artworks-1-large.jpg", 40, 2)).toBe("");
    expect(coverUrl(BASE, "", 40, 2)).toBe("");
  });
});

describe("coverBucket", () => {
  it("rounds up to 64, 128, 256, 512 or 1024; nothing usable is 512 (covers 3.1)", () => {
    expect([1, 64, 65, 128, 129, 256, 300, 512, 513, 1024, 5000].map(coverBucket)).toEqual([64, 64, 128, 128, 256, 256, 512, 512, 1024, 1024, 1024]);
    expect(coverBucket(0)).toBe(512);
    expect(coverBucket(Number.NaN)).toBe(512);
  });
});
