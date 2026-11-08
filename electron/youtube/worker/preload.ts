/**
 * Preload of the hidden worker window. Active only on the
 * `www.youtube.com` document; exposes nothing to the page and talks to main over `nuvo-yt:*` only.
 */
import { GOOG_API_KEY } from "bgutils-js/utils";
import { ipcRenderer } from "electron";
import { bgutilsBotGuard } from "./botguard";
import { createYoutubeiSolver } from "./solver";
import { ContentTokens, TvIdentities, type TokenEnv } from "./tokens";
import { PlayerTransforms } from "./transform";

interface Job {
  id: number;
  op: "content-token" | "tv-identity" | "player-transform";
  args: {
    identifier?: string;
    playerId?: string;
    n?: string[];
    sig?: string[];
  };
}

if (location.origin === "https://www.youtube.com") {
  const env: TokenEnv = {
    fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    loadInterpreter: (url) => ipcRenderer.invoke("nuvo-yt:script", url) as Promise<string>,
    botguard: bgutilsBotGuard(),
    apiKey: GOOG_API_KEY,
  };
  const transforms = new PlayerTransforms(env.fetch, createYoutubeiSolver);
  const content = new ContentTokens(env);
  const tv = new TvIdentities(env, (playerId) => transforms.timestamp(playerId));

  const run = (job: Job): Promise<unknown> => {
    switch (job.op) {
      case "content-token":
        return content.mint(job.args.identifier!);
      case "tv-identity":
        return tv.get();
      case "player-transform":
        return transforms.transform(job.args.playerId!, job.args.n ?? [], job.args.sig ?? []);
    }
  };

  ipcRenderer.on("nuvo-yt:job", (_event, job: Job) => {
    run(job).then(
      (value) => ipcRenderer.send("nuvo-yt:done", { id: job.id, value }),
      (error: unknown) =>
        ipcRenderer.send("nuvo-yt:done", {
          id: job.id,
          error: String((error as Error)?.message ?? error),
        }),
    );
  });

  const hello = () => ipcRenderer.send("nuvo-yt:hello");
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hello, { once: true });
  else hello();
}
