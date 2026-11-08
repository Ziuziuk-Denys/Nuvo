import { describe, expect, it } from "vitest";
import { WEB_REMIX } from "./constants";

describe("WEB_REMIX client version", () => {
  it("is the live value", () => {
    expect(WEB_REMIX.clientVersion).toBe("1.20261027.10.00");
  });
});
