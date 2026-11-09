import { useMemo, type JSX } from "react";
import { MotionConfig } from "framer-motion";
import { HashRouter } from "react-router-dom";
import { ThemeProvider, useAbLoop, useNotchFeeds, useSoundSync, useTempoSync } from "../ports/app";
import { usePlayerStore } from "../ports/player";
import { useLyrics } from "../ports/lyrics";
import { Gate } from "../screens/lock/Gate";
import { Shell } from "../shell/Shell";
import { useAppearanceSync } from "../shell/useAppearanceSync";
import { Overlays } from "./Overlays";
import { useDeeplinks } from "./links";
import { AppRoutes } from "./routes";
import { useEffectsMark } from "../effects";
import "../tokens.css";
import "../motion.css";
import "./base.css";

function Root(): JSX.Element {
  useDeeplinks();
  useAppearanceSync();
  useSoundSync();
  useTempoSync();
  useAbLoop();
  const trackId = usePlayerStore((state) => state.currentTrack?.id ?? null);
  const lyricsTrackId = useLyrics((state) => state.trackId);
  const timed = useLyrics((state) => state.lines);
  const lines = useMemo(() => timed.map((line) => ({ timeMs: line.fromMs, text: line.text })), [timed]);
  useNotchFeeds({ trackId, lyricsTrackId, lines });
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
