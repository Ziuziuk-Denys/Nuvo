/** Fakes for the stream resolution tests: worker bridge, iframe_api and googlevideo answers. */
import { PlayerScript } from "../playback/player";
import type { Transform, TvIdentity, WorkerBridge } from "../playback/worker";
import type { FakeFetch } from "./fakeFetch";
import { text } from "./fakeFetch";
import { STREAM_HOST } from "./formats";

export const PLAYER_ID = "pl4yer01";

export class FakeWorker implements WorkerBridge {
  tokens: string[] = [];
  transforms: Array<{ playerId: string; n: string[]; sig: string[] }> = [];
  identities = 0;
  token: () => Promise<string> = async () => "T";
  identity: () => Promise<TvIdentity> = async () => ({
    token: "TVTOKEN",
    livingRoomId: "lr-1",
    visitor: "CgtTVTVTVTVTVTVTVTVTVTVTV",
    version: "7.20260101.00.00",
    scriptId: PLAYER_ID,
    signatureTimestamp: 20000,
  });

  isReady?: () => Promise<boolean>;

  contentToken(videoId: string): Promise<string> {
    this.tokens.push(videoId);
    return this.token();
  }

  tvIdentity(): Promise<TvIdentity> {
    this.identities += 1;
    return this.identity();
  }

  async playerTransform(playerId: string, n: string[], sig: string[]): Promise<Transform> {
    this.transforms.push({ playerId, n, sig });
    return {
      signatureTimestamp: 20000,
      n: n.map((value) => `${value}_t`),
      sig: sig.map((value) => `S${value}`),
    };
  }
}

export function streamRoutes(fake: FakeFetch, status = 200): void {
  fake.on("GET", (url) => url.startsWith(STREAM_HOST), text("x", status));
  fake.on(
    "GET",
    "https://www.youtube.com/iframe_api",
    text(`var a="https:\\/\\/www.youtube.com\\/s\\/player\\/${PLAYER_ID}\\/www-widgetapi.vflset\\/www-widgetapi.js";`),
  );
}

export function playbackDeps(fake: FakeFetch, yt: import("../http").Innertube, worker = new FakeWorker()) {
  return {
    yt,
    fetch: fake.fetch,
    worker,
    player: new PlayerScript(fake.fetch, worker),
  };
}
