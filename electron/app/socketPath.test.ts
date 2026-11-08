import { describe, expect, it } from "vitest";
import { coreBinaryName, coreSocketPath } from "./socketPath";

const base = { env: {}, tmpdir: "/tmp", random: "abc123" };

describe("coreSocketPath", () => {
  it("uses a random named pipe on Windows", () => {
    expect(coreSocketPath({ ...base, platform: "win32" })).toBe("\\\\.\\pipe\\nuvo-core-abc123");
  });

  it("keeps the runtime-dir socket file elsewhere", () => {
    expect(
      coreSocketPath({
        ...base,
        platform: "linux",
        env: { XDG_RUNTIME_DIR: "/run/user/1" },
      }),
    ).toBe("/run/user/1/nuvo/core.sock");
    expect(coreSocketPath({ ...base, platform: "darwin" })).toBe("/tmp/nuvo/core.sock");
  });

  it("lets NUVO_CORE_SOCKET win", () => {
    expect(
      coreSocketPath({
        ...base,
        platform: "win32",
        env: { NUVO_CORE_SOCKET: "\\\\.\\pipe\\x" },
      }),
    ).toBe("\\\\.\\pipe\\x");
  });
});

describe("coreBinaryName", () => {
  it("adds .exe on Windows only", () => {
    expect(coreBinaryName("win32")).toBe("nuvo-core.exe");
    expect(coreBinaryName("linux")).toBe("nuvo-core");
  });
});
