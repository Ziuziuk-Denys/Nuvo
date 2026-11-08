/**
 * The YouTube worker service main starts: the hidden worker
 * window, `nuvo-yt:*` IPC, the interpreter allowlist and the content-token rate limit.
 */
import { BrowserWindow, ipcMain, net, webContents, type Session } from "electron";
import path from "node:path";
import { CONTENT_TOKENS_PER_MINUTE, WorkerError, WorkerHost, type WorkerWindow } from "./host";
import { pathToFileURL } from "node:url";
import { isAppOrigin } from "../app/policy";
import { fetchInterpreter } from "./script";
import { WORKER_URL, fromWorkerMainFrame, lockDownWorkerContents, lockDownWorkerSession, workerWindowOptions } from "./window";

export { CONTENT_TOKENS_PER_MINUTE };

interface SenderEvent {
  sender: { id: number; mainFrame: unknown; session?: unknown };
  senderFrame?: { url?: string } | null;
}

function electronWindow(partition: Session, preload: string): WorkerWindow {
  const window = new BrowserWindow(workerWindowOptions(partition, preload));
  const contents = window.webContents;
  contents.setAudioMuted(true);
  lockDownWorkerContents(contents);
  void window.loadURL(WORKER_URL).catch(() => undefined);
  return {
    contentsId: contents.id,
    send: (channel, job) => {
      if (!window.isDestroyed()) contents.send(channel, job);
    },
    // Also ends a renderer stuck in a synchronous loop (checked in an Electron smoke run).
    destroy: () => {
      if (!window.isDestroyed()) window.destroy();
    },
    onClosed: (listener) => window.on("closed", listener),
    onLoadFailed: (listener) =>
      contents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
        if (isMainFrame) listener(`${code} ${description}`);
      }),
  };
}

export function startYoutubeService(deps: { partition: Session; log: (message: string) => void }): { dispose(): void } {
  const preload = path.join(import.meta.dirname, "youtube-worker.cjs");
  // The app's own page, as main loads it and as the engine's permission policy checks it.
  const appLocation = {
    indexUrl: pathToFileURL(path.join(import.meta.dirname, "../dist/index.html")).href,
    devServerUrl: process.env.VITE_DEV_SERVER_URL,
  };
  lockDownWorkerSession(deps.partition);
  // The worker stays open while the app plays a queue.
  const appAudible = () => webContents.getAllWebContents().some((contents) => contents.session !== deps.partition && contents.isCurrentlyAudible());
  const host = new WorkerHost(() => electronWindow(deps.partition, preload), deps.log, undefined, appAudible);
  const fromWorker = (event: SenderEvent) => fromWorkerMainFrame(event, host.contentsId);
  // Deny by default: only the main frame of an app page outside the worker partition may drive the worker.
  const fromApp = (event: SenderEvent) =>
    event.senderFrame != null &&
    event.senderFrame === event.sender.mainFrame &&
    event.sender.id !== host.contentsId &&
    event.sender.session !== deps.partition &&
    isAppOrigin(event.senderFrame.url ?? "", appLocation);

  ipcMain.handle("nuvo-yt:call", async (event, payload: unknown) => {
    if (!fromApp(event)) throw new WorkerError("bad-input", "sender");
    const { op, args } = (payload ?? {}) as { op?: unknown; args?: unknown };
    try {
      return await host.request(op, args);
    } catch (error) {
      throw error instanceof WorkerError ? error : new WorkerError("worker-closed", String((error as Error)?.message ?? error));
    }
  });
  ipcMain.on("nuvo-yt:hello", (event) => {
    if (fromWorker(event)) host.hello(event.sender.id);
  });
  ipcMain.on("nuvo-yt:done", (event, message: unknown) => {
    if (fromWorker(event)) host.done(event.sender.id, message);
  });
  ipcMain.handle("nuvo-yt:script", async (event, url: unknown) => {
    if (!fromWorker(event)) throw new Error("bad-input: not the worker");
    return fetchInterpreter(url, (target, init) => net.fetch(target, init));
  });

  return {
    dispose: () => {
      ipcMain.removeHandler("nuvo-yt:call");
      ipcMain.removeHandler("nuvo-yt:script");
      ipcMain.removeAllListeners("nuvo-yt:hello");
      ipcMain.removeAllListeners("nuvo-yt:done");
      host.dispose();
    },
  };
}
