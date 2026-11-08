import type { Track } from "@/engine/types";
import { createLinkPorts } from "@/links/ports";
import { matchByName } from "@/links/match";
import { toPlayerTrack } from "@/links/playerTrack";
import { youtubeCatalog } from "@/links/youtubeCatalog";

export { forgetRecognized, listen, recognizeHistory, startFailure, type RecognizedEntry, type RecognizeSource } from "@/recognize/client";
export { advance, IDLE, listening, songFacts, timeAgo, type RecognizedSong, type RecognizeInput, type Session } from "@/recognize/session";

const ports = createLinkPorts(youtubeCatalog);

/** The catalog's copy of a recognized song, or null when there is none or the search failed. */
export async function findSong(song: { title: string; artist: string }, signal: AbortSignal): Promise<Track | null> {
  try {
    const result = await matchByName({ title: song.title, artists: song.artist ? [song.artist] : [] }, ports, signal);
    const found = result.status === "approved" ? result.track : result.proposedTrack;
    return found ? toPlayerTrack(found) : null;
  } catch {
    return null;
  }
}

/** The id that stands for a file the user picked or dropped; null when Nuvo may not read it. */
export async function grantFile(file: File): Promise<string | null> {
  const grant = await window.nuvoShell?.recognizeFile(file);
  return grant?.id ?? null;
}
