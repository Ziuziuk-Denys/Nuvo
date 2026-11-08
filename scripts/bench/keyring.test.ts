import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs helper without declarations
import { clearTestKeyring, testKeyringService } from "./keyring.mjs";

describe("test keyring service", () => {
  it("is unique per run and never the owner's or the shared test item", () => {
    const first = testKeyringService();
    const second = testKeyringService();
    expect(first).toMatch(new RegExp(`^nuvo-core-test-${process.pid}-[0-9a-f]{8}$`));
    expect(second).not.toBe(first);
  });

  it("refuses to clear any item it did not name", () => {
    for (const service of ["nuvo-core", "nuvo-core-test", "nuvo-ui-test", "nuvo-core-test-1-xyz", ""]) {
      expect(() => clearTestKeyring(service)).toThrow(/refusing/);
    }
  });
});
