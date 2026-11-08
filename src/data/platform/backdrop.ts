import { useEffect } from "react";
import { create } from "zustand";

/** The cover a page lights the field with. */
export interface BackdropOptions {
  blur?: number;
  dim?: number;
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
  useEffect(() => {
    lastOwner += 1;
    const owner = lastOwner;
    usePageBackdropStore.setState({ coverUrl: cover || null, options: { blur, dim }, owner });
    return () => {
      if (usePageBackdropStore.getState().owner === owner) usePageBackdropStore.setState({ coverUrl: null, options: {}, owner: 0 });
    };
  }, [cover, blur, dim]);
}
