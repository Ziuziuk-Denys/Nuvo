import { YtAccount } from "./account";
import { daemonAccountStore, migrateLegacy } from "./account/store";
import { createCatalog } from "./catalog";
import { Innertube, VisitorData, type FetchLike } from "./http";
import type { YtPlayback } from "./playback";
import type { WorkerBridge } from "./playback/worker";

export interface RuntimeDeps {
  fetch: FetchLike;
  worker: WorkerBridge;
  daemonBase: string;
  storage?: Pick<Storage, "getItem" | "removeItem">;
  log?: (message: string) => void;
}

export function createRuntime(deps: RuntimeDeps) {
  const visitor = new VisitorData(deps.fetch, deps.log);
  const yt = new Innertube(deps.fetch, visitor);
  const store = daemonAccountStore(deps.daemonBase, deps.fetch);
  const account = new YtAccount({ fetch: deps.fetch, yt, store });
  const ready = (async () => {
    if (deps.storage) await migrateLegacy(deps.storage, store).catch((error) => deps.log?.(`[youtube] migration deferred: ${String(error)}`));
    await account.init().catch((error) => deps.log?.(`[youtube] account settings unavailable: ${String(error)}`));
  })();
  const catalog = createCatalog({ yt, fetch: deps.fetch, account });

  let playback: Promise<YtPlayback> | null = null;
  let unsubscribe: (() => void) | null = null;
  let disposed = false;
  const load = () =>
    ready.then(async () => {
      const { createPlayback } = await import("./playback");
      const instance = createPlayback({
        yt,
        fetch: deps.fetch,
        worker: deps.worker,
        account,
        playThroughAccount: () => account.preferences.get().playThroughAccount,
        log: deps.log,
      });
      if (!disposed) unsubscribe = account.onChange(() => instance.reset());
      return instance;
    });
  const loadPlayback = () => {
    if (disposed) return Promise.reject(new Error("youtube module disposed"));
    const pending = (playback ??= load());
    pending.catch(() => {
      if (playback === pending) playback = null;
    });
    return pending;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    unsubscribe = null;
    void playback?.then(
      (instance) => instance.reset(),
      () => undefined,
    );
    deps.worker.close?.();
  };

  return {
    yt,
    catalog,
    account,
    ready,
    loadPlayback,
    loadedPlayback: () => playback,
    dispose,
  };
}

export type Runtime = ReturnType<typeof createRuntime>;
