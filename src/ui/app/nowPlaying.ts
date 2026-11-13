import { useEffect, useRef } from "react";
import { reportNowPlaying } from "../ports/lastfm";
import { usePlayerStore } from "../ports/player";

export function useNowPlayingReport(): void {
  const track = usePlayerStore((state) => state.currentTrack);
  const playing = usePlayerStore((state) => state.status === "playing");
  const reported = useRef<string | null>(null);

  useEffect(() => {
    if (!track || !playing || reported.current === track.id) return;
    reported.current = track.id;
    reportNowPlaying(track).catch(() => undefined);
  }, [track, playing]);
}
