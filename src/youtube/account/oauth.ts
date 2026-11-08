/**
 * TV device-flow sign-in on YouTube's own OAuth endpoints. The credential lookup is
 * own code (about fifteen lines) so youtubei.js stays out of the renderer.
 */
import { COBALT_UA, UA_HEADER, WWW_ORIGIN } from "../constants";
import type { FetchLike } from "../http";
import { YtError, abortError, type DeviceCode } from "../types";
import type { StoredSession } from "./store";

export const SCOPE = "http://gdata.youtube.com https://www.googleapis.com/auth/youtube-paid-content";
export const DEVICE_GRANT = "http://oauth.net/grant_type/device/1.0";
export const DEFAULT_CODE_SECS = 1800;
export const DEFAULT_INTERVAL_SECS = 5;
export const SLOW_DOWN_MS = 5000;
export const DEFAULT_TOKEN_SECS = 3600;
export const MAX_POLL_FAILURES = 3;
export const REVOKE_TIMEOUT_MS = 10_000;

export interface Credentials {
  clientId: string;
  clientSecret: string;
}

/** Reads the TV app's public client id and secret from its base script. */
export async function loadCredentials(fetchFn: FetchLike, signal?: AbortSignal): Promise<Credentials> {
  const headers = { [UA_HEADER]: COBALT_UA };
  const page = await fetchFn(`${WWW_ORIGIN}/tv`, { headers, signal });
  if (!page.ok) throw new YtError("auth:credentials", { status: page.status });
  const path = (await page.text()).match(/(\/s\/_\/kabuki\/_\/js\/[^"'\s]*?m=base)/)?.[1];
  if (!path) throw new YtError("auth:credentials", { text: "TV base script not found" });
  const script = await fetchFn(new URL(path, WWW_ORIGIN).toString(), {
    headers,
    signal,
  });
  if (!script.ok) throw new YtError("auth:credentials", { status: script.status });
  const match = (await script.text()).match(/clientId:"([^"]+)",[\w$]+:"([^"]+)"/);
  if (!match)
    throw new YtError("auth:credentials", {
      text: "client credentials not found",
    });
  return { clientId: match[1], clientSecret: match[2] };
}

/** Device codes stay inside the module; callers only see what they show. */
const deviceCodes = new WeakMap<DeviceCode, string>();

async function postJson(
  fetchFn: FetchLike,
  url: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ status: number; ok: boolean; json: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw new YtError("unreachable", { status: 0, text: String(error) });
  }
  let json: Record<string, unknown> = {};
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: response.status, ok: response.ok, json };
}

export async function requestDeviceCode(fetchFn: FetchLike, credentials: Credentials, signal?: AbortSignal): Promise<DeviceCode> {
  const answer = await postJson(
    fetchFn,
    `${WWW_ORIGIN}/o/oauth2/device/code`,
    {
      client_id: credentials.clientId,
      scope: SCOPE,
      device_id: crypto.randomUUID(),
      device_model: "ytlr::",
    },
    signal,
  );
  const json = answer.json;
  if (typeof json.error === "string") throw new YtError(`auth:${json.error}`);
  if (typeof json.device_code !== "string" || typeof json.user_code !== "string" || typeof json.verification_url !== "string")
    throw new YtError("auth:device_code");
  const code: DeviceCode = {
    shownCode: json.user_code,
    verifyLink: json.verification_url,
    verifyLinkWithCode: `${json.verification_url}?user_code=${encodeURIComponent(json.user_code)}`,
    validUntilMs: Date.now() + (Number(json.expires_in) || DEFAULT_CODE_SECS) * 1000,
    pollEveryMs: (Number(json.interval) || DEFAULT_INTERVAL_SECS) * 1000,
  };
  deviceCodes.set(code, json.device_code);
  return code;
}

/** Token answers: an `error` field wins, then missing tokens, then a non-2xx status. */
export function readTokens(answer: { status: number; ok: boolean; json: Record<string, unknown> }, previousRefresh?: string): StoredSession {
  const json = answer.json;
  if (typeof json.error === "string") throw new YtError(`auth:${json.error}`);
  const refreshToken = typeof json.refresh_token === "string" && json.refresh_token ? json.refresh_token : previousRefresh;
  if (typeof json.access_token !== "string" || !json.access_token || !refreshToken) throw new YtError("auth:invalid_response");
  if (!answer.ok) throw new YtError(`auth:http_${answer.status}`);
  return {
    accessToken: json.access_token,
    refreshToken,
    tokenType: typeof json.token_type === "string" && json.token_type ? json.token_type : "Bearer",
    expiresAt: Date.now() + (Number(json.expires_in) || DEFAULT_TOKEN_SECS) * 1000,
    ...(typeof json.scope === "string" ? { scope: json.scope } : {}),
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Polls until the user approves; `authorization_pending` waits, `slow_down` adds 5 s for the rest of the flow. */
export async function pollForTokens(fetchFn: FetchLike, credentials: Credentials, code: DeviceCode, signal: AbortSignal): Promise<StoredSession> {
  const deviceCode = deviceCodes.get(code);
  if (!deviceCode) throw new YtError("auth:device_code");
  let interval = code.pollEveryMs;
  let failures = 0;
  for (;;) {
    await sleep(interval, signal);
    if (Date.now() >= code.validUntilMs) throw new YtError("auth:expired_token");
    let answer;
    try {
      answer = await postJson(
        fetchFn,
        `${WWW_ORIGIN}/o/oauth2/token`,
        {
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          code: deviceCode,
          grant_type: DEVICE_GRANT,
        },
        signal,
      );
    } catch (error) {
      // A short network drop retries at the next interval; a longer one ends the sign-in.
      if (error instanceof YtError && error.code === "unreachable" && (failures += 1) <= MAX_POLL_FAILURES) continue;
      throw error;
    }
    failures = 0;
    if (answer.json.error === "authorization_pending") continue;
    if (answer.json.error === "slow_down") {
      interval += SLOW_DOWN_MS;
      continue;
    }
    return readTokens(answer);
  }
}

export async function refreshTokens(fetchFn: FetchLike, credentials: Credentials, session: StoredSession, signal?: AbortSignal): Promise<StoredSession> {
  const answer = await postJson(
    fetchFn,
    `${WWW_ORIGIN}/o/oauth2/token`,
    {
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: session.refreshToken,
      grant_type: "refresh_token",
    },
    signal,
  );
  const next = readTokens(answer, session.refreshToken);
  return { ...next, scope: next.scope ?? session.scope };
}

/** Rejects with an abort error as soon as `signal` fires, without cancelling the shared work behind `work`. */
export function raceAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** Best effort: gives up after ten seconds so a sign-out never hangs. */
export async function revoke(fetchFn: FetchLike, refreshToken: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVOKE_TIMEOUT_MS);
  try {
    await raceAbort(
      fetchFn(`${WWW_ORIGIN}/o/oauth2/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST", signal: controller.signal }),
      controller.signal,
    );
  } finally {
    clearTimeout(timer);
  }
}
