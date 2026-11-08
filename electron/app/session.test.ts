import { describe, expect, it, vi } from "vitest";
import { findLinkArg, LinkInbox, parseDeeplink } from "./deeplink";
import { allowCheck, allowRequest, contentSecurityPolicy } from "./policy";
import { relaxCors, rewriteRequestHeaders } from "./requestRules";
import { GlobalShortcuts, PLAYER_COMMAND_IDS } from "./shortcuts";

describe("request headers", () => {
  it("YouTube requests get its origin and the substituted user agent", () => {
    const out = rewriteRequestHeaders("https://music.youtube.com/youtubei/v1/player", { Origin: "file://", "x-nuvo-ua": "TestUA", "User-Agent": "Chrome" });
    expect(out).toEqual({ Origin: "https://music.youtube.com", Referer: "https://music.youtube.com/", "User-Agent": "TestUA" });
  });

  it("www.youtube.com keeps its own origin; googlevideo gets music", () => {
    expect(rewriteRequestHeaders("https://www.youtube.com/api", {}).Origin).toBe("https://www.youtube.com");
    expect(rewriteRequestHeaders("https://rr1---sn-x.googlevideo.com/videoplayback", {}).Origin).toBe("https://music.youtube.com");
  });

  it("other hosts pass unchanged", () => {
    const headers = { Origin: "file://", "x-nuvo-ua": "X" };
    expect(rewriteRequestHeaders("https://lrclib.net/api/get", headers)).toBe(headers);
    for (const url of [
      "https://youtube.com.evil.net/x",
      "https://notyoutube.com/x",
      "https://evil.net/www.youtube.com",
      "https://googlevideo.com.evil.net/x",
      "not a url",
    ]) {
      expect(rewriteRequestHeaders(url, headers)).toBe(headers);
    }
  });

  it("the worker partition gets the same rewrite", () => {
    // main installs the same function on both sessions; the rule itself has no session input
    expect(rewriteRequestHeaders("https://www.youtube.com/robots.txt", { "x-nuvo-ua": "Cobalt" })["User-Agent"]).toBe("Cobalt");
  });
});

describe("CORS", () => {
  it("media hosts get exactly the relaxed set", () => {
    const { headers } = relaxCors(
      "https://rr1.googlevideo.com/x",
      "GET",
      { "access-control-allow-origin": ["https://music.youtube.com"], "content-type": ["audio/webm"] },
      "HTTP/1.1 200 OK",
    );
    expect(headers["access-control-allow-origin"]).toEqual(["*"]);
    expect(
      Object.keys(headers)
        .filter((k) => k.startsWith("access-control-"))
        .sort(),
    ).toEqual([
      "access-control-allow-headers",
      "access-control-allow-methods",
      "access-control-allow-origin",
      "access-control-expose-headers",
      "access-control-max-age",
    ]);
    expect(headers["content-type"]).toEqual(["audio/webm"]);
  });

  it("a preflight to a media host is answered 200", () => {
    expect(relaxCors("https://i1.sndcdn.com/a.jpg", "OPTIONS", {}, "HTTP/1.1 403 Forbidden").statusLine).toBe("HTTP/1.1 200 OK");
  });

  it("other hosts keep their headers", () => {
    const headers = { "access-control-allow-origin": ["https://example.org"] };
    expect(relaxCors("https://example.org/", "GET", headers, "HTTP/1.1 200 OK").headers).toBe(headers);
  });

  it("(unit part) the policy denies by default and lists the hosts; the e2e part loads the packaged page", () => {
    const csp = contentSecurityPolicy({ wasm: false, appleMusic: false });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' nuvo-core: https://*.youtube.com https://*.googlevideo.com");
    expect(csp).toContain("frame-src 'none'");
    for (const host of ["https://*.ytimg.com", "https://yt3.googleusercontent.com", "https://lh3.googleusercontent.com", "https://*.sndcdn.com"]) {
      expect(csp.match(/img-src [^;]*/)![0]).toContain(host);
    }
    expect(csp).toContain("style-src 'self' 'unsafe-inline';");
    expect(csp).toContain("font-src 'self' nuvo-core:;");
    expect(csp).not.toContain("unsafe-eval");
  });
});

describe("permissions", () => {
  const app = { indexUrl: "file:///opt/nuvo/index.html" };

  it("only the exact packaged page or the exact dev origin counts as the app", () => {
    for (const url of ["file:///opt/nuvo/index.html", "file:///opt/nuvo/index.html#/library", "file:///opt/nuvo/index.html?x=1"]) {
      expect(allowCheck("fullscreen", url, {}, app)).toBe(true);
    }
    for (const url of [
      "file:///etc/passwd",
      "file:///opt/nuvo/other.html",
      "file:///opt/nuvo/index.html/../evil.html",
      "file:///",
      "file://",
      "file://host/opt/nuvo/index.html",
      "not a url",
      "",
    ]) {
      expect(allowCheck("fullscreen", url, {}, app)).toBe(false);
    }
    const dev = { devServerUrl: "http://localhost:5173/" };
    expect(allowCheck("fullscreen", "http://localhost:5173/x", {}, dev)).toBe(true);
    for (const url of [
      "http://localhost:5174/",
      "https://localhost:5173/",
      "http://localhost/",
      "http://localhost.evil.com:5173/",
      "http://localhost:5173@evil.com/",
    ]) {
      expect(allowCheck("fullscreen", url, {}, dev)).toBe(false);
    }
    expect(allowCheck("fullscreen", "http://localhost:5173/", {}, app)).toBe(false);
    expect(allowCheck("fullscreen", "file:///opt/nuvo/index.html", {}, {})).toBe(false);
  });

  it("media needs an explicit audio type", () => {
    expect(allowCheck("media", "file:///opt/nuvo/index.html", {}, app)).toBe(false);
    expect(allowCheck("media", "file:///opt/nuvo/index.html", { mediaType: "video" }, app)).toBe(false);
  });

  it("audio enumeration from the app only", () => {
    expect(allowCheck("media", "file:///opt/nuvo/index.html", { mediaType: "audio" }, app)).toBe(true);
    expect(allowCheck("media", "https://www.youtube.com", { mediaType: "audio" }, app)).toBe(false);
    expect(allowCheck("speaker-selection", "http://localhost:5173/", {}, { devServerUrl: "http://localhost:5173/" })).toBe(true);
  });

  it("capture and everything else is denied", () => {
    expect(allowRequest("media", "file:///opt/nuvo/index.html", { mediaTypes: ["audio"] }, app)).toBe(false);
    for (const p of ["notifications", "geolocation", "openExternal"]) expect(allowRequest(p, "file:///opt/nuvo/index.html", {}, app)).toBe(false);
  });
});

describe("deep links", () => {
  it("parsing", () => {
    const uc = `UC${"a".repeat(22)}`;
    expect(parseDeeplink("nuvo://track?id=Nuvo0Track1")).toEqual({ type: "track", id: "Nuvo0Track1" });
    expect(parseDeeplink(`nuvo://ARTIST?id=${uc}`)).toEqual({ type: "artist", id: uc });
    expect(parseDeeplink("nuvo://album?id=MPREb_abcd")).toEqual({ type: "album", id: "MPREb_abcd" });
    expect(parseDeeplink("nuvo://playlist?id=PL12345678")).toEqual({ type: "playlist", id: "PL12345678" });
    for (const bad of [
      "https://track?id=Nuvo0Track1",
      "nuvo://song?id=Nuvo0Track1",
      "nuvo://track?id=a&id=b",
      "nuvo://track",
      "nuvo://track?id=short",
      "nuvo://track?id=dQw4w9WgXc!",
      "nuvo://artist?id=UCshort",
    ]) {
      expect(parseDeeplink(bad)).toBeNull();
    }
  });

  it("an oversized link is rejected before parsing", () => {
    expect(parseDeeplink(`nuvo://playlist?id=${"a".repeat(3000)}`)).toBeNull();
    expect(parseDeeplink(`nuvo://track?id=Nuvo0Track1&${"x=1&".repeat(1000)}`)).toBeNull();
  });

  it("the link argument is found", () => {
    expect(findLinkArg(["/opt/Nuvo/nuvo", "--flag", "nuvo://track?id=Nuvo0Track1"])).toBe("nuvo://track?id=Nuvo0Track1");
    expect(findLinkArg(["/opt/Nuvo/nuvo"])).toBeNull();
  });

  it("a cold-start link waits for the renderer and arrives once", () => {
    const pushed: unknown[] = [];
    const inbox = new LinkInbox(
      (t) => pushed.push(t),
      () => undefined,
    );
    inbox.receive("nuvo://track?id=Nuvo0Track1");
    expect(inbox.take()).toEqual({ type: "track", id: "Nuvo0Track1" });
    expect(inbox.take()).toBeNull();
    expect(pushed).toEqual([]);
  });

  it("a listening renderer gets new links at once and the window shows", () => {
    const pushed: unknown[] = [];
    const show = vi.fn();
    const inbox = new LinkInbox((t) => pushed.push(t), show);
    inbox.take();
    inbox.receive("nuvo://track?id=Nuvo0Track1");
    expect(pushed).toHaveLength(1);
    expect(show).toHaveBeenCalled();
  });

  it("links wait while the renderer reloads", () => {
    const pushed: unknown[] = [];
    const inbox = new LinkInbox(
      (t) => pushed.push(t),
      () => undefined,
    );
    inbox.take();
    inbox.rendererGone();
    inbox.receive("nuvo://track?id=Nuvo0Track1");
    expect(pushed).toEqual([]);
    expect(inbox.take()).toEqual({ type: "track", id: "Nuvo0Track1" });
  });

  it("the newest pending link wins", () => {
    const inbox = new LinkInbox(
      () => undefined,
      () => undefined,
    );
    inbox.receive("nuvo://track?id=Nuvo0Track1");
    inbox.receive("nuvo://track?id=Nuvo0Track2");
    expect(inbox.take()?.id).toBe("Nuvo0Track2");
  });
});

describe("global shortcuts", () => {
  const fake = () => {
    const registered = new Map<string, () => void>();
    return {
      registered,
      refuse: new Set<string>(),
      register(accelerator: string, callback: () => void) {
        if (this.refuse.has(accelerator)) return false;
        registered.set(accelerator, callback);
        return true;
      },
      unregister(accelerator: string) {
        registered.delete(accelerator);
      },
    };
  };

  it("a player binding sends a player command", () => {
    const shortcuts = fake();
    const sent: unknown[] = [];
    const global = new GlobalShortcuts(
      shortcuts,
      () => true,
      (id) => sent.push(PLAYER_COMMAND_IDS[id] ? { channel: "player:command", type: PLAYER_COMMAND_IDS[id] } : { channel: "app:command", commandId: id }),
    );
    expect(global.set([{ commandId: "player.toggle", accelerator: "Ctrl+Alt+P" }])).toEqual([{ commandId: "player.toggle", ok: true }]);
    shortcuts.registered.get("Ctrl+Alt+P")!();
    expect(sent).toEqual([{ channel: "player:command", type: "toggle" }]);
  });

  it("the player command table holds exactly the three ids", () => {
    expect(Object.keys(PLAYER_COMMAND_IDS)).toEqual(["player.toggle", "player.next", "player.previous"]);
    expect(PLAYER_COMMAND_IDS["library.like-toggle"]).toBeUndefined();
  });

  it("a new list replaces the old one", () => {
    const shortcuts = fake();
    const global = new GlobalShortcuts(
      shortcuts,
      () => true,
      () => undefined,
    );
    global.set([
      { commandId: "player.next", accelerator: "Ctrl+Alt+A" },
      { commandId: "player.previous", accelerator: "Ctrl+Alt+B" },
    ]);
    global.set([{ commandId: "player.mute", accelerator: "Ctrl+Alt+C" }]);
    expect([...shortcuts.registered.keys()]).toEqual(["Ctrl+Alt+C"]);
  });

  it("invalid and taken bindings report why; the rest still register", () => {
    const shortcuts = fake();
    shortcuts.refuse.add("Ctrl+T");
    const global = new GlobalShortcuts(
      shortcuts,
      () => true,
      () => undefined,
    );
    const results = global.set([
      { commandId: "player.next", accelerator: `Ctrl+${"A".repeat(63)}` },
      { commandId: "player.next", accelerator: "Ctrl+Nope" },
      { commandId: "player.next", accelerator: "Ctrl+T" },
      { commandId: "player.next", accelerator: "Ctrl+F" },
    ]);
    expect(results.map((r) => r.reason ?? "ok")).toEqual(["invalid", "invalid", "taken", "ok"]);
    expect([...shortcuts.registered.keys()]).toEqual(["Ctrl+F"]);
  });

  it("hostile accelerators are refused", () => {
    const shortcuts = fake();
    const global = new GlobalShortcuts(
      shortcuts,
      () => true,
      () => undefined,
    );
    const bad = ["A", "Space", "Enter", "Shift+A", "Shift+Space", "Ctrl+", "+", "", "Ctrl+A+B", "Ctrl++", "Ctrl+Shift", "Ctrl+F25", "Ctrl+A\n"];
    const results = global.set(bad.map((accelerator, i) => ({ commandId: "player.next", accelerator })));
    expect(results.every((r) => r.reason === "invalid")).toBe(true);
    expect(shortcuts.registered.size).toBe(0);
    const ok = global.set([
      { commandId: "player.toggle", accelerator: "MediaPlayPause" },
      { commandId: "player.next", accelerator: "F13" },
      { commandId: "player.mute", accelerator: "Ctrl+Shift+K" },
    ]);
    expect(ok.every((r) => r.ok)).toBe(true);
  });

  it("caps: 64 characters per accelerator and 32 bindings", () => {
    const shortcuts = fake();
    const global = new GlobalShortcuts(
      shortcuts,
      () => true,
      () => undefined,
    );
    expect(global.set([{ commandId: "player.next", accelerator: `${"Ctrl+".repeat(13)}A` }])[0].reason).toBe("invalid");
    const many = Array.from({ length: 40 }, (_, i) => ({ commandId: "player.next", accelerator: `Ctrl+Alt+F${(i % 24) + 1}` }));
    const results = global.set(many);
    expect(results).toHaveLength(32);
  });

  it("other command ids go out as app commands", () => {
    const shortcuts = fake();
    const sent: unknown[] = [];
    const global = new GlobalShortcuts(
      shortcuts,
      () => true,
      (id) => sent.push(PLAYER_COMMAND_IDS[id] ? { type: PLAYER_COMMAND_IDS[id] } : { commandId: id }),
    );
    global.set([{ commandId: "app.show", accelerator: "Super+N" }]);
    shortcuts.registered.get("Super+N")!();
    expect(sent).toEqual([{ commandId: "app.show" }]);
  });
});
