// @vitest-environment node
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./policy";
import { relaxCors } from "./requestRules";

describe("import hosts", () => {
  it("lets the page read Apple Music pages and Deezer's API and short links", () => {
    for (const url of [
      "https://music.apple.com/us/playlist/pl.a",
      "https://api.deezer.com/playlist/1",
      "https://deezer.page.link/AbC",
      "https://link.deezer.com/s/x",
      "https://www.deezer.com/en/playlist/1",
    ]) {
      expect(relaxCors(url, "GET", {}, "HTTP/1.1 200 OK").headers["access-control-allow-origin"], url).toEqual(["*"]);
    }
    for (const url of ["https://evil.example/x", "https://music.apple.com.evil.example/x", "https://deezer.com/x"]) {
      expect(relaxCors(url, "GET", {}, "HTTP/1.1 200 OK").headers, url).toEqual({});
    }
  });

  it("allows them in connect-src as exact https origins and nowhere else", () => {
    const csp = contentSecurityPolicy({ wasm: false, appleMusic: false });
    const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(name))!;
    const connect = directive("connect-src").split(" ");
    for (const host of ["https://music.apple.com", "https://api.deezer.com", "https://www.deezer.com", "https://deezer.page.link", "https://link.deezer.com"])
      expect(connect).toContain(host);
    for (const name of ["img-src", "media-src", "script-src", "default-src", "frame-src"]) expect(directive(name)).not.toMatch(/deezer|music\.apple/);
  });
});
