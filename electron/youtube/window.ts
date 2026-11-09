import type { BrowserWindowConstructorOptions, Session } from "electron";

/** A tiny static YouTube document: same-origin fetches with YouTube's cookies, no page script. */
export const WORKER_URL = "https://www.youtube.com/robots.txt";

export function workerWindowOptions(partition: Session, preload: string): BrowserWindowConstructorOptions {
  return {
    show: false,
    width: 320,
    height: 240,
    webPreferences: {
      session: partition,
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  };
}

interface LockableContents {
  on(event: "will-navigate" | "will-redirect" | "will-frame-navigate", listener: (event: { preventDefault(): void }) => void): unknown;
  setWindowOpenHandler(handler: () => { action: "deny" }): void;
}

export function lockDownWorkerContents(contents: LockableContents): void {
  const block = (event: { preventDefault(): void }) => event.preventDefault();
  contents.on("will-navigate", block);
  contents.on("will-redirect", block);
  contents.on("will-frame-navigate", block);
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
}

interface LockableSession {
  setPermissionRequestHandler(handler: (contents: unknown, permission: string, callback: (granted: boolean) => void) => void): void;
  setPermissionCheckHandler(handler: () => boolean): void;
  setDevicePermissionHandler(handler: () => boolean): void;
  on(event: "will-download", listener: (event: { preventDefault(): void }) => void): unknown;
}

export function lockDownWorkerSession(partition: LockableSession): void {
  partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  partition.setPermissionCheckHandler(() => false);
  partition.setDevicePermissionHandler(() => false);
  partition.on("will-download", (event) => event.preventDefault());
}

export function fromWorkerMainFrame(event: { sender: { id: number; mainFrame: unknown }; senderFrame?: unknown }, contentsId: number | null): boolean {
  return contentsId !== null && event.sender.id === contentsId && event.senderFrame != null && event.senderFrame === event.sender.mainFrame;
}
