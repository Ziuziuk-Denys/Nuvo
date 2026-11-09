import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clearTestKeyring, testKeyringService } from "../scripts/bench/keyring.mjs";

export interface Isolation {
  work: string;
  env: Record<string, string>;
  userData: string;
  dispose(): void;
}

export function isolate(prefix: string): Isolation {
  const work = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  const keyringService: string = testKeyringService();
  // unix socket paths are limited to 108 bytes; mkdtemp keeps two isolations of one process apart
  const runtime = process.env.XDG_RUNTIME_DIR ?? tmpdir();
  mkdirSync(runtime, { recursive: true });
  const socketDir = mkdtempSync(path.join(runtime, `${prefix}-`));
  const env = {
    ...process.env,
    XDG_DATA_HOME: path.join(work, "data"),
    XDG_CACHE_HOME: path.join(work, "cache"),
    XDG_STATE_HOME: path.join(work, "state"),
    XDG_CONFIG_HOME: path.join(work, "config"),
    NUVO_CORE_SOCKET: path.join(socketDir, "core.sock"),
    NUVO_CORE_KEYRING_SERVICE: keyringService,
    NUVO_CORE_TOOLS_URL: "",
  } as Record<string, string>;
  delete env.VITE_DEV_SERVER_URL;
  return {
    work,
    env,
    userData: path.join(work, "user-data"),
    dispose() {
      clearTestKeyring(keyringService);
      rmSync(socketDir, { recursive: true, force: true });
      rmSync(work, { recursive: true, force: true });
    },
  };
}
