import { describe, expect, it, vi } from "vitest";
import { findCover } from "./coverLookup";

const apple = (results: unknown[]) => ({ results });
const deezer = (data: unknown[]) => ({ data });

describe("cover lookup", () => {
  it("takes the Apple artwork of the same artist at 512 px", async () => {
    const get = vi.fn(async (url: string) =>
      url.startsWith("https://itunes.apple.com/")
        ? apple([
            { artistName: "moulses", artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/a.jpg/100x100bb.jpg" },
            { artistName: "zhanulka", artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/b.jpg/100x100bb.jpg" },
          ])
        : null,
    );
    await expect(findCover("zhanulka, Ace Flamez", "портреты (Acoustic)", get)).resolves.toBe("https://is1-ssl.mzstatic.com/image/thumb/b.jpg/512x512bb.jpg");
    expect(get.mock.calls[0][0]).toContain(encodeURIComponent("zhanulka портреты (Acoustic)"));
  });

  it("falls back to Deezer, and to nothing when no artist matches", async () => {
    const cover = "https://cdn-images.dzcdn.net/images/cover/c95a/1000x1000-000000-80-0-0.jpg";
    const get = async (url: string) =>
      url.startsWith("https://api.deezer.com/") ? deezer([{ artist: { name: "Zhanulka" }, album: { cover_xl: cover } }]) : apple([]);
    await expect(findCover("zhanulka", "портреты", get)).resolves.toBe(cover);
    await expect(findCover("someone else", "портреты", get)).resolves.toBeNull();
  });

  it("survives a failing catalog and skips empty input", async () => {
    const get = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(findCover("zhanulka", "портреты", get)).resolves.toBeNull();
    await expect(findCover("", "портреты", get)).resolves.toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
