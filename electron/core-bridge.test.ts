// @vitest-environment node
import http from "node:http";
import { default as fs } from "node:fs";
import { default as os } from "node:os";
import { default as path } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { forwardToCore } from "./core-bridge";

interface Seen {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

const servers: http.Server[] = [];
const dirs: string[] = [];

afterEach(async () => {
  dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

// Unix socket paths are limited to 108 bytes, so keep them in the short system temp dir.
function socketPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-"));
  dirs.push(dir);
  return path.join(dir, "c.sock");
}

async function fakeCore(handler: (req: http.IncomingMessage, res: http.ServerResponse, seen: Seen) => void) {
  const sock = socketPath();
  const seen: Seen = { headers: {}, body: Buffer.alloc(0) };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      Object.assign(seen, { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      handler(req, res, seen);
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(sock, r));
  return { sock, seen };
}

const ready = async () => true;
const allowedOrigins = ["file://", "null", "http://localhost:5173"];

describe("core bridge", () => {
  it("forwards method, path, query, headers and body with the token", async () => {
    const { sock, seen } = await fakeCore((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
    const request = new Request("nuvo-core://local/v1/me/playlists?limit=5", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer renderer-guess", origin: "file://" },
      body: JSON.stringify({ title: "x" }),
    });
    const response = await forwardToCore(request, { socketPath: sock, token: "secret", waitReady: ready, allowedOrigins });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("access-control-allow-origin")).toBe("file://");
    expect(response.headers.get("vary")).toBe("Origin");
    expect(seen.method).toBe("POST");
    expect(seen.url).toBe("/v1/me/playlists?limit=5");
    expect(seen.headers.authorization).toBe("Bearer secret");
    expect(seen.headers.origin).toBeUndefined();
    expect(seen.body.toString()).toBe('{"title":"x"}');
  });

  it("streams binary uploads and range responses", async () => {
    const payload = Buffer.alloc(300_000, 7);
    const { sock, seen } = await fakeCore((req, res) => {
      if (req.method === "PUT") {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(206, { "content-range": "bytes 0-9/100", "content-type": "audio/webm" });
      res.end(Buffer.alloc(10, 1));
    });
    const put = await forwardToCore(
      new Request("nuvo-core://local/v1/cache/audio/t1", { method: "PUT", headers: { "content-type": "audio/webm" }, body: payload }),
      { socketPath: sock, token: "t", waitReady: ready, allowedOrigins },
    );
    expect(put.status).toBe(204);
    expect(seen.body.length).toBe(300_000);
    expect(seen.headers["content-type"]).toBe("audio/webm");

    const get = await forwardToCore(new Request("nuvo-core://local/v1/cache/audio/t1", { headers: { range: "bytes=0-9" } }), {
      socketPath: sock,
      token: "t",
      waitReady: ready,
      allowedOrigins,
    });
    expect(get.status).toBe(206);
    expect(get.headers.get("content-range")).toBe("bytes 0-9/100");
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(new Uint8Array(10).fill(1));
    expect(seen.headers.range).toBe("bytes=0-9");
  });

  it("delivers server-sent events as they arrive", async () => {
    const { sock } = await fakeCore((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: 1\n\n");
      setTimeout(() => res.end("data: 2\n\n"), 100);
    });
    const response = await forwardToCore(new Request("nuvo-core://local/v1/tracks/x/lyrics"), {
      socketPath: sock,
      token: "t",
      waitReady: ready,
      allowedOrigins,
    });
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("data: 1\n\n");
    const second = await reader.read();
    expect(new TextDecoder().decode(second.value)).toBe("data: 2\n\n");
  });

  it("answers preflight locally and maps a dead or failed daemon to 503", async () => {
    const preflight = await forwardToCore(new Request("nuvo-core://local/v1/me", { method: "OPTIONS" }), {
      socketPath: "/nonexistent.sock",
      token: "t",
      waitReady: ready,
      allowedOrigins,
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("PUT");

    const dead = await forwardToCore(new Request("nuvo-core://local/v1/me"), { socketPath: socketPath(), token: "t", waitReady: ready, allowedOrigins });
    expect(dead.status).toBe(503);
    expect((await dead.json()).code).toBe("CORE_UNAVAILABLE");

    const failed = await forwardToCore(new Request("nuvo-core://local/v1/me"), { socketPath: "/x", token: "t", waitReady: async () => false, allowedOrigins });
    expect(failed.status).toBe(503);
  });

  it("rejects foreign origins before attaching the token, allows a missing origin", async () => {
    const { sock, seen } = await fakeCore((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    const opts = { socketPath: sock, token: "t", waitReady: ready, allowedOrigins };
    const foreign = await forwardToCore(new Request("nuvo-core://local/v1/me", { headers: { origin: "https://evil.example" } }), opts);
    expect(foreign.status).toBe(403);
    expect(seen.method).toBeUndefined();
    const foreignPreflight = await forwardToCore(
      new Request("nuvo-core://local/v1/me", { method: "OPTIONS", headers: { origin: "https://evil.example" } }),
      opts,
    );
    expect(foreignPreflight.status).toBe(403);
    const dev = await forwardToCore(new Request("nuvo-core://local/v1/me", { headers: { origin: "http://localhost:5173" } }), opts);
    expect(dev.status).toBe(200);
    expect(dev.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const none = await forwardToCore(new Request("nuvo-core://local/v1/me"), opts);
    expect(none.status).toBe(200);
    expect(seen.headers.authorization).toBe("Bearer t");
  });

  it("answers 404 for any host other than local", async () => {
    const { sock, seen } = await fakeCore((_req, res) => res.end("ok"));
    const response = await forwardToCore(new Request("nuvo-core://other/v1/me"), { socketPath: sock, token: "t", waitReady: ready, allowedOrigins });
    expect(response.status).toBe(404);
    expect(seen.method).toBeUndefined();
  });

  it("answers 503 when the daemon never becomes ready", async () => {
    const response = await forwardToCore(new Request("nuvo-core://local/v1/me"), {
      socketPath: "/x",
      token: "t",
      waitReady: () => new Promise<boolean>(() => {}),
      allowedOrigins,
      readyTimeoutMs: 50,
    });
    expect(response.status).toBe(503);
  });

  it("closes the daemon connection when the caller cancels a stream", async () => {
    let closed!: () => void;
    const serverSawClose = new Promise<void>((r) => (closed = r));
    const { sock } = await fakeCore((_req, res) => {
      res.on("close", closed);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: 1\n\n");
    });
    const controller = new AbortController();
    const response = await forwardToCore(new Request("nuvo-core://local/v1/tracks/x/lyrics", { signal: controller.signal }), {
      socketPath: sock,
      token: "t",
      waitReady: ready,
      allowedOrigins,
    });
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => {});
    await serverSawClose;
  });
});

import { isMainOnlyPath } from "./core-bridge";

describe("main-only paths", () => {
  it("refuses every fs route, however it is spelled", async () => {
    for (const path of ["/v1/fs/local/roots", "/v1/FS/downloads", "/v1/%66s/x", "/v1/./fs/x", "/v1//fs/x", "/v1/fs", "/v1/a%2ffs/x"]) {
      expect(isMainOnlyPath(new URL(`nuvo-core://local${path}`).pathname), path).toBe(true);
    }
    expect(isMainOnlyPath("/v1/%zz/fs")).toBe(true);
    for (const path of ["/v1/local/roots", "/v1/downloads", "/v1/offs/x", "/v1/fsx"]) {
      expect(isMainOnlyPath(path), path).toBe(false);
    }
    const { sock, seen } = await fakeCore((_req, res) => res.end("{}"));
    for (const path of ["/v1/fs/local/roots", "/v1/%66s/downloads", "/v1/./fs/x", "/v1/fs/imports", "/v1/%66s/imports"]) {
      const response = await forwardToCore(new Request(`nuvo-core://local${path}`, { method: "POST", body: "{}", headers: { origin: "file://" } }), {
        socketPath: sock,
        token: "t",
        waitReady: ready,
        allowedOrigins,
      });
      expect(response.status, path).toBe(403);
    }
    expect(seen.method).toBeUndefined();
    const open = await forwardToCore(new Request("nuvo-core://local/v1/downloads"), { socketPath: sock, token: "t", waitReady: ready, allowedOrigins });
    expect(open.status).toBe(200);
  });
});
