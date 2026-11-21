import { useEffect } from "react";
import { create } from "zustand";

export interface BackdropOptions {
  blur?: number;
  dim?: number;
  sky?: "live" | "drift" | "still";
}

interface BackdropState {
  coverUrl: string | null;
  options: BackdropOptions;
  owner: number;
}

export const usePageBackdropStore = create<BackdropState>(() => ({ coverUrl: null, options: {}, owner: 0 }));

let lastOwner = 0;

export function usePageBackdrop(cover: string | null | undefined, options?: BackdropOptions): void {
  const blur = options?.blur;
  const dim = options?.dim;
  const sky = options?.sky;
  useEffect(() => {
    if (!cover) return;
    lastOwner += 1;
    const owner = lastOwner;
    usePageBackdropStore.setState({ coverUrl: cover, options: { blur, dim, sky }, owner });
    return () => {
      if (usePageBackdropStore.getState().owner === owner) usePageBackdropStore.setState({ coverUrl: null, options: {}, owner: 0 });
    };
  }, [cover, blur, dim, sky]);
}
