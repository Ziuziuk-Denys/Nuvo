import { TVHTML5, WEB_REMIX, type ClientContext } from "../constants";
import type { FetchLike, Innertube } from "../http";
import { YtError } from "../types";
import { audioFormats, chooseFormat, type AudioFormat, type FormatChoice } from "./formats";
import type { PlayerScript } from "./player";
import { raceAbort, type WorkerBridge } from "./worker";

export interface PlaybackDeps {
  yt: Innertube;
  fetch: FetchLike;
  worker: WorkerBridge;
  player: PlayerScript;
}

export interface StreamHit {
  url: string;
  format: AudioFormat;
  client: string;
  loudnessDb?: number;
}

interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  streamingData?: unknown;
  playerConfig?: {
    audioConfig?: { loudnessDb?: number; perceptualLoudnessDb?: number };
  };
}

/** `OK` passes; `LOGIN_REQUIRED` is a bot check (typed, never matched on text); anything else is unplayable. */
export function checkPlayable(response: PlayerResponse): void {
  const status = response.playabilityStatus?.status;
  if (status === "OK") return;
  const text = response.playabilityStatus?.reason ?? status ?? "no playability status";
  if (status === "LOGIN_REQUIRED") throw new YtError("bot-check", { text });
  throw new YtError("unplayable", { text });
}

const loudnessOf = (response: PlayerResponse, format: AudioFormat) =>
  response.playerConfig?.audioConfig?.loudnessDb ?? response.playerConfig?.audioConfig?.perceptualLoudnessDb ?? format.loudnessDb;

const playerBody = (videoId: string, extra: Record<string, unknown> = {}) => ({
  videoId,
  contentCheckOk: true,
  racyCheckOk: true,
  ...extra,
});

export async function webRemixAttempt(deps: PlaybackDeps, videoId: string, choice: FormatChoice, signal: AbortSignal): Promise<StreamHit> {
  const [token, , script] = await Promise.all([
    raceAbort(deps.worker.contentToken(videoId), signal),
    raceAbort(deps.yt.visitor.get(), signal),
    deps.player.signatureTimestamp(signal),
  ]);
  const response = await deps.yt.call<PlayerResponse>(
    "player",
    playerBody(videoId, {
      playbackContext: {
        contentPlaybackContext: {
          signatureTimestamp: script.signatureTimestamp,
        },
      },
      serviceIntegrityDimensions: { poToken: token },
    }),
    { client: WEB_REMIX, signal },
  );
  checkPlayable(response);
  const format = chooseFormat(audioFormats(response.streamingData), choice);
  if (!format) throw new YtError("no-formats");
  const url = new URL(await deps.player.decipher(format, signal, script.playerId));
  url.searchParams.set("pot", token);
  return {
    url: url.toString(),
    format,
    client: WEB_REMIX.clientName,
    loudnessDb: loudnessOf(response, format),
  };
}

export async function fallbackAttempt(
  deps: PlaybackDeps,
  client: ClientContext,
  videoId: string,
  choice: FormatChoice,
  signal: AbortSignal,
): Promise<StreamHit> {
  const needsScript = client.clientName === TVHTML5.clientName;
  const script = needsScript ? await deps.player.signatureTimestamp(signal) : undefined;
  const body = playerBody(
    videoId,
    script
      ? {
          playbackContext: {
            contentPlaybackContext: {
              signatureTimestamp: script.signatureTimestamp,
            },
          },
        }
      : {},
  );
  let response = await deps.yt.call<PlayerResponse>("player", body, {
    client,
    signal,
  });
  if (response.playabilityStatus?.status === "LOGIN_REQUIRED") {
    deps.yt.visitor.reset();
    response = await deps.yt.call<PlayerResponse>("player", body, {
      client,
      signal,
    });
  }
  checkPlayable(response);
  const usable = audioFormats(response.streamingData).filter((format) => format.url || (script && format.signatureCipher));
  const format = chooseFormat(usable, choice);
  if (!format) throw new YtError("no-formats");
  const url = script ? await deps.player.decipher(format, signal, script.playerId) : format.url!;
  return {
    url,
    format,
    client: client.clientName,
    loudnessDb: loudnessOf(response, format),
  };
}
