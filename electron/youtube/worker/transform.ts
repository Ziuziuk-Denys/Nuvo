/** Player script transforms inside the worker. The solver that runs YouTube's code is a seam. */
import type { FetchLike } from "./tokens";

export interface SolvedScript {
  n(value: string): Promise<string>;
  sig(value: string): Promise<string>;
}

/** Turns a player script into its `n` and signature functions. Production: youtubei.js, see `solver.ts`. */
export interface Solver {
  load(playerId: string, script: string): Promise<SolvedScript>;
}

interface Loaded {
  signatureTimestamp: number;
  script: string;
  solved?: Promise<SolvedScript>;
}

const VARIANTS = ["tv-player-ias-tcl.vflset/tv-player-ias-tcl.js", "tv-player-ias.vflset/tv-player-ias.js"];
const SAFE = /^[A-Za-z0-9_-]+$/;
const SAFE_SIG = /^[A-Za-z0-9_=.%-]+$/;
const MAX_SCRIPT_BYTES = 8 * 1024 * 1024;
const MAX_VALUE_LENGTH = 4096;
const SOLVE_TIMEOUT_MS = 5000;
const MAX_VALUES = 16;
const MAX_CACHED_PLAYERS = 4;

/** Bounds one solver call; the script is untrusted, so a hung transform must not hang the worker. */
function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out`)), SOLVE_TIMEOUT_MS);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

export class PlayerTransforms {
  private scripts = new Map<string, Promise<Loaded>>();

  constructor(
    private readonly fetchFn: FetchLike,
    private readonly solver: () => Promise<Solver>,
  ) {}

  async timestamp(playerId: string): Promise<number> {
    return (await this.load(playerId)).signatureTimestamp;
  }

  async transform(playerId: string, n: string[], sig: string[]): Promise<{ signatureTimestamp: number; n: string[]; sig: string[] }> {
    if (n.length > MAX_VALUES || sig.length > MAX_VALUES) throw new Error("too many transform inputs");
    for (const value of [...n, ...sig])
      if (value.length > MAX_VALUE_LENGTH || !SAFE_SIG.test(value)) throw new Error("transform input is empty, too long or has bad characters");
    const loaded = await this.load(playerId);
    if (n.length === 0 && sig.length === 0) return { signatureTimestamp: loaded.signatureTimestamp, n: [], sig: [] };
    loaded.solved ??= this.solver().then((solver) => withTimeout(solver.load(playerId, loaded.script), "player script load"));
    const solved = await loaded.solved.catch((error) => {
      loaded.solved = undefined;
      throw error;
    });
    const nOut = await Promise.all(n.map((value) => withTimeout(solved.n(value), "n transform")));
    nOut.forEach((value, index) => {
      if (!value || value.length > MAX_VALUE_LENGTH || value === n[index] || !SAFE.test(value))
        throw new Error(`n transform gave an unusable value for input ${index}`);
    });
    const sigOut = await Promise.all(sig.map((value) => withTimeout(solved.sig(value), "signature transform")));
    sigOut.forEach((value, index) => {
      if (!value || value.length > MAX_VALUE_LENGTH || !SAFE_SIG.test(value)) throw new Error(`signature transform gave an unusable value for input ${index}`);
    });
    return {
      signatureTimestamp: loaded.signatureTimestamp,
      n: nOut,
      sig: sigOut,
    };
  }

  /** Once per player id per worker lifetime; a failure is forgotten so the next call fetches again. */
  private load(playerId: string): Promise<Loaded> {
    if (!SAFE.test(playerId)) return Promise.reject(new Error("bad player id"));
    let loading = this.scripts.get(playerId);
    if (loading) {
      // Refresh recency.
      this.scripts.delete(playerId);
    } else {
      loading = this.fetchScript(playerId);
      const failed = loading;
      loading.catch(() => {
        if (this.scripts.get(playerId) === failed) this.scripts.delete(playerId);
      });
    }
    this.scripts.set(playerId, loading);
    while (this.scripts.size > MAX_CACHED_PLAYERS) this.scripts.delete(this.scripts.keys().next().value as string);
    return loading;
  }

  private async fetchScript(playerId: string): Promise<Loaded> {
    for (const variant of VARIANTS) {
      const response = await this.fetchFn(`https://www.youtube.com/s/player/${playerId}/${variant}`);
      if (!response.ok) continue;
      const script = await response.text();
      if (Buffer.byteLength(script) > MAX_SCRIPT_BYTES) throw new Error("player script is too large");
      const stamp = script.match(/signatureTimestamp:\s*(\d+)/);
      if (!stamp) throw new Error("player script has no signatureTimestamp");
      return { signatureTimestamp: Number(stamp[1]), script };
    }
    throw new Error(`no TV player script for ${playerId}`);
  }
}
