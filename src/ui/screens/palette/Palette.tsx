import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Cover } from "../../components/Cover";
import { clamp, LAYER_ATTRIBUTE, pushLayer, usePresence } from "../../components/layers";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons";
import { getTranslationsForAllLocales, loadAllLocales, useTranslation } from "../../ports/i18n";
import { useLikedTracks, usePlaylistsList } from "../../ports/library";
import { routeLink } from "../../ports/links";
import { toggleWindowFullscreen, useModalStore } from "../../ports/navigation";
import { useOfflineMode, useStreamingReachable } from "../../ports/network";
import { isRadioContext, nextRepeatMode, playerEngine, usePlayerStore, type Track } from "../../ports/player";
import { loadSearchHistory, toSearchResult, useSearchAll, useSearchHistoryStore, type SearchHistoryItem, type SearchResult } from "../../ports/search";
import { shortcutKeycaps, useRecorderState, useShortcutBindings } from "../../ports/shortcuts";
import { applyTempo, BUILT_IN_PRESETS, TEMPO_PRESETS, useSoundStore, type TempoPresetKey } from "../../ports/sound";
import { navigateWithTransition } from "../../shell/navigate";
import { useTour } from "../../tour/tourStore";
import { formatDuration } from "../entity/entityModel";
import { useGateStore } from "../lock/gateState";
import { historyHref, localResults, subtitleOf } from "../search/searchModel";
import { SETTING_ITEMS } from "../settings/settingItems";
import { buildCommands, rankCommands, soundCommands } from "./commands";
import { paletteResults } from "./paletteModel";
import styles from "./Palette.module.css";

const PANEL_WIDTH = 640;
const PANEL_GAP = 8;
const EDGE = 12;
const ACTIONS_FOUND = 4;
const ACTIONS_SUGGESTED = 6;
const RECENT = 5;
const DEBOUNCE_MS = 150;
const CACHED_QUERIES = 30;
const LIMIT = 12;
const PALETTE_KEY = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent) ? "Super+K" : "Control+K";

const TEMPO_LABELS: Record<TempoPresetKey, string> = {
  normal: "sound.tempo.normal",
  slowed: "sound.tempo.slowed",
  slowedReverb: "sound.tempo.slowed_reverb",
  spedUp: "sound.tempo.sped_up",
  nightcore: "sound.tempo.nightcore",
  daycore: "sound.tempo.daycore",
};
const TEMPO_KEYS = (Object.keys(TEMPO_PRESETS) as TempoPresetKey[]).map((key) => ({ key, labelKey: TEMPO_LABELS[key] }));

type Section = "recent" | "top" | "actions" | "songs" | "collections" | "more";

interface Entry {
  key: string;
  section: Section;
  run(): void;
  queue?(): void;
}

// shortcut: lives as long as the window, enough to make typing back over a query instant
const answered = new Map<string, SearchResult[]>();

function applyEq(name: string): void {
  const store = useSoundStore.getState();
  if (!store.eqEnabled) store.setEnabled(true);
  if (store.bypass) store.setBypass(false);
  store.applyPreset(name);
}

function playTrack(track: Track): void {
  playerEngine.primeUserGesture();
  void playerEngine.playTrack(track, [track], "search");
}

export function PaletteField(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const open = useModalStore((state) => state.searchOpen);
  const openSearch = useModalStore((state) => state.openSearch);
  const closeSearch = useModalStore((state) => state.closeSearch);
  const locked = useGateStore((state) => state.locked);
  const recording = useRecorderState().kind === "recording";
  const phase = usePresence(open);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [count, setCount] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setQuery("");
      setSelected(0);
    }
  }
  const entries = useRef<Entry[]>([]);
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (locked && open) closeSearch();
  }, [locked, open, closeSearch]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // the code, not the key, so the Russian layout's Л works too
      if (useGateStore.getState().locked || recording || event.code !== "KeyK" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      const store = useModalStore.getState();
      if (store.searchOpen) store.closeSearch();
      else store.openSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [recording]);

  useEffect(() => {
    const input = inputRef.current;
    if (open) {
      input?.focus({ preventScroll: true });
      input?.select();
      return pushLayer(closeSearch);
    }
    if (input && document.activeElement === input) input.blur();
  }, [open, closeSearch]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || fieldRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(`[${LAYER_ATTRIBUTE}]`)) return;
      closeSearch();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, closeSearch]);

  const changeQuery = (value: string) => {
    setQuery(value);
    setSelected(0);
  };

  const openLink = (text: string): boolean => {
    if (!routeLink(text)) return false;
    closeSearch();
    void navigate(`/search?link=1&q=${encodeURIComponent(text.trim())}`);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const list = entries.current;
    const at = Math.min(selected, list.length - 1);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (list.length > 0) setSelected((at + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length);
    } else if (event.key === "Tab" && list.length > 0) {
      event.preventDefault();
      const order = [...new Set(list.map((entry) => entry.section))];
      const current = order.indexOf(list[at].section);
      const next = order[(current + (event.shiftKey ? -1 : 1) + order.length) % order.length];
      setSelected(list.findIndex((entry) => entry.section === next));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (openLink(query)) return;
      const entry = list[at];
      if (!entry) return;
      if (event.shiftKey && entry.queue) entry.queue();
      else entry.run();
    }
  };

  const keycaps = open ? [{ text: "Esc", label: "Escape" }] : shortcutKeycaps(PALETTE_KEY);

  return (
    <>
      <div ref={fieldRef} className={styles.field} data-open={open ? "" : undefined} data-no-window-drag>
        <Icon name="search" size={18} />
        <input
          ref={inputRef}
          className={styles.input}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && count > 0 ? `${listId}-${Math.min(selected, count - 1)}` : undefined}
          aria-label={t("ui.palette.field")}
          placeholder={t("ui.palette.field")}
          value={query}
          spellCheck={false}
          autoComplete="off"
          onFocus={() => {
            if (!open && !locked) openSearch();
          }}
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            if (openLink(event.clipboardData.getData("text"))) event.preventDefault();
          }}
        />
        <span className={styles.keys} aria-hidden="true">
          {keycaps.map((cap) => (
            <kbd key={cap.label} className={styles.key}>
              {cap.text}
            </kbd>
          ))}
        </span>
      </div>
      {phase === null
        ? null
        : createPortal(
            <PalettePanel
              panelRef={panelRef}
              fieldRef={fieldRef}
              phase={phase}
              query={query}
              selected={selected}
              listId={listId}
              onEntries={(list) => {
                entries.current = list;
                setCount(list.length);
              }}
              onSelect={setSelected}
              onQuery={(value) => {
                changeQuery(value);
                inputRef.current?.focus();
              }}
              onClose={closeSearch}
            />,
            document.body,
          )}
    </>
  );
}

interface PanelProps {
  panelRef: RefObject<HTMLDivElement | null>;
  fieldRef: RefObject<HTMLDivElement | null>;
  phase: "in" | "out";
  query: string;
  selected: number;
  listId: string;
  onEntries(list: Entry[]): void;
  onSelect(index: number): void;
  onQuery(value: string): void;
  onClose(): void;
}

function usePlace(fieldRef: RefObject<HTMLDivElement | null>) {
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const field = fieldRef.current?.getBoundingClientRect();
      if (!field) return;
      const width = Math.min(PANEL_WIDTH, window.innerWidth - EDGE * 2);
      const left = clamp(field.left + field.width / 2 - width / 2, EDGE, window.innerWidth - width - EDGE);
      setBox({ top: field.bottom + PANEL_GAP, left, width });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [fieldRef]);
  return box;
}

function PalettePanel({ panelRef, fieldRef, phase, query, selected, listId, onEntries, onSelect, onQuery, onClose }: PanelProps): JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const box = usePlace(fieldRef);
  const openSettings = useModalStore((state) => state.openSettings);
  const openSettingsSection = useModalStore((state) => state.openSettingsSection);
  const bindingOf = useShortcutBindings();
  const eqEnabled = useSoundStore((state) => state.eqEnabled);
  const ownPresets = useSoundStore((state) => state.customPresets);
  const history = useSearchHistoryStore((state) => state.items);
  const addHistory = useSearchHistoryStore((state) => state.addItem);
  const offlineMode = useOfflineMode();
  const online = useStreamingReachable() && !offlineMode;
  const liked = useLikedTracks();
  const library = usePlaylistsList();
  const [, setLocalesLoaded] = useState(false);
  const trimmed = query.trim();
  const isLink = routeLink(query) !== null;

  useEffect(() => {
    let live = true;
    void loadAllLocales().then(() => live && setLocalesLoaded(true));
    void loadSearchHistory();
    return () => {
      live = false;
    };
  }, []);

  const search = useSearchAll(isLink ? "" : query, { enabled: online, limit: LIMIT, debounceMs: DEBOUNCE_MS });
  const local = useMemo(() => localResults(trimmed, liked.data.tracks, library.data.playlists), [trimmed, liked.data.tracks, library.data.playlists]);
  const key = trimmed.toLowerCase();
  const fetched = useMemo(() => search.items.map(toSearchResult), [search.items]);
  useEffect(() => {
    if (!search.hasLoaded || fetched.length === 0) return;
    answered.delete(key);
    answered.set(key, fetched);
    if (answered.size > CACHED_QUERIES) answered.delete(answered.keys().next().value!);
  }, [search.hasLoaded, fetched, key]);
  const shown = search.hasLoaded ? fetched : (answered.get(key) ?? fetched);
  const found = useMemo(() => paletteResults(local, shown), [local, shown]);

  const go = (href: string) => navigateWithTransition(navigate, href);
  const withTrack = (action: (track: Track) => void) => () => {
    const track = playerEngine.getSnapshot().currentTrack;
    if (track) action(track);
  };
  const commands = buildCommands({
    t,
    translations: getTranslationsForAllLocales,
    shortcuts: (commandId) => bindingOf(commandId, "app"),
    settingItems: SETTING_ITEMS,
    openSettings: openSettingsSection,
    actions: {
      home: () => go("/"),
      library: () => go("/library"),
      search: () => go(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search"),
      settings: openSettings,
      play_pause: () => playerEngine.togglePlayPause(),
      next: () => void playerEngine.skipNext(),
      previous: () => void playerEngine.skipPrevious(),
      radio: withTrack((track) => void playerEngine.startRadioStation(track)),
      lyrics: withTrack(() => usePlayerStore.getState().setFullscreen(true)),
      shuffle: () => playerEngine.setShuffle(!playerEngine.getSnapshot().shuffle),
      repeat: () => {
        const snapshot = playerEngine.getSnapshot();
        playerEngine.setRepeat(nextRepeatMode(snapshot.repeat, isRadioContext(snapshot.playbackContext)));
      },
      fullscreen: toggleWindowFullscreen,
      tour: () => useTour.getState().replay(),
    },
  });
  commands.push(
    ...soundCommands({
      t,
      translations: getTranslationsForAllLocales,
      eqOn: eqEnabled,
      eqPresets: Object.keys(BUILT_IN_PRESETS),
      ownPresets: Object.keys(ownPresets),
      tempoPresets: TEMPO_KEYS,
      toggleEq: () => useSoundStore.getState().setEnabled(!eqEnabled),
      applyEq,
      applyTempo: (key) => applyTempo(TEMPO_PRESETS[key as TempoPresetKey]),
    }),
  );
  const actions = rankCommands(commands, trimmed).slice(0, trimmed ? ACTIONS_FOUND : ACTIONS_SUGGESTED);
  const recent = trimmed ? [] : history.slice(0, RECENT);

  const close = (action: () => void) => () => {
    onClose();
    action();
  };
  const remember = (result: SearchResult) =>
    addHistory({
      id: result.id,
      type: result.kind === "song" ? "track" : result.kind,
      title: result.title,
      subtitle: result.subtitle,
      coverUrl: result.cover,
      durationMs: result.durationMs,
      itemData: result.track ?? { href: result.href },
    });
  const openResult = (result: SearchResult) =>
    close(() => {
      remember(result);
      if (result.track) playTrack(result.track);
      else if (result.href) go(result.href);
    });
  const queueResult = (result: SearchResult) => (result.track ? close(() => playerEngine.addToQueue(result.track!)) : undefined);
  const openRecent = (item: SearchHistoryItem) => {
    if (item.type === "query") return () => onQuery(item.title);
    if (item.type === "track") return close(() => item.itemData && playTrack(item.itemData as Track));
    return close(() => go(historyHref(item)));
  };

  const list: Entry[] = [
    ...recent.map((item) => ({ key: `recent:${item.id}`, section: "recent" as const, run: openRecent(item) })),
    ...(found.top && trimmed ? [{ key: "top", section: "top" as const, run: openResult(found.top), queue: queueResult(found.top) }] : []),
    ...actions.map((command) => ({ key: `action:${command.id}`, section: "actions" as const, run: close(command.run) })),
    ...(trimmed ? found.songs : []).map((song) => ({ key: `song:${song.id}`, section: "songs" as const, run: openResult(song), queue: queueResult(song) })),
    ...(trimmed ? found.collections : []).map((entry) => ({ key: `entry:${entry.kind}:${entry.id}`, section: "collections" as const, run: openResult(entry) })),
    ...(trimmed && online ? [{ key: "more", section: "more" as const, run: close(() => go(`/search?q=${encodeURIComponent(trimmed)}`)) }] : []),
  ];
  useLayoutEffect(() => onEntries(list));
  const active = Math.min(selected, list.length - 1);
  const indexOf = (key: string) => list.findIndex((entry) => entry.key === key);
  const rowProps = (key: string) => {
    const index = indexOf(key);
    return {
      id: `${listId}-${index}`,
      "data-selected": index === active ? "" : undefined,
      onMouseMove: () => index !== active && onSelect(index),
      onClick: () => list[index].run(),
    };
  };

  if (!box) return null;

  const actionRows = (
    <Group label={t(trimmed ? "ui.palette.actions" : "ui.palette.suggested")}>
      {actions.map((command) => (
        <div
          key={command.id}
          role="option"
          aria-selected={indexOf(`action:${command.id}`) === active}
          className={styles.action}
          {...rowProps(`action:${command.id}`)}
        >
          <span className={styles.actionTitle}>{command.title}</span>
          {command.shortcut ? <Keycaps accelerator={command.shortcut} /> : null}
        </div>
      ))}
    </Group>
  );

  const searching = trimmed !== "" && online && search.loading && found.songs.length === 0 && !found.top;
  const nothing = trimmed !== "" && !searching && !found.top && found.songs.length === 0 && found.collections.length === 0;

  let body: ReactNode;
  if (!trimmed) {
    body = (
      <div className={styles.single}>
        {recent.length > 0 ? (
          <div className={styles.recent} role="group" aria-label={t("ui.search.recent")}>
            <span className={styles.recentLabel}>{t("ui.palette.recent")}</span>
            {recent.map((item) => (
              <button key={item.id} type="button" tabIndex={-1} className={styles.chip} {...rowProps(`recent:${item.id}`)}>
                <Icon name={item.type === "query" ? "history" : kindIcon(item.type)} size={14} />
                <span>{item.title}</span>
              </button>
            ))}
          </div>
        ) : null}
        {actionRows}
      </div>
    );
  } else {
    body = (
      <div className={styles.split}>
        <div className={styles.column}>
          {found.top ? (
            <Group label={t("ui.search.top")}>
              <div role="option" aria-selected={indexOf("top") === active} className={styles.top} data-top="" {...rowProps("top")}>
                <Cover src={found.top.cover} size={72} radius={10} shape={found.top.kind === "artist" ? "circle" : "square"} />
                <span className={styles.topTitle}>{found.top.title}</span>
                <span className={styles.meta}>{subtitleOf(found.top, t)}</span>
              </div>
            </Group>
          ) : null}
          {actions.length > 0 ? actionRows : null}
        </div>
        <div className={styles.column}>
          {searching ? <p className={styles.line}>{t("ui.search.searching")}</p> : null}
          {nothing ? <p className={styles.line}>{t("ui.search.none", { query: trimmed })}</p> : null}
          {found.songs.length > 0 ? (
            <Group label={t("ui.search.tab_songs")}>
              {found.songs.map((song) => (
                <ResultRow
                  key={song.id}
                  result={song}
                  meta={formatDuration(song.track?.durationMs ?? song.durationMs ?? 0)}
                  selected={indexOf(`song:${song.id}`) === active}
                  {...rowProps(`song:${song.id}`)}
                />
              ))}
            </Group>
          ) : null}
          {found.collections.length > 0 ? (
            <Group label={t("ui.palette.collections")}>
              {found.collections.map((entry) => (
                <ResultRow
                  key={`${entry.kind}:${entry.id}`}
                  result={entry}
                  subtitle={subtitleOf(entry, t)}
                  selected={indexOf(`entry:${entry.kind}:${entry.id}`) === active}
                  {...rowProps(`entry:${entry.kind}:${entry.id}`)}
                />
              ))}
            </Group>
          ) : null}
          {trimmed && online ? (
            <div role="option" aria-selected={indexOf("more") === active} className={styles.more} {...rowProps("more")}>
              {t("ui.palette.show_all", { query: trimmed })}
              <Icon name="forward" size={16} />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.frame} style={{ top: box.top, left: box.left, width: box.width }} {...{ [LAYER_ATTRIBUTE]: "" }}>
      {/* rows never take focus: typing stays in the field */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t("ui.search.label")}
        className={styles.panel}
        data-state={phase}
        onMouseDown={(event) => event.preventDefault()}
      >
        <div id={listId} role="listbox" aria-label={t("ui.search.label")} className={styles.body}>
          {body}
        </div>
        <div className={styles.foot} aria-hidden="true">
          <span>
            <b>Enter</b> {t("ui.palette.hint_open")}
          </span>
          <span>
            <b>Shift Enter</b> {t("ui.palette.hint_queue")}
          </span>
          <span>
            <b>Tab</b> {t("ui.palette.hint_section")}
          </span>
          <span className={styles.end}>
            <b>Esc</b> {t("ui.palette.hint_close")}
          </span>
        </div>
      </div>
    </div>
  );
}

function kindIcon(type: SearchHistoryItem["type"]): IconName {
  if (type === "track") return "track";
  if (type === "artist") return "artist";
  if (type === "album") return "album";
  return "playlist";
}

function Group({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div role="group" aria-label={label} className={styles.group}>
      <div aria-hidden="true" className={styles.label}>
        {label}
      </div>
      {children}
    </div>
  );
}

interface ResultRowProps {
  id: string;
  result: SearchResult;
  subtitle?: string;
  meta?: string;
  selected: boolean;
  "data-selected"?: string;
  onMouseMove(): void;
  onClick(): void;
}

function ResultRow({ result, subtitle, meta, selected, ...rest }: ResultRowProps): JSX.Element {
  return (
    <div role="option" aria-selected={selected} className={styles.row} {...rest}>
      <span className={styles.cover}>
        <Cover src={result.cover} size={38} radius={6} shape={result.kind === "artist" ? "circle" : "square"} fetchPriority="low" />
        {result.track ? (
          <span className={styles.over} aria-hidden="true">
            <Icon name="play" size={16} />
          </span>
        ) : null}
      </span>
      <span className={styles.text}>
        <span className={styles.title}>{result.title}</span>
        <span className={styles.meta}>{subtitle ?? result.subtitle}</span>
      </span>
      {meta ? <span className={styles.time}>{meta}</span> : null}
    </div>
  );
}

function Keycaps({ accelerator }: { accelerator: string }): JSX.Element {
  return (
    <span className={styles.keys}>
      {shortcutKeycaps(accelerator).map((cap, index) => (
        <kbd key={index} className={styles.key} aria-label={cap.label}>
          {cap.text}
        </kbd>
      ))}
    </span>
  );
}
