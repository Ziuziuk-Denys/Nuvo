import path from "node:path";

interface SocketPathInput {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  tmpdir: string;
  /** random hex, fresh per launch; Windows pipe names are global, so the name must not be guessable */
  random: string;
}

/** Where the daemon listens: a unix socket file, or on Windows a named pipe with a random name. */
export function coreSocketPath({ platform, env, tmpdir, random }: SocketPathInput): string {
  if (env.NUVO_CORE_SOCKET) return env.NUVO_CORE_SOCKET;
  if (platform === "win32") return `\\\\.\\pipe\\nuvo-core-${random}`;
  return path.join(env.XDG_RUNTIME_DIR ?? tmpdir, "nuvo", "core.sock");
}

export function coreBinaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "nuvo-core.exe" : "nuvo-core";
}
