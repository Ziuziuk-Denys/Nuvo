import http from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export const CORE_SCHEME = "nuvo-core";

export const CORE_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  corsEnabled: true,
};

const CORE_HOST = "local";
const READY_TIMEOUT_MS = 15_000;

// Static CORS parts; the allowed origin is echoed per request instead of "*".
const CORS_BASE: Record<string, string> = {
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-expose-headers": "*",
  vary: "Origin",
};

function corsHeaders(origin: string | null): Record<string, string> {
  return origin ? { ...CORS_BASE, "access-control-allow-origin": origin } : { ...CORS_BASE };
}

// Never forwarded: the token is added here, and browser identity headers mean nothing to the daemon.
const DROPPED_HEADERS = new Set(["host", "connection", "authorization", "cookie", "origin", "referer"]);

export interface BridgeOptions {
  socketPath: string;
  token: string;
  waitReady: () => Promise<boolean>;
  allowedOrigins: string[];
  readyTimeoutMs?: number;
}

// Never forwarded back: hop-by-hop headers belong to the daemon connection, not to this response.
const DROPPED_RESPONSE_HEADERS = new Set(["connection", "transfer-encoding", "keep-alive"]);

function reply(status: number, origin: string | null, body?: object): Response {
  const headers: Record<string, string> = corsHeaders(origin);
  if (body) headers["content-type"] = "application/json";
  return new Response(body ? JSON.stringify(body) : null, { status, headers });
}

function unavailable(origin: string | null): Response {
  return reply(503, origin, { message: "nuvo-core is not running", code: "CORE_UNAVAILABLE", reqId: "" });
}

/** Routes that take filesystem paths: only main calls them, after a native dialog. */
export function isMainOnlyPath(pathname: string): boolean {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  return decoded.toLowerCase().split("/").includes("fs");
}

export async function forwardToCore(request: Request, options: BridgeOptions): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname !== CORE_HOST) return reply(404, null, { message: "not found", code: "NOT_FOUND", reqId: "" });

  // A present Origin must be an app page; no Origin (same-scheme navigation, media loads) is allowed.
  const origin = request.headers.get("origin");
  if (origin !== null && !options.allowedOrigins.includes(origin)) {
    return reply(403, null, { message: "origin not allowed", code: "FORBIDDEN_ORIGIN", reqId: "" });
  }

  // before the preflight answer: a page never learns that such a route exists
  if (isMainOnlyPath(url.pathname)) return reply(403, origin, { message: "not available to pages", code: "FORBIDDEN_PATH", reqId: "" });

  if (request.method === "OPTIONS") return reply(204, origin);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = await Promise.race([
    options.waitReady(),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), options.readyTimeoutMs ?? READY_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
  if (!ready) return unavailable(origin);

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (!DROPPED_HEADERS.has(key)) headers[key] = value;
  });
  headers.authorization = `Bearer ${options.token}`;

  return new Promise<Response>((resolve) => {
    const upstream = http.request({ socketPath: options.socketPath, method: request.method, path: url.pathname + url.search, headers }, (res) => {
      const out = new Headers(corsHeaders(origin));
      for (const [key, value] of Object.entries(res.headers)) {
        if (value !== undefined && !DROPPED_RESPONSE_HEADERS.has(key)) {
          out.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
      }
      const status = res.statusCode ?? 502;
      // Response() rejects a body for these statuses.
      if (status === 204 || status === 304 || request.method === "HEAD") {
        res.resume();
        resolve(new Response(null, { status, headers: out }));
        return;
      }
      resolve(new Response(Readable.toWeb(res) as ReadableStream, { status, headers: out }));
    });
    upstream.on("error", () => resolve(unavailable(origin)));
    request.signal.addEventListener("abort", () => upstream.destroy(), { once: true });
    if (request.body) {
      const body = Readable.fromWeb(request.body as unknown as NodeReadableStream);
      body.on("error", () => upstream.destroy());
      body.pipe(upstream);
    } else {
      upstream.end();
    }
  });
}
