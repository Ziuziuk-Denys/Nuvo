import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type JSX, type ReactNode, type UIEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { hasOpenLayer } from "../components/layers";
import { useScrollActivity } from "../components/useScrollActivity";
import { Field } from "../field/Field";
import { DURATION_MS, EASE, seconds } from "../motion";
import { useTranslation } from "../ports/i18n";
import { bootImports } from "../ports/importsRuntime";
import { Karaoke, KaraokeOverlay } from "../ports/karaoke";
import { useDisableButtonFocus, useModalStore, useWindowState } from "../ports/navigation";
import { onShareLink } from "../ports/links";
import { playerEngine, usePlayerStore } from "../ports/player";
import { useAppShortcuts } from "../ports/shortcuts";
import { useToolDownloadToast } from "./useToolDownloadToast";
import { useAppIconSync, useLookSync } from "../ports/theme";
import { ImportsHost } from "../screens/imports/ImportsHost";
import { LyricsToolsHost } from "../screens/lyrics/LyricsToolsHost";
import { Palette } from "../screens/palette/Palette";
import { useGateStore } from "../screens/lock/gateState";
import { useRecognizeDrop } from "../screens/recognize/recognizeDrop";
import { useUndoToast } from "../recs/UndoNotice";
import { ShareSheetHost } from "../sheets/ShareSheet";
import { SourceSheetHost } from "../sheets/SourceSheet";
import { TrimSheetHost } from "../sheets/TrimSheet";
import { Island } from "./island/Island";
import { isEntityRoute, navigateWithTransition } from "./navigate";
import { usePageLit } from "./pageLit";
import { Rail } from "./Rail";
import { ShellScrollContext } from "./scroller";
import { useShellStore } from "./shellStore";
import styles from "./Shell.module.css";
import { TopBar } from "./TopBar";
import { TourLayer } from "../tour/TourLayer";

export interface ShellProps {
  children: ReactNode;
  /** Sheets, banners and panels hosted above the page. */
  overlays?: ReactNode;
}

const KARAOKE_PATH = "/player";
const STAY_IN_PLACE = { replace: true } as const;
/** Legacy pages keep their own scroll boxes, found by the Tailwind class they use. */
const LEGACY_SCROLLERS = ".overflow-y-auto";

const CHROME = { hidden: { opacity: 0 } };

const watchEngine = (notify: () => void) => playerEngine.subscribe(notify);
const engineHasTrack = () => playerEngine.getSnapshot().currentTrack !== null;

/** Pins the window box at 0,0: focus may scroll an overflow:hidden box, the window must never move. */
function pinWindow(event: UIEvent<HTMLDivElement>): void {
  event.currentTarget.scrollTo(0, 0);
}

/** The window: the field, the top bar and the rail, one scrolling content column, legacy overlays and the karaoke view. */
export function Shell({ children, overlays }: ShellProps): JSX.Element {
  const { t } = useTranslation();
  useLookSync();
  useAppIconSync();
  useToolDownloadToast();
  // idempotent: builds the import runtime once, later calls only pass the current translator
  bootImports(t);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  // a shared link that opened Nuvo, or arrived while it ran, opens in search
  useEffect(() => onShareLink((link) => void navigate(`/search?link=1&q=${encodeURIComponent(link)}`)), [navigate]);
  const edgeToEdge = useWindowState().isEdgeToEdge;

  const modal = useModalStore(
    useShallow((store) => ({
      searchOpen: store.searchOpen,
      closeSearch: store.closeSearch,
      showSettings: store.openSettingsSection,
    })),
  );
  const { queueOpen, setQueueOpen } = useShellStore(useShallow(({ queueOpen, setQueueOpen }) => ({ queueOpen, setQueueOpen })));
  const { fullscreen, setFullscreen } = usePlayerStore(useShallow(({ fullscreen, setFullscreen }) => ({ fullscreen, setFullscreen })));
  const gated = useGateStore((store) => store.locked);
  const trackLoaded = useSyncExternalStore(watchEngine, engineHasTrack, () => false);
  const pageLit = usePageLit();

  const onKaraokeRoute = pathname === KARAOKE_PATH;
  const karaokeShown = fullscreen || onKaraokeRoute;
  useUndoToast(trackLoaded && !karaokeShown && !gated);

  // #/player is drawn over the page that was open before it, so that page stays mounted below
  const [underlay, setUnderlay] = useState<ReactNode>(children);
  if (!onKaraokeRoute && underlay !== children) setUnderlay(children);

  const scroller = useRef<HTMLDivElement>(null);
  useScrollActivity(scroller);

  // #/settings?section=about is a deep link: open that settings section over Home
  const settingsLink = pathname === "/settings" ? (new URLSearchParams(search).get("section") ?? "") : null;
  const { showSettings } = modal;
  useEffect(() => {
    if (settingsLink === null) return;
    showSettings(settingsLink);
    void navigate("/", STAY_IN_PLACE);
  }, [settingsLink, showSettings, navigate]);

  // every new location opens at its top, including legacy pages that scroll inside themselves
  const location = pathname + search;
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    for (const inner of [box, ...box.querySelectorAll(LEGACY_SCROLLERS)]) inner.scrollTop = 0;
  }, [location]);

  const leaveKaraoke = useCallback(() => {
    if (fullscreen) setFullscreen(false);
    else if (onKaraokeRoute) void navigate("/", STAY_IN_PLACE);
  }, [fullscreen, onKaraokeRoute, navigate, setFullscreen]);

  // karaoke without a track has nothing to show
  const emptyKaraoke = karaokeShown && !trackLoaded;
  useEffect(() => {
    if (emptyKaraoke) leaveKaraoke();
  }, [emptyKaraoke, leaveKaraoke]);

  // karaoke covers everything, so the queue and the search popup make way for it
  const { closeSearch } = modal;
  useEffect(() => {
    if (!karaokeShown) return;
    closeSearch();
    setQueueOpen(false);
  }, [karaokeShown, setQueueOpen, closeSearch]);

  // Escape on an album, artist or playlist page with nothing open over it goes back; an open sheet or menu takes it first
  const onEntityPage = isEntityRoute(pathname);
  const escapeBack = useCallback(() => {
    const covered = karaokeShown || queueOpen || modal.searchOpen || hasOpenLayer();
    if (covered || !onEntityPage) return false;
    void (window.history.length > 1 ? navigate(-1) : navigate("/library"));
    return true;
  }, [karaokeShown, queueOpen, modal.searchOpen, onEntityPage, navigate]);

  // the shortcut arrives like the rail's Search: the page rises in
  const openSearch = () => {
    if (pathname !== "/search") navigateWithTransition(navigate, "/search");
  };

  const openRecognize = () => {
    setFullscreen(false);
    if (pathname !== "/recognize") void navigate("/recognize");
  };

  useDisableButtonFocus();
  // while the library is locked the keys still play and pause, but nothing opens or navigates
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
  useRecognizeDrop(unlocked(openRecognize, undefined));

  const chrome = karaokeShown ? null : (
    <motion.div key="chrome" variants={CHROME} exit="hidden" transition={{ ease: EASE.in, duration: seconds(DURATION_MS.quick) }}>
      <TopBar />
      <Rail />
    </motion.div>
  );

  return (
    <div className={styles.shell} data-edge={edgeToEdge ? "" : undefined} onScroll={pinWindow}>
      <Field />
      <AnimatePresence>{chrome}</AnimatePresence>
      <div
        ref={scroller}
        className={`${styles.content} n-scroll`}
        data-locked={karaokeShown || modal.searchOpen ? "" : undefined}
        data-player-below={trackLoaded && !pageLit ? "" : undefined}
      >
        <ShellScrollContext.Provider value={scroller}>
          <div className={styles.column}>{onKaraokeRoute ? underlay : children}</div>
        </ShellScrollContext.Provider>
      </div>
      {gated ? null : <Island />}
      {overlays}
      <ImportsHost />
      <ShareSheetHost />
      <TrimSheetHost />
      <SourceSheetHost />
      <LyricsToolsHost />
      <Palette />
      <TourLayer />
      <KaraokeOverlay open={fullscreen} onClose={() => setFullscreen(false)} />
      {!fullscreen && onKaraokeRoute ? (
        <div className={styles.karaoke} data-theme="dark">
          <Karaoke onClose={leaveKaraoke} />
        </div>
      ) : null}
    </div>
  );
}
