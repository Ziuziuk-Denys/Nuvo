import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { centreSquare, loadCover } from "./cover";

it("a cover that is not square keeps its shape: the middle square is taken", () => {
  expect(centreSquare(1280, 720)).toEqual({ x: 280, y: 0, side: 720 });
  expect(centreSquare(600, 900)).toEqual({ x: 0, y: 150, side: 600 });
  expect(centreSquare(512, 512)).toEqual({ x: 0, y: 0, side: 512 });
});

describe("loadCover", () => {
  let asked: string[];

  beforeEach(() => {
    asked = [];
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        decode() {
          asked.push(this.src);
          return Promise.reject(new Error("no picture here"));
        }
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  const daemon = (src: string) => `nuvo-core://local/v1/covers?src=${encodeURIComponent(src)}&size=512`;

  it("asks the core for every outside picture, because the page may not load most of those hosts itself", async () => {
    const outside = [
      "https://is1-ssl.mzstatic.com/image/thumb/a.jpg/1000x1000bb.jpg",
      "https://i.ytimg.com/vi/abc/hqdefault.jpg",
      "https://yt3.googleusercontent.com/abc=w544-h544",
      "https://i1.sndcdn.com/artworks-abc-t500x500.jpg",
    ];
    for (const url of outside) await expect(loadCover(url)).rejects.toThrow();
    expect(asked).toEqual(outside.map(daemon));
  });

  it("takes local and inline pictures as they are", async () => {
    const own = ["nuvo-core://local/v1/local/tracks/local:a/cover", "data:image/png;base64,AAAA"];
    for (const url of own) await expect(loadCover(url)).rejects.toThrow();
    expect(asked).toEqual(own);
  });

  it("asks for nothing where there is no cover", async () => {
    for (const url of ["", "http://example.com/a.jpg"]) await expect(loadCover(url)).rejects.toThrow("no cover");
    expect(asked).toEqual([]);
  });
});
