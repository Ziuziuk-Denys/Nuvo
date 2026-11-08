/** PO token minting and the TV identity, inside the worker document. */
import { COBALT_UA, CONTENT_REQUEST_KEY, PLAYER_PATH, UA_HEADER, WEB } from "../../../src/youtube/constants";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface Challenge {
  program: string;
  globalName: string;
  interpreterUrl?: string;
  interpreterJavascript?: string;
}

export interface Minter {
  mint(identifier: string): Promise<string>;
}

/** The BotGuard VM and minter, behind a seam so the flow runs under fakes. Production: bgutils-js. */
export interface BotGuard {
  snapshot(challenge: Challenge, interpreter: string): Promise<{ response: string; signalOutput: unknown[] }>;
  minter(integrityToken: string, ttlSecs: number, refreshSecs: number | undefined, signalOutput: unknown[]): Promise<Minter>;
}

export interface TokenEnv {
  fetch: FetchLike;
  /** Interpreter script text, downloaded by main (`nuvo-yt:script`). */
  loadInterpreter(url: string): Promise<string>;
  botguard: BotGuard;
  apiKey: string;
  now?: () => number;
}

export const DEFAULT_TTL_SECS = 6 * 60 * 60;
export const DEADLINE_MARGIN_MS = 10 * 60 * 1000;
export const MIN_LIFETIME_MS = 60 * 1000;

export function deadlineFor(now: number, ttlSecs: number | null | undefined): number {
  const ttl = ttlSecs && ttlSecs > 0 ? ttlSecs : DEFAULT_TTL_SECS;
  return Math.max(now + ttl * 1000 - DEADLINE_MARGIN_MS, now + MIN_LIFETIME_MS);
}

/** Reads a `bgChallenge` object in the shape YouTube sends it. */
export function readChallenge(raw: unknown): Challenge {
  const value = raw as Record<string, Record<string, string> | string | undefined> | undefined;
  const program = value?.program;
  const globalName = value?.globalName;
  if (typeof program !== "string" || typeof globalName !== "string") throw new Error("challenge without program or globalName");
  const url = (value?.interpreterUrl as Record<string, string> | undefined)?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  const script = (value?.interpreterJavascript as Record<string, string> | undefined)?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  return {
    program,
    globalName,
    interpreterUrl: url,
    interpreterJavascript: script,
  };
}

const websafe = (token: string) => token.replace(/\+/g, "-").replace(/\//g, "_");

/** Challenge → BotGuard → GenerateIT → minter; returns the minter with its deadline. */
async function createMinter(env: TokenEnv, challenge: Challenge, requestKey: string): Promise<{ minter: Minter; deadline: number }> {
  const interpreter =
    challenge.interpreterJavascript ??
    (challenge.interpreterUrl
      ? await env.loadInterpreter(challenge.interpreterUrl.startsWith("//") ? `https:${challenge.interpreterUrl}` : challenge.interpreterUrl)
      : undefined);
  if (!interpreter) throw new Error("challenge without interpreter");
  const { response, signalOutput } = await env.botguard.snapshot(challenge, interpreter);
  const answer = await env.fetch("https://www.youtube.com/api/jnn/v1/GenerateIT", {
    method: "POST",
    headers: {
      "content-type": "application/json+protobuf",
      "x-goog-api-key": env.apiKey,
      "x-user-agent": "grpc-web-javascript/0.1",
    },
    body: JSON.stringify([requestKey, response]),
  });
  if (!answer.ok) throw new Error(`GenerateIT answered ${answer.status}`);
  const [token, ttl, refresh] = (await answer.json()) as [string | null, number?, number?];
  if (typeof token !== "string" || !token) throw new Error("GenerateIT returned no integrity token");
  const minter = await env.botguard.minter(websafe(token), ttl ?? DEFAULT_TTL_SECS, refresh, signalOutput);
  return { minter, deadline: deadlineFor((env.now ?? Date.now)(), ttl) };
}

/** One value with a deadline, created single flight; a failure or an expired deadline goes back to empty. */
class Slot<T> {
  private current: { value: T; deadline: number } | null = null;
  private creating: Promise<{ value: T; deadline: number }> | null = null;

  constructor(
    private readonly create: () => Promise<{ value: T; deadline: number }>,
    private readonly now: () => number,
  ) {}

  async get(): Promise<T> {
    if (this.current && this.now() < this.current.deadline) return this.current.value;
    this.current = null;
    this.creating ??= this.create().finally(() => (this.creating = null));
    const created = await this.creating;
    this.current = created;
    return created.value;
  }

  drop(): void {
    this.current = null;
  }
}

export class ContentTokens {
  private slot: Slot<Minter>;

  constructor(env: TokenEnv) {
    this.slot = new Slot(async () => {
      const answer = await env.fetch("https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          context: {
            client: {
              clientName: WEB.clientName,
              clientVersion: WEB.clientVersion,
              hl: "en",
              gl: "US",
            },
          },
          engagementType: "ENGAGEMENT_TYPE_UNBOUND",
        }),
      });
      if (!answer.ok) throw new Error(`att/get answered ${answer.status}`);
      const body = (await answer.json()) as { bgChallenge?: unknown };
      const { minter, deadline } = await createMinter(env, readChallenge(body.bgChallenge), CONTENT_REQUEST_KEY);
      return { value: minter, deadline };
    }, env.now ?? Date.now);
  }

  async mint(identifier: string): Promise<string> {
    const minter = await this.slot.get();
    try {
      return await minter.mint(identifier);
    } catch (error) {
      this.slot.drop();
      throw error;
    }
  }
}

export interface TvIdentity {
  token: string;
  livingRoomId: string;
  visitor: string;
  version: string;
  scriptId: string;
  signatureTimestamp: number;
}

/** A JSON string body as it appears in the page, with escapes such as `=` resolved. */
const unescape = (raw: string) => JSON.parse(`"${raw}"`) as string;

function pageField(page: string, name: string): string {
  const match = page.match(new RegExp(`"${name}":"((?:[^"\\\\]|\\\\.)*)"`));
  if (!match) throw new Error(`TV page has no ${name}`);
  return unescape(match[1]);
}

export class TvIdentities {
  private slot: Slot<TvIdentity>;

  constructor(env: TokenEnv, timestamp: (playerId: string) => Promise<number>) {
    const cobalt = { [UA_HEADER]: COBALT_UA };
    this.slot = new Slot(async () => {
      const pageResponse = await env.fetch("https://www.youtube.com/tv", {
        headers: cobalt,
      });
      if (!pageResponse.ok) throw new Error(`/tv answered ${pageResponse.status}`);
      const page = await pageResponse.text();
      const livingRoomId = pageField(page, "LIVING_ROOM_PO_TOKEN_ID");
      const visitor = pageField(page, "visitorData");
      const version = pageField(page, "INNERTUBE_CLIENT_VERSION");
      const scriptId = page.match(PLAYER_PATH)?.[1];
      if (!scriptId) throw new Error("TV page has no player script path");
      const configResponse = await env.fetch("https://www.youtube.com/tv_config?action_get_config=true&client=lb4&theme=cl", { headers: cobalt });
      if (!configResponse.ok) throw new Error(`tv_config answered ${configResponse.status}`);
      const config = await configResponse.text();
      const requestKey = pageField(config, "challengeRequestKey");
      const encoded = config.match(/"challengeParams":\{"R":"((?:[^"\\]|\\.)*)"/)?.[1];
      if (!encoded) throw new Error("tv_config has no challengeParams");
      const challenge = readChallenge((JSON.parse(unescape(encoded)) as { bgChallenge?: unknown }).bgChallenge);
      const { minter, deadline } = await createMinter(env, challenge, requestKey);
      const [token, signatureTimestamp] = await Promise.all([minter.mint(livingRoomId), timestamp(scriptId)]);
      return {
        value: {
          token,
          livingRoomId,
          visitor,
          version,
          scriptId,
          signatureTimestamp,
        },
        deadline,
      };
    }, env.now ?? Date.now);
  }

  get(): Promise<TvIdentity> {
    return this.slot.get();
  }
}
