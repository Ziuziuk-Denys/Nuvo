import { describe, expect, it } from "vitest";
import { CHUNK_BYTES, downloadWhole } from "./download";
import { FakeFetch } from "../test/fakeFetch";

const URL_GV = "https://rr1---sn-test.googlevideo.com/videoplayback?itag=251";
const rangeOf = (url: string) => new URL(url).searchParams.get("range")!.split("-").map(Number) as [number, number];
const bytesFor = (start: number, end: number) => {
  const out = new Uint8Array(end - start + 1);
  for (let i = 0; i < out.length; i += 1) out[i] = (start + i) % 251;
  return out;
};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("whole-file download", () => {
  it("three range requests, bytes in order whatever the answer order", async () => {
    const fake = new FakeFetch();
    const length = 2.5 * CHUNK_BYTES;
    fake.on(
      "GET",
      (url) => url.startsWith(URL_GV),
      async (call) => {
        const [start, end] = rangeOf(call.url);
        await delay(start === 0 ? 30 : start === CHUNK_BYTES ? 15 : 0);
        return new Response(bytesFor(start, end));
      },
    );
    const blob = (await downloadWhole(fake.fetch, URL_GV, length, "audio/webm", new AbortController().signal))!;
    expect(fake.calls.map((call) => new URL(call.url).searchParams.get("range"))).toEqual(["0-1048575", "1048576-2097151", "2097152-2621439"]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // toEqual walks a 2.6 MB typed array element by element (about 5 s); compare the bytes natively
    expect(Buffer.from(bytes).equals(Buffer.from(bytesFor(0, length - 1)))).toBe(true);
    expect(blob.type).toBe("audio/webm");
  });

  it("a chunk failing once is retried", async () => {
    const fake = new FakeFetch();
    let failed = false;
    fake.on(
      "GET",
      (url) => url.startsWith(URL_GV),
      (call) => {
        const [start, end] = rangeOf(call.url);
        if (start === CHUNK_BYTES && !failed) {
          failed = true;
          return new Response("", { status: 503 });
        }
        return new Response(bytesFor(start, end));
      },
    );
    expect(await downloadWhole(fake.fetch, URL_GV, 2.5 * CHUNK_BYTES, "audio/webm", new AbortController().signal)).not.toBeNull();
    expect(fake.calls).toHaveLength(4);
  });

  it("a chunk short on both attempts rejects", async () => {
    const fake = new FakeFetch();
    fake.on(
      "GET",
      (url) => url.startsWith(URL_GV),
      (call) => {
        const [start, end] = rangeOf(call.url);
        return new Response(bytesFor(start, start === 0 ? end - 1000 : end));
      },
    );
    await expect(downloadWhole(fake.fetch, URL_GV, 2 * CHUNK_BYTES, "audio/webm", new AbortController().signal)).rejects.toMatchObject({
      code: "rejected-stream",
    });
  });

  it("unknown length or another host is one GET", async () => {
    const fake = new FakeFetch();
    fake.on("GET", URL_GV, new Response(new Uint8Array([1, 2, 3])));
    fake.on("GET", "https://cdn.example/file.webm", new Response(new Uint8Array([4, 5])));
    await downloadWhole(fake.fetch, URL_GV, undefined, "audio/webm", new AbortController().signal);
    await downloadWhole(fake.fetch, "https://cdn.example/file.webm", 5_000_000, "audio/webm", new AbortController().signal);
    expect(fake.calls.map((call) => call.url)).toEqual([URL_GV, "https://cdn.example/file.webm"]);
  });

  it("a partial single GET is nothing", async () => {
    const fake = new FakeFetch();
    fake.on(
      "GET",
      URL_GV,
      new Response(new Uint8Array(100), {
        status: 206,
        headers: { "content-range": "bytes 0-99/200" },
      }),
    );
    expect(await downloadWhole(fake.fetch, URL_GV, undefined, "audio/webm", new AbortController().signal)).toBeNull();
  });

  it("at most four range requests are open at once", async () => {
    const fake = new FakeFetch();
    let open = 0;
    let peak = 0;
    fake.on(
      "GET",
      (url) => url.startsWith(URL_GV),
      async (call) => {
        open += 1;
        peak = Math.max(peak, open);
        await delay(2);
        open -= 1;
        const [start, end] = rangeOf(call.url);
        return new Response(new Uint8Array(end - start + 1));
      },
    );
    await downloadWhole(fake.fetch, URL_GV, 10 * CHUNK_BYTES, "audio/webm", new AbortController().signal);
    expect(peak).toBe(4);
    expect(fake.calls).toHaveLength(10);
  });

  it("an abort rejects and starts no further chunks", async () => {
    const fake = new FakeFetch();
    const controller = new AbortController();
    fake.on(
      "GET",
      (url) => url.startsWith(URL_GV),
      async (call) => {
        await delay(5);
        const [start, end] = rangeOf(call.url);
        return new Response(new Uint8Array(end - start + 1));
      },
    );
    const pending = downloadWhole(fake.fetch, URL_GV, 10 * CHUNK_BYTES, "audio/webm", controller.signal);
    await delay(1);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const started = fake.calls.length;
    await delay(20);
    expect(fake.calls.length).toBe(started);
    expect(started).toBe(4);
  });

  it("signal already aborted on entry throws immediately", async () => {
    const fake = new FakeFetch();
    const controller = new AbortController();
    controller.abort();
    await expect(downloadWhole(fake.fetch, URL_GV, CHUNK_BYTES, "audio/webm", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.calls).toHaveLength(0);
  });

  it("contentLength over 200 MB rejects", async () => {
    const fake = new FakeFetch();
    const twoHundredMB = 200 * 1024 * 1024 + 1;
    await expect(downloadWhole(fake.fetch, URL_GV, twoHundredMB, "audio/webm", new AbortController().signal)).rejects.toMatchObject({
      code: "rejected-stream",
    });
    expect(fake.calls).toHaveLength(0);
  });

  it("4xx errors except 408/429 are not retried", async () => {
    const fake = new FakeFetch();
    let calls = 0;
    fake.on(
      "GET",
      (url) => url.startsWith(URL_GV),
      (_call) => {
        calls += 1;
        return new Response("", { status: 404 });
      },
    );
    await expect(downloadWhole(fake.fetch, URL_GV, CHUNK_BYTES, "audio/webm", new AbortController().signal)).rejects.toMatchObject({ code: "http" });
    expect(calls).toBe(1);
  });

  it("408/429 are retried", async () => {
    const fake = new FakeFetch();
    let attempts = 0;
    fake.on(
      "GET",
      (url) => url.startsWith(URL_GV),
      (call) => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("", { status: 408 });
        }
        const [start, end] = rangeOf(call.url);
        return new Response(bytesFor(start, end));
      },
    );
    const blob = await downloadWhole(fake.fetch, URL_GV, CHUNK_BYTES, "audio/webm", new AbortController().signal);
    expect(blob).not.toBeNull();
    expect(attempts).toBe(2);
  });

  it("single-GET with mismatched content-length rejects", async () => {
    const fake = new FakeFetch();
    fake.on(
      "GET",
      "https://cdn.example/file.webm",
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-length": "10" },
      }),
    );
    await expect(downloadWhole(fake.fetch, "https://cdn.example/file.webm", undefined, "audio/webm", new AbortController().signal)).rejects.toMatchObject({
      code: "rejected-stream",
    });
  });

  it("abort during single-GET arrayBuffer throws abort error", async () => {
    const fake = new FakeFetch();
    fake.on("GET", "https://cdn.example/file.webm", async () => {
      await delay(5);
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const controller = new AbortController();
    const pending = downloadWhole(fake.fetch, "https://cdn.example/file.webm", undefined, "audio/webm", controller.signal);
    await delay(1);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
