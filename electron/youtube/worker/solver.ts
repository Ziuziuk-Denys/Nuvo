// Runs YouTube code: worker only. youtubei.js cannot parse the TV player, so web base.js is used
import { Platform, Player } from "youtubei.js/web";
import type { Solver } from "./transform";

export const EVAL_TIMEOUT_MS = 5000;

const THREAD_SOURCE = `onmessage = (event) => {
  try {
    postMessage({ ok: true, value: new Function(event.data)() });
  } catch (error) {
    postMessage({ ok: false, message: String(error) });
  }
};`;

// One killable Web Worker per call: sandboxed preloads lack worker_threads, YouTube code may loop
export function evalInThread(code: string, timeoutMs = EVAL_TIMEOUT_MS): Promise<Record<string, unknown>> {
  const url = URL.createObjectURL(new Blob([THREAD_SOURCE], { type: "text/javascript" }));
  let thread: Worker;
  try {
    thread = new Worker(url);
  } catch (error) {
    URL.revokeObjectURL(url);
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      thread.terminate();
      URL.revokeObjectURL(url);
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("player script timed out"));
    }, timeoutMs);
    thread.onmessage = (event: MessageEvent) => {
      finish();
      const answer = event.data as {
        ok: boolean;
        value?: Record<string, unknown>;
        message?: string;
      };
      if (answer.ok) resolve(answer.value ?? {});
      else reject(new Error(answer.message));
    };
    thread.onerror = (event: ErrorEvent) => {
      finish();
      reject(new Error(event.message || "player script failed"));
    };
    thread.postMessage(code);
  });
}

let installed = false;

export async function createYoutubeiSolver(): Promise<Solver> {
  if (!installed) {
    installed = true;
    Platform.shim.eval = (data) => evalInThread(data.output);
  }
  return {
    async load(playerId) {
      const player = await Player.create(undefined, (input, init) => fetch(input, init), undefined, playerId);
      return {
        n: async (value) =>
          new URL(await player.decipher(`https://n.googlevideo.com/videoplayback?n=${encodeURIComponent(value)}`)).searchParams.get("n") ?? "",
        sig: async (value) => {
          const cipher = new URLSearchParams({
            s: value,
            sp: "sig",
            url: "https://s.googlevideo.com/videoplayback",
          }).toString();
          return new URL(await player.decipher(undefined, cipher)).searchParams.get("sig") ?? "";
        },
      };
    },
  };
}
