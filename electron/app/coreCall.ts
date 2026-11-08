/** Main's own daemon calls over the socket: the only way to reach `/v1/fs/*` routes. */
import http from "node:http";

export interface CoreAnswer {
  status: number;
  body: Buffer;
  contentType: string;
}

export function coreCall(socketPath: string, token: string, method: string, path: string, body?: unknown): Promise<CoreAnswer> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request(
      { socketPath, method, path, headers: { authorization: `Bearer ${token}`, ...(payload ? { "content-type": "application/json" } : {}) }, timeout: 30_000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 502, body: Buffer.concat(chunks), contentType: String(res.headers["content-type"] ?? "") }));
        res.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("nuvo-core did not answer")));
    request.on("error", reject);
    request.end(payload);
  });
}

/** The daemon's `{ message }` from an error answer. */
export function coreError(answer: CoreAnswer): string {
  try {
    return (JSON.parse(answer.body.toString("utf8")) as { message?: string }).message ?? `nuvo-core answered ${answer.status}`;
  } catch {
    return `nuvo-core answered ${answer.status}`;
  }
}
