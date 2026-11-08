/** Signed-in TV playback over SABR. */
import { COBALT_UA, TVHTML5, UA_HEADER } from "../constants";
import type { FetchLike, Innertube } from "../http";
import { YtError, abortError } from "../types";
import { audioFormats, report, type AudioFormat } from "./formats";
import { progressiveSource, type FeedPlatform } from "./progressive";
import type { ResolveOptions, SignedInStep, YtSource } from "./resolver";
import { raceAbort, type WorkerBridge } from "./worker";

const CPN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** A client playback nonce: 16 characters from the URL-safe alphabet. */
export function newCpn(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => CPN_ALPHABET[byte & 63]).join("");
}

export interface SabrConfig {
  videoId: string;
  formats: AudioFormat[];
  serverAbrStreamingUrl: string;
  ustreamerConfig: string;
  clientVersion: string;
  poToken: string;
  fetch: FetchLike;
}

export interface SabrHandle {
  audio: ReadableStream<Uint8Array>;
  format: {
    mimeType: string;
    bitrate: number;
    contentLength?: number;
    approxDurationMs?: number;
  };
  abort(): void;
}

export type StartSabr = (config: SabrConfig) => Promise<SabrHandle>;

/** https on a *.googlevideo.com host, default port, no credentials. */
export function isGooglevideoUrl(url: URL): boolean {
  return url.protocol === "https:" && url.hostname.endsWith(".googlevideo.com") && url.port === "" && url.username === "" && url.password === "";
}

const MAX_REDIRECTS = 3;

const MAX_AUDIO_BYTES = 512 * 1024 * 1024;

const STREAMER_CLIENT = {
  hl: "en_US",
  deviceMake: "Unknown",
  deviceModel: "Unknown",
  osName: "Unknown_0",
};

/** Fetch for SABR: every request body gets the TV device fields merged into its client info, and the Cobalt agent. */
export function sabrFetch(
  fetchFn: FetchLike,
  codec: {
    decode(bytes: Uint8Array): Record<string, unknown>;
    encode(message: Record<string, unknown>): Uint8Array;
  },
): FetchLike {
  return (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set(UA_HEADER, COBALT_UA);
    let body = init.body;
    if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
      const message = codec.decode(body instanceof Uint8Array ? body : new Uint8Array(body));
      const context = (message.streamerContext ?? {}) as Record<string, unknown>;
      message.streamerContext = {
        ...context,
        clientInfo: {
          ...(context.clientInfo as Record<string, unknown> | undefined),
          ...STREAMER_CLIENT,
        },
      };
      body = codec.encode(message) as BodyInit;
    }
    return followWithinGooglevideo(fetchFn, input, { ...init, headers, body });
  };
}

/** Redirects are followed by hand so a hop can never leave googlevideo. */
async function followWithinGooglevideo(fetchFn: FetchLike, input: string, init: RequestInit): Promise<Response> {
  let target = input;
  for (let hop = 0; ; hop++) {
    const response = await fetchFn(target, { ...init, redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) return response;
    const next = new URL(location, target);
    if (hop >= MAX_REDIRECTS || !isGooglevideoUrl(next)) throw new YtError("no-formats", { text: "unexpected SABR redirect" });
    target = next.toString();
  }
}

/** googlevideo's `SabrStream`, loaded on the first signed-in track only. */
export const startSabr: StartSabr = async (config) => {
  const [{ SabrStream }, { buildSabrFormat, EnabledTrackTypes }, { VideoPlaybackAbrRequest }, { base64ToU8 }] = await Promise.all([
    import("googlevideo/sabr-stream"),
    import("googlevideo/utils"),
    import("googlevideo/protos"),
    import("googlevideo/utils"),
  ]);
  const codec = {
    decode: (bytes: Uint8Array) => VideoPlaybackAbrRequest.decode(bytes) as unknown as Record<string, unknown>,
    encode: (message: Record<string, unknown>) => VideoPlaybackAbrRequest.encode(message as never).finish(),
  };
  const stream = new SabrStream({
    videoId: config.videoId,
    formats: config.formats.map((format) => buildSabrFormat(format as never)),
    serverAbrStreamingUrl: config.serverAbrStreamingUrl,
    videoPlaybackUstreamerConfig: config.ustreamerConfig,
    clientInfo: { clientName: 7, clientVersion: config.clientVersion },
    poToken: config.poToken,
    fetchFunction: sabrFetch(config.fetch, codec) as typeof fetch,
    callbacks: { onMintPoToken: async () => base64ToU8(config.poToken) },
  });
  const { audioStream, selectedFormats } = stream.start({
    enabledTrackTypes: EnabledTrackTypes.AUDIO_ONLY,
    audioPreferences: { container: "webm" },
    isPostLiveDvr: false,
  });
  const chosen = selectedFormats.audioFormat;
  return {
    audio: audioStream as ReadableStream<Uint8Array>,
    format: {
      mimeType: chosen.mimeType ?? "audio/webm",
      bitrate: chosen.averageBitrate ?? chosen.bitrate,
      contentLength: chosen.contentLength,
      approxDurationMs: chosen.approxDurationMs,
    },
    abort: () => void stream.abort(),
  };
};

export interface SignedInDeps {
  yt: Innertube;
  fetch: FetchLike;
  worker: WorkerBridge;
  account: {
    status(): boolean;
    authorization(signal: AbortSignal): Promise<string | null>;
  };
  playThroughAccount(): boolean;
  startSabr?: StartSabr;
  isTypeSupported?: (mime: string) => boolean;
  feed?: FeedPlatform;
}

interface TvPlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  streamingData?: {
    serverAbrStreamingUrl?: string;
    adaptiveFormats?: unknown[];
  };
  playerConfig?: {
    mediaCommonConfig?: {
      mediaUstreamerRequestConfig?: { videoPlaybackUstreamerConfig?: string };
    };
    audioConfig?: { loudnessDb?: number };
  };
}

export class SignedInTv implements SignedInStep {
  constructor(private readonly deps: SignedInDeps) {}

  enabled(): boolean {
    return this.deps.account.status() && this.deps.playThroughAccount();
  }

  async resolve(videoId: string, options: ResolveOptions, signal: AbortSignal): Promise<YtSource> {
    const authorization = await this.deps.account.authorization(signal);
    if (!authorization) throw new YtError("sign-in-required");
    const identity = await raceAbort(this.deps.worker.tvIdentity(), signal);
    const cpn = newCpn();
    const response = await this.deps.yt.call<TvPlayerResponse>(
      "player",
      {
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
        cpn,
        playbackContext: {
          contentPlaybackContext: {
            signatureTimestamp: identity.signatureTimestamp,
            html5Preference: "HTML5_PREF_WANTS",
          },
        },
      },
      {
        client: { ...TVHTML5, clientVersion: identity.version },
        visitorData: identity.visitor,
        authorization,
        clientExtra: {
          tvAppInfo: { livingRoomPoTokenId: identity.livingRoomId },
        },
        signal,
      },
    );
    const playability = response.playabilityStatus;
    if (playability?.status === "LOGIN_REQUIRED") throw new YtError("sign-in-required");
    if (playability?.status !== "OK")
      throw new YtError("unplayable", {
        text: playability?.reason ?? playability?.status ?? "not playable",
      });
    const sabrUrl = response.streamingData?.serverAbrStreamingUrl;
    const ustreamerConfig = response.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig;
    const formats = audioFormats(response.streamingData);
    if (!sabrUrl || !ustreamerConfig || formats.length === 0) throw new YtError("no-formats");

    const url = new URL(sabrUrl);
    // The URL comes from the network and receives the PO token, so pin it to googlevideo over https.
    if (!isGooglevideoUrl(url)) throw new YtError("no-formats", { text: "unexpected SABR host" });
    const n = url.searchParams.get("n");
    if (n) url.searchParams.set("n", (await raceAbort(this.deps.worker.playerTransform(identity.scriptId, [n], []), signal)).n[0]);
    url.searchParams.set("cpn", cpn);
    url.searchParams.set("alr", "yes");

    if (signal.aborted) throw abortError();
    const started = await (this.deps.startSabr ?? startSabr)({
      videoId,
      formats: (response.streamingData?.adaptiveFormats ?? []) as AudioFormat[],
      serverAbrStreamingUrl: url.toString(),
      ustreamerConfig,
      clientVersion: identity.version,
      poToken: identity.token,
      fetch: this.deps.fetch,
    });
    let aborted = false;
    const handle: SabrHandle = {
      ...started,
      abort: () => {
        if (aborted) return;
        aborted = true;
        started.abort();
      },
    };
    if (signal.aborted) {
      handle.abort();
      throw abortError();
    }
    const onAbort = () => handle.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const reader = handle.audio.getReader();
      const first = await reader.read();
      if (signal.aborted) throw abortError();
      if (first.done || !first.value || first.value.byteLength === 0) throw new YtError("no-formats", { text: "SABR sent no audio" });
      const mime = handle.format.mimeType.split(";")[0].trim() || "audio/webm";
      const base = {
        mimeType: mime,
        codec: report({ itag: 0, mimeType: handle.format.mimeType }).codec,
        bitrate: handle.format.bitrate || 160_000,
        sizeBytes: handle.format.contentLength,
        loudnessDb: response.playerConfig?.audioConfig?.loudnessDb,
        servedBy: "TVHTML5 (account)",
      };
      let received = first.value.byteLength;
      const rest = new ReadableStream<Uint8Array>({
        start: (controller) => controller.enqueue(first.value),
        pull: async (controller) => {
          const next = await reader.read();
          if (next.done) return controller.close();
          received += next.value.byteLength;
          if (received > MAX_AUDIO_BYTES) {
            handle.abort();
            return controller.error(new YtError("no-formats", { text: "SABR stream too large" }));
          }
          controller.enqueue(next.value);
        },
        cancel: () => handle.abort(),
      });
      if (options.progressive) {
        const supported = this.deps.isTypeSupported ?? ((type: string) => typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(type));
        if (!supported(handle.format.mimeType))
          throw new YtError("unsupported-mime", {
            text: handle.format.mimeType,
          });
        return {
          ...base,
          progressive: progressiveSource(rest, handle.format.mimeType, handle.format.approxDurationMs, () => handle.abort(), this.deps.feed),
        };
      }
      const blob = await new Response(rest).blob();
      return {
        ...base,
        bytes: new Blob([blob], { type: mime }),
        sizeBytes: blob.size,
      };
    } catch (error) {
      handle.abort();
      throw error;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
