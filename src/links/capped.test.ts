import { describe, expect, it } from "vitest";
import { readCapped } from "./capped";

function streamOf(...parts: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(new Uint8Array(part));
      controller.close();
    },
  });
}

describe("readCapped", () => {
  it("joins the chunks in order", async () => {
    expect(await readCapped(streamOf([1, 2], [3]), 10)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("returns an empty array for an empty stream", async () => {
    expect(await readCapped(streamOf(), 10)).toEqual(new Uint8Array());
  });

  it("gives up once the cap is passed, and accepts exactly the cap", async () => {
    expect(await readCapped(streamOf([1, 2], [3, 4]), 3)).toBeNull();
    expect(await readCapped(streamOf([1, 2, 3]), 3)).toEqual(new Uint8Array([1, 2, 3]));
  });
});
