// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LinkInbox, MAX_LINK_CHARS, findLinkArg, parseDeeplink } from "./deeplink";
import { contentSecurityPolicy } from "./policy";
import { relaxCors } from "./requestRules";

const PAYLOAD = "EAABDCDQmtC40L3QvgnQk9GA0YPQv9C_0LAg0LrRgNC-0LLQuJ8C";

describe("share deep links", () => {
  it("parses a share link and keeps the older types", () => {
    expect(parseDeeplink(`nuvo://share?id=${PAYLOAD}`)).toEqual({
      type: "share",
      id: PAYLOAD,
    });
    expect(parseDeeplink(`nuvo://SHARE?id=${PAYLOAD}`)).toEqual({
      type: "share",
      id: PAYLOAD,
    });
    expect(parseDeeplink("nuvo://track?id=Nuvo0Track1")).toEqual({
      type: "track",
      id: "Nuvo0Track1",
    });
    expect(parseDeeplink(`nuvo://share?id=${"A".repeat(65_536)}`)?.id.length).toBe(65_536);
    expect(`nuvo://share?id=${"A".repeat(65_536)}`.length).toBe(MAX_LINK_CHARS);
  });

  it.each([
    ["an empty id", "nuvo://share?id="],
    ["a one-character id", "nuvo://share?id=A"],
    ["an over-long id", `nuvo://share?id=${"A".repeat(65_537)}`],
    ["a bad character", "nuvo://share?id=EAAB.wQD"],
    ["padding", "nuvo://share?id=EAAB=="],
    ["two ids", `nuvo://share?id=${PAYLOAD}&id=${PAYLOAD}`],
    ["no id", "nuvo://share"],
    ["another parameter", `nuvo://share?id=${PAYLOAD}&foo=1`],
    ["an empty extra parameter", `nuvo://share?id=${PAYLOAD}&`],
  ])("refuses %s", (_name, link) => {
    expect(parseDeeplink(link)).toBeNull();
  });

  it("a share link that starts the app waits for the renderer and arrives once", () => {
    const argv = ["/opt/Nuvo/nuvo", "--no-sandbox", `nuvo://share?id=${PAYLOAD}`];
    const pushed: unknown[] = [];
    let shown = 0;
    const inbox = new LinkInbox(
      (target) => pushed.push(target),
      () => shown++,
    );
    inbox.receive(findLinkArg(argv));
    expect(inbox.take()).toEqual({ type: "share", id: PAYLOAD });
    expect(inbox.take()).toBeNull();
    expect(pushed).toEqual([]);
    expect(shown).toBe(1);
  });
});

describe("song lookup hosts", () => {
  it("the page may call the keyless lookup APIs", () => {
    const csp = contentSecurityPolicy({ wasm: false, appleMusic: false });
    for (const host of ["https://itunes.apple.com", "https://api.deezer.com", "https://api.music.yandex.net"]) expect(csp).toContain(host);
  });

  it("Deezer and Yandex answers are readable cross-origin; unlisted hosts keep their headers", () => {
    expect(relaxCors("https://api.deezer.com/track/3135556", "GET", {}, "HTTP/1.1 200 OK").headers["access-control-allow-origin"]).toEqual(["*"]);
    expect(relaxCors("https://api.music.yandex.net/tracks/1", "GET", {}, "HTTP/1.1 200 OK").headers["access-control-allow-origin"]).toEqual(["*"]);
    const headers = {};
    expect(relaxCors("https://example.org/en/track/1", "GET", headers, "HTTP/1.1 200 OK").headers).toBe(headers);
  });
});
