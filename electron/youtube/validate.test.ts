import { describe, expect, it } from "vitest";
import { validateJob } from "./validate";

describe("content-token identifier", () => {
  it("accepts visitor data of about 440 characters", () => {
    const identifier = "Cgt".padEnd(439, "A") + "=";
    expect(validateJob("content-token", { identifier })).not.toBeNull();
  });

  it("rejects more than 1024 characters and characters outside the set", () => {
    expect(validateJob("content-token", { identifier: "A".repeat(1025) })).toBeNull();
    expect(validateJob("content-token", { identifier: "a b" })).toBeNull();
  });
});
