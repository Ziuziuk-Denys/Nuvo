import { YtError, abortError, type YtCode } from "../types";

export interface TvIdentity {
  token: string;
  livingRoomId: string;
  visitor: string;
  version: string;
  scriptId: string;
  signatureTimestamp: number;
}

export interface Transform {
  signatureTimestamp: number;
  n: string[];
  sig: string[];
}

export interface WorkerBridge {
  contentToken(videoId: string): Promise<string>;
  tvIdentity(): Promise<TvIdentity>;
  playerTransform(playerId: string, n: string[], sig: string[]): Promise<Transform>;
  isReady?(): Promise<boolean>;
  close?(): void;
}

export type WorkerOp = "content-token" | "tv-identity" | "player-transform" | "ready";
export type WorkerCall = (op: WorkerOp, args: unknown) => Promise<unknown>;

const CODES: YtCode[] = ["worker-start", "worker-closed", "worker-timeout", "bad-input", "needs-desktop"];

/** Electron wraps remote errors as "Error invoking remote method ...: Error: <code>"; the code survives. */
export function toYtError(error: unknown): YtError {
  if (error instanceof YtError) return error;
  const message = String((error as { message?: string })?.message ?? error);
  const code = CODES.find((candidate) => message.includes(candidate));
  return new YtError(code ?? "worker-closed", { text: message });
}

const badInput = (what: string) => new YtError("bad-input", { text: `worker answered with a bad ${what}` });

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const sameStrings = (value: unknown, length: number) => Array.isArray(value) && value.length === length && value.every((item) => isText(item));

export function ipcWorker(call: WorkerCall): WorkerBridge {
  let closed = false;
  const run = async (op: WorkerOp, args: unknown): Promise<unknown> => {
    if (closed) throw new YtError("worker-closed", { text: "worker bridge closed" });
    try {
      return await call(op, args);
    } catch (error) {
      throw toYtError(error);
    }
  };
  return {
    contentToken: async (videoId) => {
      const answer = await run("content-token", { identifier: videoId });
      if (!isText(answer)) throw badInput("token");
      return answer;
    },
    tvIdentity: async () => {
      const answer = (await run("tv-identity", {})) as Partial<TvIdentity>;
      const { token, livingRoomId, visitor, version, scriptId } = answer ?? {};
      if (
        ![token, livingRoomId, visitor, version, scriptId].every(isText) ||
        typeof answer.signatureTimestamp !== "number" ||
        !Number.isFinite(answer.signatureTimestamp)
      )
        throw badInput("identity");
      return answer as TvIdentity;
    },
    playerTransform: async (playerId, n, sig) => {
      const answer = (await run("player-transform", {
        playerId,
        n,
        sig,
      })) as Partial<Transform>;
      if (
        typeof answer?.signatureTimestamp !== "number" ||
        !Number.isFinite(answer.signatureTimestamp) ||
        !sameStrings(answer.n, n.length) ||
        !sameStrings(answer.sig, sig.length)
      )
        throw badInput("transform");
      return answer as Transform;
    },
    isReady: async () => (await run("ready", {})) === true,
    close: () => {
      closed = true;
    },
  };
}

export const noWorker: WorkerBridge = {
  contentToken: () => Promise.reject(new YtError("needs-desktop")),
  tvIdentity: () => Promise.reject(new YtError("needs-desktop")),
  playerTransform: () => Promise.reject(new YtError("needs-desktop")),
};

export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
