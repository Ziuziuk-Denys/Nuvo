/** BotGuard interpreter download for the worker: https only, two Google hosts, 20 s, 2xx only. */
import { interpreterUrlAllowed } from "./validate";

export const INTERPRETER_TIMEOUT_MS = 20_000;
/** Cap on the downloaded script so a hostile answer cannot exhaust memory. */
export const INTERPRETER_MAX_BYTES = 4_000_000;
const MAX_REDIRECTS = 3;

/** Reads the body and stops as soon as the cap is crossed. */
async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > INTERPRETER_MAX_BYTES) throw new Error("interpreter too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > INTERPRETER_MAX_BYTES) {
      await reader.cancel();
      throw new Error("interpreter too large");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function fetchInterpreter(url: unknown, fetchFn: (url: string, init?: RequestInit) => Promise<Response>): Promise<string> {
  const signal = AbortSignal.timeout(INTERPRETER_TIMEOUT_MS);
  let current = url;
  // Redirects are followed by hand so every hop is checked against the allowlist.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!interpreterUrlAllowed(current)) throw new Error("bad-input: interpreter host refused");
    const response = await fetchFn(current, { signal, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("interpreter redirect without location");
      try {
        current = new URL(location, current).href;
      } catch {
        throw new Error("bad-input: interpreter redirect refused");
      }
      continue;
    }
    if (!response.ok) throw new Error(`interpreter answered ${response.status}`);
    return readCapped(response);
  }
  throw new Error("interpreter redirect limit");
}
