// A keyring service of its own for every test or bench run, so parallel runs from several
// worktrees never read or clear each other's key. The owner's `nuvo-core` item is never touched.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const OWN = /^nuvo-core-test-\d+-[0-9a-f]{8}$/;

export function testKeyringService() {
  return `nuvo-core-test-${process.pid}-${randomBytes(4).toString("hex")}`;
}

// The daemon keeps its master key as Secret Service item `service` / `master-key`
export function clearTestKeyring(service) {
  if (!OWN.test(service)) throw new Error(`refusing to clear keyring item ${JSON.stringify(service)}`);
  try {
    execFileSync("secret-tool", ["clear", "service", service, "username", "master-key"], { stdio: "ignore" });
  } catch {
    // nothing stored
  }
}
