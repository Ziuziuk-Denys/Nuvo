import { create } from "zustand";
import type { Track as MenuTrack } from "../ports/player";
import { firstArtist } from "./notInterestedItems";
import { dislike, recs, recsEnabled, type NotInterestedScope, type RecsFailure, type Track } from "../ports/recs";

/** How long the Undo notice stays. */
export const NOTICE_MS = 8000;

export interface NotInterestedNotice {
  /** Changes with every notice, so a second dislike restarts the countdown. */
  id: number;
  track: Track;
  scope: NotInterestedScope;
  /** Set when the daemon did not store it: the notice then says why and offers no Undo. */
  failure: RecsFailure | null;
  suppressionId: number | null;
  offerHideArtist: boolean;
  /** Set when Undo itself failed: the notice stays and says so. */
  undoFailed?: boolean;
}

export const useNotInterestedStore = create<{ notice: NotInterestedNotice | null; setNotice(notice: NotInterestedNotice | null): void }>((set) => ({
  notice: null,
  setNotice: (notice) => set({ notice }),
}));

let lastId = 0;

export { firstArtist };

export async function markNotInterested(track: Track, scope: NotInterestedScope): Promise<void> {
  const result = await dislike(track, scope);
  useNotInterestedStore.getState().setNotice({
    id: ++lastId,
    track,
    scope,
    failure: typeof result === "string" ? result : null,
    suppressionId: typeof result === "string" ? null : result.suppressionId,
    offerHideArtist: typeof result === "string" ? false : result.offerHideArtist,
  });
}

export async function undoNotInterested(notice: NotInterestedNotice): Promise<void> {
  const result = notice.suppressionId !== null ? await recs.undo(notice.suppressionId) : true;
  const store = useNotInterestedStore.getState();
  if (store.notice?.id !== notice.id) return;
  if (result === true) store.setNotice(null);
  else store.setNotice({ ...notice, id: ++lastId, failure: result, suppressionId: null, offerHideArtist: false, undoFailed: true });
}

/** For the song menus: the "Not interested" action when the engine is on, nothing otherwise. */
export const songMenuNotInterested: ((track: MenuTrack, scope: NotInterestedScope) => void) | undefined = recsEnabled
  ? (track, scope) =>
      void markNotInterested({ ...track, artistList: track.artistList?.map((artist) => ({ id: artist.id ?? "unknown", name: artist.name })) }, scope)
  : undefined;
