import { create } from "zustand";
import { notifyLibraryChanged } from "@/data/library/changes";
import { libraryClient } from "@/data/library/client";
import type { Track } from "@/engine/types";
import { CoreError } from "@/imports/core";
import type { NotchAddOutcome } from "@/notch/contracts";

export const usePlaylistAdds = create<{ outcome: NotchAddOutcome | null }>(() => ({ outcome: null }));

export async function addToPlaylist(track: Track, playlistId: string): Promise<void> {
  let kind: NotchAddOutcome["kind"] = "added";
  try {
    await libraryClient.addTrack(playlistId, track);
    notifyLibraryChanged();
  } catch (error) {
    // the core answers 409 when the playlist already holds the track
    kind = error instanceof CoreError && error.status === 409 ? "already" : "failed";
  }
  usePlaylistAdds.setState({ outcome: { trackId: track.id, playlistId, kind } });
}
