/** The daemon origin served by main's bridge. */
export const CORE_BASE_URL = "nuvo-core://local";
import { CoreError } from "@/imports/core";

/** A daemon that does not answer in this long is treated as hung, so one call cannot stall a queue behind it. */
export const CORE_TIMEOUT_MS = 10_000;

/** One JSON call to the daemon through main's bridge. */
export async function coreRequest<T>(method: string, path: string, body?: unknown, signal?: AbortSignal, headers?: Record<string, string>): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CORE_TIMEOUT_MS);
  const forward = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", forward);
  try {
    // a Blob (an image) goes as its own bytes and type; anything else as JSON
    const raw = body instanceof Blob;
    response = await fetch(`${CORE_BASE_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: body === undefined ? headers : { "content-type": raw ? body.type : "application/json", ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new CoreError(0, timedOut ? "CORE_TIMEOUT" : "CORE_DOWN");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }
  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    try {
      const parsed = (await response.json()) as { code?: unknown };
      if (typeof parsed.code === "string") code = parsed.code;
    } catch {
      // not a JSON body
    }
    throw new CoreError(response.status, code);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
