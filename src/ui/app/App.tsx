import { useMemo, type JSX } from "react";
import { MotionConfig } from "framer-motion";
import { HashRouter } from "react-router-dom";
import { ThemeProvider, useAbLoop, useNotchFeeds, useSoundSync, useTempoSync } from "../ports/app";
import { usePlayerStore } from "../ports/player";
import { usePlaylistsList } from "../ports/library";
import { useLyrics, type Line as LyricLine } from "../ports/lyrics";
import { usePocketFeed } from "../ports/pocket";
import { Gate } from "../screens/lock/Gate";
import { Shell } from "../shell/Shell";
import { useAppearanceSync } from "../shell/useAppearanceSync";
import { Overlays } from "./Overlays";
import { useDeeplinks } from "./links";
import { useNowPlayingReport } from "./nowPlaying";
import { AppRoutes } from "./routes";
import { useEffectsMark } from "../effects";
import "../fonts/fonts.css";
import "../tokens.css";
import "../motion.css";
import "./base.css";

function toSurfaceLine(line: LyricLine) {
  const words = line.words?.filter((word) => !word.background).map((word) => ({ timeMs: word.fromMs, text: word.text }));
  return { timeMs: line.fromMs, text: line.text, ...(words && words.length > 0 ? { words } : {}) };
}

function Root(): JSX.Element {
  useDeeplinks();
  useAppearanceSync();
  useSoundSync();
  useTempoSync();
  useAbLoop();
  useNowPlayingReport();
  const trackId = usePlayerStore((state) => state.currentTrack?.id ?? null);
  const lyricsTrackId = useLyrics((state) => state.trackId);
  const timed = useLyrics((state) => state.lines);
  const lines = useMemo(() => timed.map(toSurfaceLine), [timed]);
  const { playlists } = usePlaylistsList().data;
  useNotchFeeds({ trackId, lyricsTrackId, lines }, playlists);
  usePocketFeed(
    usePlayerStore((state) => state.currentTrack),
    usePlayerStore((state) => state.queue),
    usePlayerStore((state) => state.currentIndex),
  );
  return (
    <Shell overlays={<Overlays />}>
      <Gate>
        <AppRoutes />
      </Gate>
    </Shell>
  );
}

export function App(): JSX.Element {
  const reduced = useEffectsMark();
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
      <MotionConfig reducedMotion={reduced ? "always" : "user"}>
        <HashRouter>
          <Root />
        </HashRouter>
      </MotionConfig>
    </ThemeProvider>
  );
}
