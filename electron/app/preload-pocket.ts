import { contextBridge, ipcRenderer } from "electron";
import type { NotchLyrics, NotchState } from "../../src/notch/contracts";
import type { PocketAction, PocketFace, PocketFeed, PocketHello, PocketMenuRequest } from "../../src/pocket/contracts";

const on =
  <T>(channel: string) =>
  (cb: (payload: T) => void) => {
    const listener = (_event: unknown, payload: T) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };

const bridge = {
  hello: () => ipcRenderer.invoke("pocket:hello") as Promise<PocketHello>,
  onState: on<NotchState>("pocket:state"),
  onLyrics: on<NotchLyrics>("pocket:lyrics"),
  onFeed: on<PocketFeed>("pocket:feed"),
  onFace: on<PocketFace>("pocket:face"),
  onContext: on<void>("pocket:context"),
  action: (action: PocketAction) => ipcRenderer.send("pocket:action", action),
  menu: (request: PocketMenuRequest) => ipcRenderer.send("pocket:menu", request),
  close: () => ipcRenderer.send("pocket:close"),
};

export type PocketBridge = typeof bridge;

contextBridge.exposeInMainWorld("nuvoPocket", bridge);
