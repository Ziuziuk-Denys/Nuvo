import type { FetchLike, Innertube } from "../http";
import { YtError } from "../types";
import { downloadWhole } from "./download";
import { PlayerScript } from "./player";
import { StreamResolver, type ResolveOptions, type YtSource } from "./resolver";
import { SignedInTv, type SignedInDeps } from "./tv";
import type { WorkerBridge } from "./worker";

export type { ResolveOptions, YtSource } from "./resolver";

export interface YtPlayback {
  resolve(track: { id: string }, options: ResolveOptions, signal: AbortSignal): Promise<YtSource>;
  fetchWhole(source: Pick<YtSource, "url" | "progressive" | "bytes" | "mimeType" | "sizeBytes">, signal: AbortSignal): Promise<Blob>;
  warmUp(): void;
  reset(): void;
}

export interface PlaybackRuntimeDeps {
  yt: Innertube;
  fetch: FetchLike;
  worker: WorkerBridge;
  account: SignedInDeps["account"];
  playThroughAccount(): boolean;
  log?: (message: string) => void;
}

export function createPlayback(deps: PlaybackRuntimeDeps): YtPlayback {
  const player = new PlayerScript(deps.fetch, deps.worker);
  const signedIn = new SignedInTv({
    yt: deps.yt,
    fetch: deps.fetch,
    worker: deps.worker,
    account: deps.account,
    playThroughAccount: deps.playThroughAccount,
  });
  const resolver = new StreamResolver({
    yt: deps.yt,
    fetch: deps.fetch,
    worker: deps.worker,
    player,
    signedIn,
    log: deps.log,
  });
  return {
    resolve: (track, options, signal) => resolver.resolve(track, options, signal),
    async fetchWhole(source, signal) {
      if (source.bytes) return source.bytes;
      if (source.progressive) return source.progressive.whole;
      if (!source.url) throw new YtError("rejected-stream", { text: "nothing to download" });
      const blob = await downloadWhole(deps.fetch, source.url, source.sizeBytes, source.mimeType, signal);
      if (!blob) throw new YtError("rejected-stream", { text: "not cacheable" });
      return blob;
    },
    warmUp() {
      // The worker starts on the first stream that needs it, so an idle app keeps no second renderer
      void deps.yt.visitor.get();
      void player.playerId(new AbortController().signal).catch(() => undefined);
    },
    reset() {
      resolver.reset();
      deps.yt.visitor.reset();
    },
  };
}
