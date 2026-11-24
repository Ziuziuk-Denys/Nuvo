import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type JSX,
  type ReactNode,
  type UIEvent,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { hasOpenLayer, usePresence } from "../components/layers";
import { useScrollActivity } from "../components/useScrollActivity";
import { Field } from "../field/Field";
import { railSpace } from "../geometry";
import { reducedEffectsNow } from "../effects";
import { arrive, flyToPlayer, watchDepartures } from "../flight";
import { DURATION_MS, EASE, seconds } from "../motion";
import { useTranslation } from "../ports/i18n";
import { bootImports } from "../ports/importsRuntime";
import { Karaoke, KaraokeOverlay } from "../ports/karaoke";
import { Studio } from "../visual/Studio";
import { useStudioOpen } from "../visual/studioOpen";
import { useDisableButtonFocus, useModalStore, useWindowState } from "../ports/navigation";
import { onShareLink } from "../ports/links";
import { playerEngine, usePlayerStore } from "../ports/player";
import { useCustomizationStore } from "../ports/settings";
import { useAppShortcuts } from "../ports/shortcuts";
import { useToolDownloadToast } from "./useToolDownloadToast";
import { useAppIconSync, useLookSync } from "../ports/theme";
import { ImportsHost } from "../screens/imports/ImportsHost";
import { LookPreview } from "../screens/home/LookPreview";
import { LyricsToolsHost } from "../screens/lyrics/LyricsToolsHost";
import { useGateStore } from "../screens/lock/gateState";
import { useImportToast } from "../screens/imports/importToast";
import { useAddMusic } from "../screens/local/addMusic";
import { useWindowDrop } from "../screens/recognize/recognizeDrop";
import { useUndoToast } from "../recs/UndoNotice";
import { ShareSheetHost } from "../sheets/ShareSheet";
import { SourceSheetHost } from "../sheets/SourceSheet";
import { TrimSheetHost } from "../sheets/TrimSheet";
import { Island } from "./island/Island";
import { useHistoryKeys, useScrollMemory } from "./history";
import { bindNavigate, isEntityRoute } from "./navigate";
import { usePageLit } from "./pageLit";
import { ShellScrollContext } from "./scroller";
import { useShellStore } from "./shellStore";
import styles from "./Shell.module.css";
import { TopBar } from "./TopBar";
import { TourLayer } from "../tour/TourLayer";

export interface ShellProps {
  children: ReactNode;
  overlays?: ReactNode;
}

const KARAOKE_PATH = "/player";
const STAY_IN_PLACE = { replace: true } as const;
const LEGACY_SCROLLERS = ".overflow-y-auto";

const CHROME = { hidden: { opacity: 0 }, shown: { opacity: 1 } };
const BESIDE_RAIL = "header[data-window-drag], [data-island], [data-beside-rail]";

const watchEngine = (notify: () => void) => playerEngine.subscribe(notify);
const engineHasTrack = () => playerEngine.getSnapshot().currentTrack !== null;

/** Pins the window box at 0,0: focus may scroll an overflow:hidden box, the window must never move. */
function pinWindow(event: UIEvent<HTMLDivElement>): void {
  event.currentTarget.scrollTo(0, 0);
}

export function Shell({ children, overlays }: ShellProps): JSX.Element {
  const { t } = useTranslation();
  useLookSync();
  useAppIconSync();
  useToolDownloadToast();
  // idempotent: builds the import runtime once, later calls only pass the current translator
  bootImports(t);
  const location = useLocation();
  const { pathname, search } = location;
  const navigate = useNavigate();
  useEffect(() => bindNavigate(navigate), [navigate]);
  useEffect(() => onShareLink((link) => void navigate(`/search?link=1&q=${encodeURIComponent(link)}`)), [navigate]);
  const edgeToEdge = useWindowState().isEdgeToEdge;

  const modal = useModalStore(
    useShallow((store) => ({
      searchOpen: store.searchOpen,
      closeSearch: store.closeSearch,
      openSearch: store.openSearch,
      showSettings: store.openSettingsSection,
    })),
  );
  const { queueOpen, setQueueOpen } = useShellStore(useShallow(({ queueOpen, setQueueOpen }) => ({ queueOpen, setQueueOpen })));
  const { fullscreen, setFullscreen } = usePlayerStore(useShallow(({ fullscreen, setFullscreen }) => ({ fullscreen, setFullscreen })));
  const gated = useGateStore((store) => store.locked);
  const trackLoaded = useSyncExternalStore(watchEngine, engineHasTrack, () => false);
  const side = useCustomizationStore((state) => state.navigation) === "side";
  const wallpaper = useCustomizationStore((state) => state.backgroundImage !== null);
  const railOpen = useCustomizationStore((state) => state.railOpen);
  const space = railSpace(side, railOpen);
  const pageLit = usePageLit();

  const onKaraokeRoute = pathname === KARAOKE_PATH;
  const studioPhase = usePresence(useStudioOpen());
  const karaokeShown = fullscreen || onKaraokeRoute;
  useUndoToast(trackLoaded && !karaokeShown && !gated);

  const [underlay, setUnderlay] = useState<ReactNode>(children);
  if (!onKaraokeRoute && underlay !== children) setUnderlay(children);

  const scroller = useRef<HTMLDivElement>(null);

  const drawnSpace = useRef(space);
  useLayoutEffect(() => {
    const from = drawnSpace.current - space;
    drawnSpace.current = space;
    if (from === 0 || reducedEffectsNow()) return;
    for (const box of scroller.current?.parentElement?.querySelectorAll(BESIDE_RAIL) ?? []) {
      box.animate([{ transform: `translateX(${from}px)` }, { transform: "none" }], {
        duration: DURATION_MS.base,
        easing: `cubic-bezier(${EASE.out.join(", ")})`,
      });
    }
  }, [space]);
  useScrollActivity(scroller);

  const settingsLink = pathname === "/settings" ? (new URLSearchParams(search).get("section") ?? "") : null;
  const { showSettings } = modal;
  useEffect(() => {
    if (settingsLink === null) return;
    showSettings(settingsLink);
    void navigate("/", STAY_IN_PLACE);
  }, [settingsLink, showSettings, navigate]);

  useScrollMemory(scroller, location, LEGACY_SCROLLERS);

  const leaveKaraoke = useCallback(() => {
    if (fullscreen) setFullscreen(false);
    else if (onKaraokeRoute) void navigate("/", STAY_IN_PLACE);
  }, [fullscreen, onKaraokeRoute, navigate, setFullscreen]);

  const emptyKaraoke = karaokeShown && !trackLoaded;
  useEffect(() => {
    if (emptyKaraoke) leaveKaraoke();
  }, [emptyKaraoke, leaveKaraoke]);

  const { closeSearch } = modal;
  useEffect(() => {
    if (!karaokeShown) return;
    closeSearch();
    setQueueOpen(false);
  }, [karaokeShown, setQueueOpen, closeSearch]);

  const onEntityPage = isEntityRoute(pathname);
  const escapeBack = useCallback(() => {
    const covered = karaokeShown || queueOpen || modal.searchOpen || hasOpenLayer();
    if (covered || !onEntityPage) return false;
    void (window.history.length > 1 ? navigate(-1) : navigate("/library"));
    return true;
  }, [karaokeShown, queueOpen, modal.searchOpen, onEntityPage, navigate]);

  const { openSearch } = modal;

  const openRecognize = () => {
    setFullscreen(false);
    if (pathname !== "/recognize") void navigate("/recognize");
  };

  useEffect(() => watchDepartures(), []);
  useLayoutEffect(() => arrive(), [location.key, pathname, search]);

  const wasFullscreen = useRef(fullscreen);
  useLayoutEffect(() => {
    if (wasFullscreen.current === fullscreen) return;
    wasFullscreen.current = fullscreen;
    flyToPlayer(fullscreen);
  }, [fullscreen]);

  useHistoryKeys(navigate, () => useGateStore.getState().locked || karaokeShown || modal.searchOpen || hasOpenLayer());
  useDisableButtonFocus();
  const unlocked =
    <T,>(action: () => T, otherwise: T) =>
    () =>
      useGateStore.getState().locked ? otherwise : action();
  useAppShortcuts({
    fullscreenOpen: karaokeShown,
    openFullscreen: unlocked(() => setFullscreen(true), undefined),
    closeFullscreen: leaveKaraoke,
    rightPanelOpen: queueOpen,
    openRightPanel: unlocked(() => setQueueOpen(true), undefined),
    closeRightPanel: () => setQueueOpen(false),
    searchOpen: modal.searchOpen,
    openSearch: unlocked(openSearch, undefined),
    closeSearch,
    onEscapeFallback: unlocked(escapeBack, false),
    openRecognize: unlocked(openRecognize, undefined),
  });
  const addMusic = useAddMusic();
  useImportToast();
  useWindowDrop(unlocked(openRecognize, undefined), (files) => {
    if (!useGateStore.getState().locked) void addMusic(files);
  });

  const chrome = karaokeShown ? null : (
    <motion.div
      key="chrome"
      variants={CHROME}
      initial={false}
      animate="shown"
      exit="hidden"
      transition={{ ease: EASE.in, duration: seconds(DURATION_MS.quick) }}
    >
      <TopBar />
    </motion.div>
  );

  return (
    <div
      className={styles.shell}
      data-edge={edgeToEdge ? "" : undefined}
      data-nav={side ? "side" : "top"}
      data-wallpaper={wallpaper ? "" : undefined}
      style={side ? ({ "--rail-space": `${space}px` } as CSSProperties) : undefined}
      onScroll={pinWindow}
    >
      <Field />
      {side ? <div className={styles.sheet} data-beside-rail data-player-below={trackLoaded && !gated ? "" : undefined} aria-hidden="true" /> : null}
      <AnimatePresence>{chrome}</AnimatePresence>
      <div
        ref={scroller}
        className={`${styles.content} n-scroll`}
        data-beside-rail
        data-locked={karaokeShown || modal.searchOpen ? "" : undefined}
        data-player-below={trackLoaded && (side || !pageLit) ? "" : undefined}
      >
        <ShellScrollContext.Provider value={scroller}>
          <div className={styles.column} data-page>
            {onKaraokeRoute ? underlay : children}
          </div>
        </ShellScrollContext.Provider>
      </div>
      {gated ? null : <Island />}
      {gated || karaokeShown || studioPhase ? null : <LookPreview />}
      {overlays}
      <ImportsHost />
      <ShareSheetHost />
      <TrimSheetHost />
      <SourceSheetHost />
      <LyricsToolsHost />
      <TourLayer />
      <KaraokeOverlay open={fullscreen} onClose={() => setFullscreen(false)} />
      {studioPhase ? <Studio phase={studioPhase} /> : null}
      {!fullscreen && onKaraokeRoute ? (
        <div className={styles.karaoke} data-theme="dark">
          <Karaoke onClose={leaveKaraoke} />
        </div>
      ) : null}
    </div>
  );
}
