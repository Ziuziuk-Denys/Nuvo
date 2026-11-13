import { describe, expect, it } from "vitest";
import {
  bridgeOf,
  chromiumProxy,
  chromiumRule,
  credentialsOf,
  detectSystemProxy,
  envProxy,
  gnomeProxy,
  kdeProxy,
  networkBody,
  pacToUrl,
  withCredentials,
} from "./proxy";

describe("pacToUrl", () => {
  it("reads what session.resolveProxy answers", () => {
    expect(pacToUrl("DIRECT")).toBeNull();
    expect(pacToUrl("PROXY 10.0.0.1:3128; DIRECT")).toBe("http://10.0.0.1:3128");
    expect(pacToUrl("HTTPS proxy.lan:443")).toBe("https://proxy.lan:443");
    expect(pacToUrl("SOCKS5 127.0.0.1:1080")).toBe("socks5://127.0.0.1:1080");
    expect(pacToUrl("SOCKS 127.0.0.1:1080")).toBe("socks5://127.0.0.1:1080");
    expect(pacToUrl("QUIC a:1")).toBeNull();
  });
});

describe("envProxy", () => {
  it("takes the https variable first, in either case, and adds a missing scheme", () => {
    expect(envProxy({ HTTP_PROXY: "http://a:1", https_proxy: "http://b:2" })).toBe("http://b:2");
    expect(envProxy({ ALL_PROXY: "socks5h://127.0.0.1:9050" })).toBe("socks5h://127.0.0.1:9050");
    expect(envProxy({ http_proxy: "127.0.0.1:8080" })).toBe("http://127.0.0.1:8080");
    expect(envProxy({ HTTPS_PROXY: "http://user:p%40ss@a:1" })).toBe("http://user:p%40ss@a:1");
  });

  it("ignores what the daemon could not use", () => {
    expect(envProxy({})).toBeNull();
    expect(envProxy({ ALL_PROXY: "socks4://a:1" })).toBeNull();
    expect(envProxy({ HTTPS_PROXY: "http://noport" })).toBeNull();
    expect(envProxy({ HTTPS_PROXY: "" })).toBeNull();
  });
});

describe("gnomeProxy", () => {
  const listing = (mode: string, https = "''", port = 0, socks = "''", socksPort = 0) =>
    `org.gnome.system.proxy mode '${mode}'\norg.gnome.system.proxy.http host '10.0.0.2'\norg.gnome.system.proxy.http port 3128\norg.gnome.system.proxy.https host ${https}\norg.gnome.system.proxy.https port ${port}\norg.gnome.system.proxy.socks host ${socks}\norg.gnome.system.proxy.socks port ${socksPort}\n`;

  it("reads a manual proxy, https before http before socks", () => {
    expect(gnomeProxy(listing("manual"))).toBe("http://10.0.0.2:3128");
    expect(gnomeProxy(listing("manual", "'10.0.0.3'", 8443))).toBe("http://10.0.0.3:8443");
  });

  it("is silent unless the mode is manual", () => {
    expect(gnomeProxy(listing("none"))).toBeNull();
    expect(gnomeProxy(listing("auto"))).toBeNull();
    expect(gnomeProxy(null)).toBeNull();
  });

  it("falls to socks when only socks is set", () => {
    const text = `org.gnome.system.proxy mode 'manual'\norg.gnome.system.proxy.socks host '127.0.0.1'\norg.gnome.system.proxy.socks port 10808\n`;
    expect(gnomeProxy(text)).toBe("socks5://127.0.0.1:10808");
  });
});

describe("kdeProxy", () => {
  it("reads manual proxies in KDE's space or colon form", () => {
    expect(kdeProxy("[Proxy Settings]\nProxyType=1\nhttpProxy=http://10.0.0.2 3128\n")).toBe("http://10.0.0.2:3128");
    expect(kdeProxy("[Proxy Settings]\nProxyType=1\nhttpsProxy=http://10.0.0.3:8443\nhttpProxy=http://a 1\n")).toBe("http://10.0.0.3:8443");
    expect(kdeProxy("[Proxy Settings]\nProxyType=1\nsocksProxy=socks://127.0.0.1 1080\n")).toBe("socks5://127.0.0.1:1080");
  });

  it("is silent for any other type and other sections", () => {
    expect(kdeProxy("[Proxy Settings]\nProxyType=0\nhttpProxy=http://a 1\n")).toBeNull();
    expect(kdeProxy("[Other]\nProxyType=1\nhttpProxy=http://a 1\n")).toBeNull();
    expect(kdeProxy(null)).toBeNull();
  });
});

describe("detectSystemProxy", () => {
  const sources = (over: Partial<Parameters<typeof detectSystemProxy>[0]> = {}) => ({
    resolve: async () => "DIRECT",
    env: {},
    gsettings: async () => null,
    kioslaverc: async () => null,
    ...over,
  });

  it("direct when nothing is set", async () => {
    await expect(detectSystemProxy(sources())).resolves.toEqual({ url: null, chromiumSees: false });
  });

  it("Chromium's answer first, keeping credentials only the environment has", async () => {
    await expect(detectSystemProxy(sources({ resolve: async () => "PROXY a:1" }))).resolves.toEqual({ url: "http://a:1", chromiumSees: true });
    await expect(detectSystemProxy(sources({ resolve: async () => "PROXY a:1", env: { HTTPS_PROXY: "http://u:p@a:1" } }))).resolves.toEqual({
      url: "http://u:p@a:1",
      chromiumSees: true,
    });
  });

  it("then the environment, GNOME and KDE, which Chromium must be told about", async () => {
    await expect(detectSystemProxy(sources({ env: { ALL_PROXY: "socks5://b:2" } }))).resolves.toEqual({ url: "socks5://b:2", chromiumSees: false });
    const gnome = "org.gnome.system.proxy mode 'manual'\norg.gnome.system.proxy.http host 'c'\norg.gnome.system.proxy.http port 3\n";
    await expect(detectSystemProxy(sources({ gsettings: async () => gnome }))).resolves.toEqual({ url: "http://c:3", chromiumSees: false });
    await expect(detectSystemProxy(sources({ kioslaverc: async () => "[Proxy Settings]\nProxyType=1\nhttpProxy=http://d 4\n" }))).resolves.toEqual({
      url: "http://d:4",
      chromiumSees: false,
    });
  });

  it("a failing reader counts as nothing set", async () => {
    await expect(
      detectSystemProxy(sources({ resolve: () => Promise.reject(new Error("gone")), gsettings: () => Promise.reject(new Error("no gsettings")) })),
    ).resolves.toEqual({ url: null, chromiumSees: false });
  });
});

describe("what goes where", () => {
  it("the daemon hears exactly the field its route accepts", () => {
    expect(networkBody("socks5://127.0.0.1:1080")).toBe('{"proxyUrl":"socks5://127.0.0.1:1080"}');
    expect(networkBody(null)).toBe('{"proxyUrl":null}');
  });

  it("Chromium gets no credentials and no socks5h, which it does not parse", () => {
    expect(chromiumRule("socks5h://127.0.0.1:1080")).toBe("socks5://127.0.0.1:1080");
    expect(chromiumRule("http://u:p@a:1")).toBe("http://a:1");
  });

  it("credentials are percent-encoded into the daemon URL and read back whole", () => {
    const url = withCredentials("http://a:1", "me@work", "p:ss/word");
    expect(url).toBe("http://me%40work:p%3Ass%2Fword@a:1");
    expect(credentialsOf(url)).toEqual({ username: "me@work", password: "p:ss/word" });
    expect(withCredentials("http://a:1", undefined, undefined)).toBe("http://a:1");
    expect(credentialsOf("http://a:1")).toBeNull();
    expect(credentialsOf(null)).toBeNull();
  });

  it("a SOCKS proxy with a login reaches Chromium through the bridge, never direct", () => {
    const base: Electron.ProxyConfig = { proxyRules: "socks5://a:1", proxyBypassRules: "<local>" };
    const bridge = "http://nuvo:t0k3n@127.0.0.1:40123";
    expect(chromiumProxy(base, "socks5h://me:pw@a:1", bridge)).toEqual({ proxyRules: "http://127.0.0.1:40123", proxyBypassRules: "<local>" });
    expect(chromiumProxy({ mode: "system" }, "socks5://me:pw@a:1", null)).toEqual({ proxyRules: "socks5://a:1", proxyBypassRules: "<local>" });
    expect(chromiumProxy(base, "socks5://a:1", bridge)).toBe(base);
    expect(chromiumProxy(base, "http://me:pw@a:1", bridge)).toBe(base);
    expect(chromiumProxy({ mode: "direct" }, null, null)).toEqual({ mode: "direct" });
  });

  it("only a loopback bridge URL from the daemon is taken", () => {
    expect(bridgeOf('{"bridgeUrl":"http://nuvo:t0k3n@127.0.0.1:40123"}')).toBe("http://nuvo:t0k3n@127.0.0.1:40123");
    expect(bridgeOf('{"bridgeUrl":null}')).toBeNull();
    expect(bridgeOf('{"bridgeUrl":"http://nuvo:t@10.0.0.2:1"}')).toBeNull();
    expect(bridgeOf('{"bridgeUrl":"http://127.0.0.1:1"}')).toBeNull();
    expect(bridgeOf("not json")).toBeNull();
  });
});
