import { PLAYER_PATH, WWW_ORIGIN } from "../constants";
import type { FetchLike } from "../http";
import { YtError, abortError, isAbortError } from "../types";
import type { AudioFormat } from "./formats";
import { raceAbort, type WorkerBridge } from "./worker";

const PLAYER_ID_TTL_MS = 6 * 60 * 60 * 1000;
const IFRAME_API_LIMIT = 2_000_000;
const TIMESTAMPS_KEPT = 3;

export class PlayerScript {
  private idRequest: Promise<string> | null = null;
  private idAt = 0;
  private timestamps = new Map<string, number>();

  constructor(
    private readonly fetchFn: FetchLike,
    private readonly worker: WorkerBridge,
  ) {}

  async playerId(signal: AbortSignal): Promise<string> {
    for (;;) {
      if (this.idRequest && Date.now() - this.idAt > PLAYER_ID_TTL_MS) this.idRequest = null;
      if (!this.idRequest) {
        this.idAt = Date.now();
        // The request is shared, so it carries its own signal: a caller that leaves must not fail the others.
        const request = this.loadId(signal).catch((error) => {
          if (this.idRequest === request) this.idRequest = null;
          throw error;
        });
        this.idRequest = request;
      }
      try {
        return await raceAbort(this.idRequest, signal);
      } catch (error) {
        if (!isAbortError(error) || signal.aborted) throw error;
      }
    }
  }

  private async loadId(signal: AbortSignal): Promise<string> {
    const response = await this.fetchFn(`${WWW_ORIGIN}/iframe_api`, { signal });
    const body = response.ok ? await response.text() : "";
    const id = body.length <= IFRAME_API_LIMIT ? body.match(PLAYER_PATH)?.[1] : undefined;
    if (!id) throw new YtError("rejected-stream", { text: "player id not found" });
    return id;
  }

  async signatureTimestamp(signal: AbortSignal): Promise<{ playerId: string; signatureTimestamp: number }> {
    const playerId = await this.playerId(signal);
    let signatureTimestamp = this.timestamps.get(playerId);
    if (signatureTimestamp === undefined) {
      signatureTimestamp = (await raceAbort(this.worker.playerTransform(playerId, [], []), signal)).signatureTimestamp;
      this.timestamps.set(playerId, signatureTimestamp);
      if (this.timestamps.size > TIMESTAMPS_KEPT) this.timestamps.delete(this.timestamps.keys().next().value!);
    }
    return { playerId, signatureTimestamp };
  }

  async decipher(format: AudioFormat, signal: AbortSignal, playerId?: string): Promise<string> {
    let url = format.url;
    let scrambled: string | null = null;
    let sigParam = "sig";
    if (!url && format.signatureCipher) {
      const cipher = new URLSearchParams(format.signatureCipher);
      url = cipher.get("url") ?? undefined;
      scrambled = cipher.get("s");
      sigParam = cipher.get("sp") ?? "sig";
    }
    if (!url) throw new YtError("rejected-stream", { text: "format has no URL" });
    const parsed = new URL(url);
    const n = parsed.searchParams.get("n");
    if (!n && !scrambled) return url;
    try {
      const id = playerId ?? (await this.playerId(signal));
      const solved = await raceAbort(this.worker.playerTransform(id, n ? [n] : [], scrambled ? [scrambled] : []), signal);
      if (n) parsed.searchParams.set("n", solved.n[0]);
      if (scrambled) parsed.searchParams.set(sigParam, solved.sig[0]);
      return parsed.toString();
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new YtError("rejected-stream", {
        text: `decipher failed: ${String((error as Error)?.message ?? error)}`,
      });
    }
  }

  reset(): void {
    this.idRequest = null;
  }
}

export const PROBE_OFFSET = 1_052_672;

export async function probe(fetchFn: FetchLike, url: string, contentLength: number | undefined, signal: AbortSignal): Promise<void> {
  const offset = contentLength !== undefined && contentLength > PROBE_OFFSET ? PROBE_OFFSET : 0;
  const target = new URL(url);
  target.searchParams.set("range", `${offset}-${offset}`);
  let response: Response;
  try {
    response = await fetchFn(target.toString(), { signal });
  } catch (error) {
    if (isAbortError(error) || signal.aborted) throw abortError();
    throw new YtError("rejected-stream", { status: 0, text: String(error) });
  }
  void response.body?.cancel().catch(() => undefined);
  if (!response.ok)
    throw new YtError("rejected-stream", {
      status: response.status,
      text: `probe answered ${response.status}`,
    });
}
