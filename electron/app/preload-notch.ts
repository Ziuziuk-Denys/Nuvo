/** Notch window preload: the Notch's own channels only (ours, kept). Same method names the Notch page already uses. */
import { ipcRenderer, contextBridge } from "electron";
import type { NotchAction, NotchHello, NotchLyrics, NotchSettings, NotchState, ShapeRect } from "../../src/notch/contracts";

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
  notchHello: () => ipcRenderer.invoke("notch:hello") as Promise<NotchHello>,
  onNotchState: on<NotchState>("notch:state"),
  onNotchLyrics: on<NotchLyrics>("notch:lyrics"),
  onNotchSettings: on<NotchSettings>("notch:settings"),
  notchAction: (action: NotchAction) => ipcRenderer.send("notch:action", action),
  notchSetShape: (rect: ShapeRect) => ipcRenderer.send("notch:shape", rect),
};

export type NotchBridge = typeof bridge;

contextBridge.exposeInMainWorld("nuvoElectron", bridge);
