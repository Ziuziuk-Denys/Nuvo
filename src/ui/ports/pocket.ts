import type { PocketStatus } from "@/pocket/contracts";

export { usePocketFeed, usePocketStore } from "@/features/pocket";
export type { PocketStatus };

export function togglePocket(): void {
  void window.nuvoShell?.togglePocket();
}

export function getPocketStatus(): Promise<PocketStatus | null> {
  return window.nuvoShell?.getPocketStatus() ?? Promise.resolve(null);
}

export async function pocketOnTop(): Promise<boolean> {
  return (await window.nuvoShell?.getMainSettings())?.pocketOnTop ?? true;
}

export async function setPocketOnTop(onTop: boolean): Promise<boolean> {
  return (await window.nuvoShell?.setMainSetting("pocketOnTop", onTop))?.ok ?? false;
}
