import { describe, expect, it } from "vitest";
import { formatReport, issueUrl } from "./report";

const NOW = new Date("2026-11-02T10:00:00Z");

describe("formatReport", () => {
  it("puts the app facts and the core section under their headings", () => {
    const text = formatReport(
      { version: "0.3.0", platform: "linux", packaged: true, compositor: "hyprland" },
      { version: "0.3.0", phase: "ok", log: "started" },
      NOW,
    );
    expect(text.split("\n")[0]).toBe("Nuvo bug report, 2026-11-02T10:00:00.000Z");
    expect(text).toContain("  version 0.3.0");
    expect(text).toContain("  compositor hyprland");
    expect(text).toContain('"phase": "ok"');
  });

  it("says what is missing instead of failing", () => {
    const text = formatReport(null, null, NOW);
    expect(text).toContain("  not running in the desktop shell");
    expect(text).toContain("  did not answer");
  });

  it("leaks no secrets even if the core section carried them", () => {
    const daemon = {
      phase: "ok",
      token: "abcdef0123456789abcdef",
      keyring: { item: "nuvo-core", secret: "hunter2" },
      trackHistory: [{ title: "Private song" }],
      log: [
        "opened /home/denys/.local/share/nuvo/db.sqlite and C:\\Users\\Denys\\AppData\\x",
        "opened /Users/denys/Music/a.mp3",
        "Authorization: Bearer sk-live-12345678901234567890",
        "fetch https://user:pw@cdn.example.com/a.mp3?Policy=abc#frag",
      ].join("\n"),
    };
    const text = formatReport({ version: "1", platform: "linux", packaged: false, compositor: "none" }, daemon, NOW);
    for (const leak of ["abcdef0123456789abcdef", "hunter2", "nuvo-core", "Private song", "denys", "Denys", "sk-live", "user:pw", "Policy=abc", "frag"]) {
      expect(text, leak).not.toContain(leak);
    }
    expect(text).toContain("~/.local/share/nuvo/db.sqlite");
    expect(text).toContain('"phase": "ok"');
  });

  const app = { version: "1", platform: "linux", packaged: false, compositor: "none" };
  const reportOf = (daemon: unknown) => formatReport(app, daemon, NOW);
  const logOf = (...lines: string[]) => reportOf({ phase: "ok", log: lines.join("\n") });

  it("keeps only known diagnostic fields", () => {
    const text = reportOf({
      phase: "ok",
      version: "1.2.3",
      uptimeSecs: 5,
      cache: { usedBytes: 1, limitBytes: 2, entries: 3, pinned: 0, covers: { bytes: 1, count: 1, limitBytes: 1 }, secretSauce: "x" },
      nowPlayingTitle: "Private song",
      userEmail: "a@b.c",
      cookies: "sid=1",
      extra: { nested: "surprise" },
      networkCheck: { checkedAt: "t", summary: "ok", rows: [{ check: "dns", ok: true, ms: 3, mystery: "m" }], proxyUrl: "socks5://u:pw@h:1" },
    });
    for (const gone of ["Private song", "a@b.c", "sid=1", "surprise", "mystery", "secretSauce", "socks5", "proxyUrl"]) expect(text, gone).not.toContain(gone);
    for (const kept of ['"phase": "ok"', '"usedBytes": 1', '"entries": 3', '"check": "dns"', '"summary": "ok"']) expect(text, kept).toContain(kept);
  });

  it("drops URL credentials of every scheme, including socks5 and an @ inside the password", () => {
    const text = logOf("proxy socks5://user:pw@10.0.0.1:1080", "via http://u:p@ss@host.example/x", "ftp://bob:secret@files.example/a");
    for (const leak of ["user:pw", "p@ss", "u:p", "bob", "secret@"]) expect(text, leak).not.toContain(leak);
    expect(text).toContain("socks5://10.0.0.1:1080");
  });

  it("redacts Authorization headers of any scheme, Proxy-Authorization and cookies", () => {
    const text = logOf(
      "Authorization: Basic dXNlcjpwdw==",
      'authorization: Digest username="u", response="abc123"',
      "Proxy-Authorization: NTLM TlRMTVNTUA==",
      "Cookie: sid=abc; other=def",
      'headers {"Authorization": "Token zzz999"}',
    );
    for (const leak of ["dXNlcjpwdw", "abc123", "TlRMTVNTUA", "sid=abc", "zzz999"]) expect(text, leak).not.toContain(leak);
    expect(text).toContain("Authorization: <redacted>");
  });

  it("redacts secret query parameters even outside a URL", () => {
    const text = logOf(
      "GET /v1/x?token=aaa111&ok=1",
      "retry ?api_key=bbb222",
      "sig=ccc333 session=ddd444",
      "https://h.example/a?X-Amz-Signature=eee555&Policy=fff666",
      "auth=ggg777; secret=hhh888",
    );
    for (const leak of ["aaa111", "bbb222", "ccc333", "ddd444", "eee555", "fff666", "ggg777", "hhh888"]) expect(text, leak).not.toContain(leak);
    expect(text).toContain("ok=1");
  });

  it("hides home-like paths of every platform", () => {
    const text = logOf(
      "/home/denys/a",
      "/Users/denys/b",
      "/media/denys/usb/c",
      "/run/media/denys/usb/d",
      "C:\\Users\\Denys\\e",
      "file:///home/denys/f",
      "D:\\Users\\Denys\\g",
    );
    expect(text.toLowerCase()).not.toContain("denys");
    expect(text).toContain("~/a");
  });

  it("hides now-playing titles in log lines", () => {
    const text = logOf(
      'now playing: "Secret Song" by Hidden Artist',
      "title=Another Secret",
      'resolve {"title":"Third Secret","artist":"Quiet Band"}',
      "Now playing Fourth Secret",
    );
    for (const leak of ["Secret Song", "Hidden Artist", "Another Secret", "Third Secret", "Quiet Band", "Fourth Secret"])
      expect(text, leak).not.toContain(leak);
  });
});

describe("issue link", () => {
  it("opens a new issue with the version and system, and the diagnostics only when chosen", () => {
    const url = new URL(issueUrl("0.2.10", "linux, wayland", null));
    expect(url.origin + url.pathname).toBe("https://github.com/Ziuziuk-Denys/nuvo/issues/new");
    const body = url.searchParams.get("body")!;
    expect(body).toContain("Nuvo 0.2.10 on linux, wayland");
    expect(body).not.toContain("Diagnostics");
    expect(new URL(issueUrl("0.2.10", "linux", "core ok")).searchParams.get("body")).toContain("```text\ncore ok\n```");
  });

  it("cuts long diagnostics so the link stays short enough for the browser", () => {
    const url = issueUrl("0.2.10", "linux", "x".repeat(50_000));
    expect(url.length).toBeLessThanOrEqual(7500);
    expect(new URL(url).searchParams.get("body")).toContain("…");
  });
});
