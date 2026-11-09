export interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
  json<T = Record<string, unknown>>(): T;
}

type Reply = Response | ((call: Call) => Response | Promise<Response>);

interface Route {
  method: string;
  match: (url: string) => boolean;
  body?: (body: Record<string, unknown>) => boolean;
  replies: Reply[];
  times: number;
}

export function normaliseUrl(url: string): string {
  const parsed = new URL(url);
  const params = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  parsed.search = new URLSearchParams(params).toString();
  return parsed.toString();
}

export const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export const text = (value: string, status = 200, headers: Record<string, string> = {}) => new Response(value, { status, headers });

export class FakeFetch {
  readonly calls: Call[] = [];
  readonly unmatched: Call[] = [];
  private routes: Route[] = [];

  on(method: string, url: string | ((url: string) => boolean), replies: Reply | Reply[], body?: (body: Record<string, unknown>) => boolean): this {
    const match =
      typeof url === "function"
        ? url
        : url.endsWith("*")
          ? (candidate: string) => candidate.startsWith(url.slice(0, -1))
          : (candidate: string) => normaliseUrl(candidate) === normaliseUrl(url);
    this.routes.unshift({
      method,
      match,
      body,
      replies: Array.isArray(replies) ? replies : [replies],
      times: 0,
    });
    return this;
  }

  innertube(endpoint: string, replies: Reply | Reply[], body?: (body: Record<string, unknown>) => boolean, origin = "https://music.youtube.com"): this {
    return this.on("POST", `${origin}/youtubei/v1/${endpoint}?prettyPrint=false`, replies, body);
  }

  callsTo(method: string, prefix: string): Call[] {
    return this.calls.filter((call) => call.method === method && call.url.startsWith(prefix));
  }

  assertClean(): void {
    if (this.unmatched.length > 0) {
      throw new Error(`unmatched requests: ${this.unmatched.map((call) => `${call.method} ${call.url}`).join(", ")}`);
    }
  }

  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => (headers[key] = value));
    const body = typeof init.body === "string" ? init.body : init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : undefined;
    const call: Call = {
      method,
      url,
      headers,
      body,
      json: <T>() => JSON.parse(body ?? "null") as T,
    };
    if (init.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    this.calls.push(call);
    let parsed: Record<string, unknown> = {};
    try {
      parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
    } catch {
      parsed = {};
    }
    const route = this.routes.find((candidate) => candidate.method === method && candidate.match(url) && (!candidate.body || candidate.body(parsed)));
    if (!route) {
      this.unmatched.push(call);
      throw new TypeError(`fake fetch: no route for ${method} ${url}`);
    }
    const reply = route.replies[Math.min(route.times, route.replies.length - 1)];
    route.times += 1;
    const response = typeof reply === "function" ? await reply(call) : reply.clone();
    return response;
  };
}
