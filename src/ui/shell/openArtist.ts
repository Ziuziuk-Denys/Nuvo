import { artistHref, type ArtistTarget } from "../app/hrefs";
import { useModalStore } from "../ports/navigation";
import { usePlayerStore } from "../ports/player";
import { goTo } from "./navigate";
import { useShellStore } from "./shellStore";

export function openArtist(artist: ArtistTarget): void {
  usePlayerStore.getState().setFullscreen(false);
  useShellStore.getState().setQueueOpen(false);
  useModalStore.getState().closeSearch();
  goTo(artistHref(artist));
}
