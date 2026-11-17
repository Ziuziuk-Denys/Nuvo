import { describe, expect, it } from "vitest";
import { editionOf, updateChannel } from "./edition";

describe("edition", () => {
  it("is plain unless the package names the encrypted one", () => {
    expect(editionOf({})).toBe("plain");
    expect(editionOf({ nuvoEdition: "plain" })).toBe("plain");
    expect(editionOf({ nuvoEdition: "Encrypted" })).toBe("plain");
    expect(editionOf({ nuvoEdition: "encrypted" })).toBe("encrypted");
  });

  it("reads its own update feed", () => {
    expect(updateChannel("plain")).toBeNull();
    expect(updateChannel("encrypted")).toBe("encrypted");
  });
});
