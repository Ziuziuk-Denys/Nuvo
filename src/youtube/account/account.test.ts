import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { YtAccount } from "./index";
import { loadCredentials } from "./oauth";
import { LEGACY_PREFERENCES_KEY, LEGACY_SESSION_KEY, migrateLegacy, type StoredSession } from "./store";
import { MemoryStore } from "../test/memoryStore";
import { json, text } from "../test/fakeFetch";
import { harness, signal } from "../test/harness";

const TOKEN = "https://www.youtube.com/o/oauth2/token";
const DEVICE = "https://www.youtube.com/o/oauth2/device/code";

function credentialRoutes(fake: ReturnType<typeof harness>["fake"]) {
  fake.on("GET", "https://www.youtube.com/tv", text(`<script src="/s/_/kabuki/_/js/k=abc/m=base"></script>`));
  fake.on("GET", "https://www.youtube.com/s/_/kabuki/_/js/k=abc/m=base", text(`a={clientId:"cid",x:"secret"}`));
}

async function setup(session: StoredSession | null = null) {
  const h = harness();
  credentialRoutes(h.fake);
  const store = new MemoryStore();
  store.session = session;
  const account = new YtAccount({ fetch: h.fake.fetch, yt: h.yt, store });
  await account.init();
  return { ...h, store, account };
}

const tokens = (extra: Record<string, unknown> = {}) =>
  json({
    access_token: "AT2",
    refresh_token: "RT2",
    expires_in: 3600,
    token_type: "Bearer",
    ...extra,
  });
const deviceAnswer = (extra: Record<string, unknown> = {}) =>
  json({
    device_code: "DC",
    user_code: "ABC-DEF",
    verification_url: "https://www.google.com/device",
    expires_in: 900,
    interval: 7,
    ...extra,
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => vi.useRealTimers());

describe("sign-in", () => {
  it("credentials come from the TV base script, fetched with the Cobalt agent", async () => {
    const { fake } = harness();
    credentialRoutes(fake);
    expect(await loadCredentials(fake.fetch)).toEqual({
      clientId: "cid",
      clientSecret: "secret",
    });
    expect(fake.calls.map((call) => call.url)).toEqual(["https://www.youtube.com/tv", "https://www.youtube.com/s/_/kabuki/_/js/k=abc/m=base"]);
    for (const call of fake.calls) expect(call.headers["x-nuvo-ua"]).toContain("Cobalt");
  });

  it("the device code times and links", async () => {
    const { fake, account } = await setup();
    fake.on("POST", DEVICE, deviceAnswer());
    const code = await account.beginSignIn(signal());
    expect(code).toEqual({
      shownCode: "ABC-DEF",
      verifyLink: "https://www.google.com/device",
      verifyLinkWithCode: "https://www.google.com/device?user_code=ABC-DEF",
      validUntilMs: 900_000,
      pollEveryMs: 7000,
    });
    expect(fake.callsTo("POST", DEVICE)[0].json()).toMatchObject({
      client_id: "cid",
      device_model: "ytlr::",
    });
  });

  it("a device answer without user_code is device_code", async () => {
    const { fake, account } = await setup();
    fake.on(
      "POST",
      DEVICE,
      json({
        device_code: "DC",
        verification_url: "https://www.google.com/device",
      }),
    );
    await expect(account.beginSignIn(signal())).rejects.toMatchObject({
      code: "auth:device_code",
    });
  });

  it("pending twice, then tokens: three polls spaced by the interval", async () => {
    const { fake, account, store } = await setup();
    fake.on("POST", DEVICE, deviceAnswer());
    fake.on("POST", TOKEN, [json({ error: "authorization_pending" }), json({ error: "authorization_pending" }), tokens()]);
    const changes = vi.fn();
    account.onChange(changes);
    const done = account.awaitSignIn(await account.beginSignIn(signal()), signal());
    await vi.advanceTimersByTimeAsync(6999);
    expect(fake.callsTo("POST", TOKEN)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1 + 7000 + 7000);
    await done;
    expect(fake.callsTo("POST", TOKEN)).toHaveLength(3);
    expect(store.session).toMatchObject({
      accessToken: "AT2",
      refreshToken: "RT2",
      tokenType: "Bearer",
    });
    expect(account.status()).toBe(true);
    expect(changes).toHaveBeenCalledOnce();
  });

  it("slow_down adds 5 s to the following polls", async () => {
    const { fake, account } = await setup();
    fake.on("POST", DEVICE, deviceAnswer());
    fake.on("POST", TOKEN, [json({ error: "slow_down" }), json({ error: "authorization_pending" }), tokens()]);
    const done = account.awaitSignIn(await account.beginSignIn(signal()), signal());
    await vi.advanceTimersByTimeAsync(7000);
    expect(fake.callsTo("POST", TOKEN)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(11_999);
    expect(fake.callsTo("POST", TOKEN)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.callsTo("POST", TOKEN)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(12_000);
    await done;
  });

  it("access_denied ends the flow", async () => {
    const { fake, account } = await setup();
    fake.on("POST", DEVICE, deviceAnswer());
    fake.on("POST", TOKEN, json({ error: "access_denied" }));
    const done = account.awaitSignIn(await account.beginSignIn(signal()), signal());
    const check = expect(done).rejects.toMatchObject({
      code: "auth:access_denied",
    });
    await vi.advanceTimersByTimeAsync(7000);
    await check;
  });

  it("passing validUntilMs ends with expired_token", async () => {
    const { fake, account } = await setup();
    fake.on("POST", DEVICE, deviceAnswer({ expires_in: 10, interval: 7 }));
    fake.on("POST", TOKEN, json({ error: "authorization_pending" }));
    const done = account.awaitSignIn(await account.beginSignIn(signal()), signal());
    const check = expect(done).rejects.toMatchObject({
      code: "auth:expired_token",
    });
    await vi.advanceTimersByTimeAsync(14_000);
    await check;
  });
});

describe("tokens", () => {
  const expiring = (inMs: number): StoredSession => ({
    accessToken: "AT1",
    refreshToken: "RT1",
    tokenType: "Bearer",
    expiresAt: Date.now() + inMs,
  });

  it("three concurrent calls near expiry share one refresh", async () => {
    const { fake, account } = await setup(expiring(30_000));
    fake.on("POST", TOKEN, tokens());
    const headers = await Promise.all([account.authorization(), account.authorization(), account.authorization()]);
    expect(headers).toEqual(["Bearer AT2", "Bearer AT2", "Bearer AT2"]);
    expect(fake.callsTo("POST", TOKEN)).toHaveLength(1);
    expect(fake.callsTo("POST", TOKEN)[0].json()).toMatchObject({
      refresh_token: "RT1",
      grant_type: "refresh_token",
      client_secret: "secret",
    });
  });

  it("a refresh without refresh_token keeps the stored one", async () => {
    const { fake, account, store } = await setup(expiring(30_000));
    fake.on("POST", TOKEN, json({ access_token: "AT2", expires_in: 3600 }));
    await account.authorization();
    expect(store.session?.refreshToken).toBe("RT1");
  });

  it("invalid_grant signs out; temporarily_unavailable keeps the tokens", async () => {
    const revoked = await setup(expiring(30_000));
    revoked.fake.on("POST", TOKEN, json({ error: "invalid_grant" }, 400));
    const changes = vi.fn();
    revoked.account.onChange(changes);
    await expect(revoked.account.authorization()).rejects.toMatchObject({
      code: "auth:invalid_grant",
    });
    expect([revoked.account.status(), revoked.store.session]).toEqual([false, null]);
    expect(changes).toHaveBeenCalled();

    const busy = await setup(expiring(30_000));
    busy.fake.on("POST", TOKEN, json({ error: "temporarily_unavailable" }, 503));
    await expect(busy.account.authorization()).rejects.toMatchObject({
      code: "auth:temporarily_unavailable",
    });
    expect(busy.store.session?.refreshToken).toBe("RT1");
    expect(busy.account.status()).toBe(true);
  });

  it("tokens with HTTP 500 are http_500", async () => {
    const { fake, account } = await setup(expiring(30_000));
    fake.on("POST", TOKEN, json({ access_token: "AT2", refresh_token: "RT2" }, 500));
    await expect(account.authorization()).rejects.toMatchObject({
      code: "auth:http_500",
    });
  });

  it("disconnect: signed out at once, onChange, revoke attempted, never rejects", async () => {
    const { fake, account } = await setup(expiring(3_600_000));
    fake.on("POST", "https://www.youtube.com/o/oauth2/revoke?token=RT1", () => {
      throw new TypeError("offline");
    });
    const changes = vi.fn();
    account.onChange(changes);
    const pending = account.disconnect();
    expect(account.status()).toBe(false);
    await expect(pending).resolves.toBeUndefined();
    expect(changes).toHaveBeenCalledOnce();
    expect(fake.callsTo("POST", "https://www.youtube.com/o/oauth2/revoke")).toHaveLength(1);
  });

  it("review focus: a refresh while offline fails and keeps the tokens", async () => {
    const { fake, account, store } = await setup(expiring(30_000));
    fake.on("POST", TOKEN, () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(account.authorization()).rejects.toMatchObject({
      code: "unreachable",
    });
    expect(store.session?.refreshToken).toBe("RT1");
    expect(account.status()).toBe(true);
  });

  it("a fresh token is used without any request", async () => {
    const { fake, account } = await setup(expiring(3_600_000));
    expect(await account.authorization()).toBe("Bearer AT1");
    expect(fake.calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });
});

describe("migration", () => {
  it("old keys move to the encrypted store once", async () => {
    const values = new Map<string, string>([
      [
        LEGACY_SESSION_KEY,
        JSON.stringify({
          accessToken: "A",
          refreshToken: "R",
          tokenType: "Bearer",
          expiresAt: 5,
        }),
      ],
      [
        LEGACY_PREFERENCES_KEY,
        JSON.stringify({
          state: {
            accountPlayback: true,
            promptSignIn: true,
            syncLibrary: false,
          },
          version: 0,
        }),
      ],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => void values.delete(key),
    };
    const store = new MemoryStore();
    await migrateLegacy(storage, store);
    await migrateLegacy(storage, store);
    expect(store.session).toEqual({
      accessToken: "A",
      refreshToken: "R",
      tokenType: "Bearer",
      expiresAt: 5,
    });
    expect(store.preferences).toEqual({
      playThroughAccount: true,
      offerSignIn: true,
      showAccountPlaylists: false,
    });
    expect(values.size).toBe(0);
    expect(store.saves).toBe(1);
  });

  it("a failing store keeps the old key for the next start", async () => {
    const values = new Map([[LEGACY_SESSION_KEY, JSON.stringify({ accessToken: "A", refreshToken: "R", expiresAt: 5 })]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => void values.delete(key),
    };
    const store = new MemoryStore();
    store.saveSession = async () => {
      throw new Error("daemon starting");
    };
    await expect(migrateLegacy(storage, store)).rejects.toThrow("daemon starting");
    expect(values.has(LEGACY_SESSION_KEY)).toBe(true);
  });
});

describe("fix round", () => {
  const expiring = (inMs: number): StoredSession => ({
    accessToken: "AT1",
    refreshToken: "RT1",
    tokenType: "Bearer",
    expiresAt: Date.now() + inMs,
  });

  it("disconnect during a refresh wins: the late tokens are never saved", async () => {
    const { fake, account, store } = await setup(expiring(30_000));
    let release: (response: Response) => void = () => undefined;
    fake.on("POST", TOKEN, () => new Promise<Response>((resolve) => (release = resolve)));
    fake.on("POST", "https://www.youtube.com/o/oauth2/revoke*", json({}));
    const pending = account.authorization();
    await vi.advanceTimersByTimeAsync(0);
    await account.disconnect();
    release(tokens());
    expect(await pending).toBeNull();
    expect(store.session).toBeNull();
    expect(account.status()).toBe(false);
  });

  it("one caller's abort does not fail the other credential lookups", async () => {
    const h = harness();
    credentialRoutes(h.fake);
    const store = new MemoryStore();
    const account = new YtAccount({ fetch: h.fake.fetch, yt: h.yt, store });
    await account.init();
    h.fake.on("POST", DEVICE, deviceAnswer());
    const aborted = new AbortController();
    const first = account.beginSignIn(aborted.signal);
    const second = account.beginSignIn(signal());
    aborted.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toMatchObject({ shownCode: "ABC-DEF" });
  });

  it("a failing dropSession is retried once and then reported", async () => {
    const { account, store } = await setup(expiring(3_600_000));
    let attempts = 0;
    store.dropSession = async () => {
      attempts += 1;
      throw new Error("daemon down");
    };
    await account.disconnect();
    expect(attempts).toBe(2);
    expect(account.status()).toBe(false);
    expect(account.signOutIncomplete()).toBe(true);
  });

  it("revoke gives up after 10 s", async () => {
    const { fake, account } = await setup(expiring(3_600_000));
    fake.on("POST", "https://www.youtube.com/o/oauth2/revoke*", () => new Promise<Response>(() => undefined));
    let done = false;
    const pending = account.disconnect().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toBe(true);
  });

  it("polling survives up to three transient network errors in a row", async () => {
    const { fake, account } = await setup();
    fake.on("POST", DEVICE, deviceAnswer());
    let calls = 0;
    fake.on("POST", TOKEN, () => {
      calls += 1;
      if (calls <= 3) throw new TypeError("Failed to fetch");
      return tokens();
    });
    const done = account.awaitSignIn(await account.beginSignIn(signal()), signal());
    await vi.advanceTimersByTimeAsync(7000 * 4);
    await done;
    expect(account.status()).toBe(true);
  });

  it("a fourth consecutive network error ends the sign-in", async () => {
    const { fake, account } = await setup();
    fake.on("POST", DEVICE, deviceAnswer());
    fake.on("POST", TOKEN, () => {
      throw new TypeError("Failed to fetch");
    });
    const done = account.awaitSignIn(await account.beginSignIn(signal()), signal());
    const check = expect(done).rejects.toMatchObject({ code: "unreachable" });
    await vi.advanceTimersByTimeAsync(7000 * 4);
    await check;
  });
});
