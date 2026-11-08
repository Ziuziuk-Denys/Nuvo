// @vitest-environment node
import { describe, expect, it } from "vitest";
import { exclusive } from "./exclusive";

describe("one dialog at a time", () => {
  it("a second call while the first is open gets the busy answer and does not start", async () => {
    const run = exclusive<string>("busy");
    let release = () => {};
    let started = 0;
    const first = run(
      () =>
        new Promise<string>((resolve) => {
          started += 1;
          release = () => resolve("first");
        }),
    );
    expect(await run(async () => "second")).toBe("busy");
    expect(started).toBe(1);
    release();
    expect(await first).toBe("first");
    expect(await run(async () => "third")).toBe("third");
  });

  it("a throwing dialog frees the gate", async () => {
    const run = exclusive<string>("busy");
    await expect(run(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await run(async () => "ok")).toBe("ok");
  });
});
