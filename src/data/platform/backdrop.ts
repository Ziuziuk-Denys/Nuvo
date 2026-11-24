import { useEffect } from "react";
import { create } from "zustand";

export interface BackdropOptions {
  scene?: "room" | "page" | "wall";
  pinned?: boolean;
  banner?: string;
  portrait?: string;
}

interface BackdropState {
  coverUrl: string | null;
  options: BackdropOptions;
  owner: number;
}

export const usePageBackdropStore = create<BackdropState>(() => ({ coverUrl: null, options: {}, owner: 0 }));

let lastOwner = 0;

export function usePageBackdrop(cover: string | null | undefined, options?: BackdropOptions): void {
  const scene = options?.scene;
  const pinned = options?.pinned;
  const banner = options?.banner;
  const portrait = options?.portrait;
  useEffect(() => {
    if (!cover) return;
    lastOwner += 1;
    const owner = lastOwner;
    usePageBackdropStore.setState({ coverUrl: cover, options: { scene, pinned, banner, portrait }, owner });
    return () => {
      if (usePageBackdropStore.getState().owner === owner) usePageBackdropStore.setState({ coverUrl: null, options: {}, owner: 0 });
    };
  }, [cover, scene, pinned, banner, portrait]);
}
