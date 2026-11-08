/** Visitor data and the InnerTube request rules shared by every call. */
import { UA_HEADER, WEB_REMIX, WWW_ORIGIN, type ClientContext } from "./constants";
import { YtError, abortError, isAbortError } from "./types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const VISITOR_TTL_MS = 5.5 * 60 * 60 * 1000;
const VISITOR_PATTERN = /Cg[stuv][A-Za-z0-9_-]{20,}(?:=|%3D){0,2}/;
const VISITOR_LOG_EVERY_MS = 60 * 60 * 1000;

/** Reads the visitor data string from a `sw.js_data` body. Padding is kept exactly as received. */
export function parseVisitorData(body: string): string | null {
  const stripped = body.startsWith(")]}'") ? body.slice(body.indexOf("\n") + 1) : body;
  try {
    const value = (JSON.parse(stripped) as unknown[][][][][])[0]?.[2]?.[0]?.[0]?.[13];
    if (typeof value === "string" && new RegExp(`^${VISITOR_PATTERN.source}$`).test(value)) return value;
  } catch {
    // shape changed: fall back to the pattern below
  }
  return body.match(VISITOR_PATTERN)?.[0] ?? null;
}

export class VisitorData {
  private value: string | null = null;
  private fetchedAt = 0;
  private inflight: Promise<string | null> | null = null;
  private lastLogAt = -Infinity;

  constructor(
    private readonly fetchFn: FetchLike,
    private readonly log: (message: string) => void = () => undefined,
  ) {}

  /** Never throws: a failed refresh keeps the previous value, and no value means requests go without one. */
  get(): Promise<string | null> {
    if (this.value && Date.now() - this.fetchedAt < VISITOR_TTL_MS) return Promise.resolve(this.value);
    this.inflight ??= this.refresh().finally(() => (this.inflight = null));
    return this.inflight;
  }

  reset(): void {
    this.value = null;
    this.fetchedAt = 0;
  }

  private async refresh(): Promise<string | null> {
    try {
      const response = await this.fetchFn(`${WWW_ORIGIN}/sw.js_data`);
      if (!response.ok) throw new Error(`sw.js_data answered ${response.status}`);
      const value = parseVisitorData(await response.text());
      if (!value) throw new Error("sw.js_data has no visitor data");
      this.value = value;
      this.fetchedAt = Date.now();
    } catch (error) {
      if (Date.now() - this.lastLogAt >= VISITOR_LOG_EVERY_MS) {
        this.lastLogAt = Date.now();
        this.log(`[youtube] visitor data refresh failed: ${String(error)}`);
      }
    }
    return this.value;
  }
}

export interface CallOptions {
  client?: ClientContext;
  signal?: AbortSignal;
  /** `"<type> <token>"` for the signed-in TV client. */
  authorization?: string;
  /** Overrides the shared visitor data (the TV identity brings its own). */
  visitorData?: string;
  /** Extra fields merged into `context.client`. */
  clientExtra?: Record<string, unknown>;
}

export class Innertube {
  constructor(
    private readonly fetchFn: FetchLike,
    readonly visitor: VisitorData,
    private readonly locale: { hl: string; gl: string } = {
      hl: "en",
      gl: "US",
    },
  ) {}

  /** One InnerTube call with the shared rules: one retry on 401/403 with fresh visitor data, typed errors. */
  async call<T = unknown>(endpoint: string, body: Record<string, unknown>, options: CallOptions = {}): Promise<T> {
    const first = await this.send(endpoint, body, options);
    if (first.status !== 401 && first.status !== 403) return this.read<T>(first);
    if (!options.visitorData) this.visitor.reset();
    const second = await this.send(endpoint, body, options);
    if (second.status === 401 || second.status === 403) throw new YtError("http", { status: second.status });
    return this.read<T>(second);
  }

  private async send(endpoint: string, body: Record<string, unknown>, options: CallOptions): Promise<Response> {
    const client = options.client ?? WEB_REMIX;
    const visitorData = options.visitorData ?? (await this.visitor.get());
    if (options.signal?.aborted) throw abortError();
    const context = {
      client: {
        clientName: client.clientName,
        clientVersion: client.clientVersion,
        hl: this.locale.hl,
        gl: this.locale.gl,
        ...(visitorData ? { visitorData } : {}),
        ...client.extra,
        ...options.clientExtra,
      },
      user: { lockedSafetyMode: false },
    };
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      "x-youtube-client-name": String(client.headerId),
      "x-youtube-client-version": client.clientVersion,
      "x-origin": client.origin,
    };
    if (visitorData) headers["x-goog-visitor-id"] = visitorData;
    if (options.authorization) headers.authorization = options.authorization;
    if (client.userAgent) headers[UA_HEADER] = client.userAgent;
    try {
      return await this.fetchFn(`${client.origin}/youtubei/v1/${endpoint}?prettyPrint=false`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...body, context }),
        signal: options.signal,
      });
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throw abortError();
      throw new YtError("unreachable", { status: 0, text: String(error) });
    }
  }

  private async read<T>(response: Response): Promise<T> {
    if (!response.ok) throw new YtError("http", { status: response.status });
    const raw = await response.text();
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new YtError("bad-json", { status: 502 });
    }
  }
}
