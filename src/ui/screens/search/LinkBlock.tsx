import { useEffect, useRef, useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { Cover } from "../../components/Cover";
import { IconButton } from "../../components/IconButton";
import { Menu, type MenuItem } from "../../components/Menu";
import { Row } from "../../components/Row";
import { useTranslation } from "../../ports/i18n";
import { DislikeButton } from "../../recs/DislikeButton";
import {
  errorMessage,
  listenAgain,
  notFoundMessage,
  resolveLink,
  routeLink,
  serviceLabel,
  songLine,
  stageMessage,
  toPlayerTrack,
  viaMessage,
  type CatalogTrack,
  type ImportService,
  type LinkPorts,
  type LinkResult,
  type LinkRoute,
  type Message,
  type Service,
  type Share,
  type Stage,
} from "../../ports/links";
import type { Track } from "../../ports/player";
import { formatDuration } from "../entity/entityModel";
import searchStyles from "./Search.module.css";
import styles from "./LinkBlock.module.css";

export interface LinkBlockProps {
  text: string;
  ports: LinkPorts;
  onPlay(track: Track): void;
  onLike(track: Track): void;
  onAddToPlaylist(track: Track, anchor: HTMLElement): void;
  onSearch(query: string): void;
  onImport?(service: ImportService, url: string): void;
  onShare(share: Share): void;
  onNavigate(path: string): void;
  onOpenExternal(url: string): void;
  onImportFile(): void;
  onSlow(slow: boolean): void;
}

type Work = { kind: "route" } | { kind: "listen"; url: string; part: 0 | 1 };
type State = { phase: "working"; stage: Stage | null } | { phase: "done"; result: LinkResult };

const PROGRESS_DELAY_MS = 300;
const MAX_OTHERS = 5;

const SERVICE_OF_KIND: Partial<Record<LinkRoute["kind"], Service>> = {
  share: "nuvo",
  navigate: "nuvo",
  youtube: "youtube",
  tiktok: "tiktok",
  "tiktok-sound": "tiktok",
  soundcloud: "soundcloud",
  "apple-song": "apple-music",
  "deezer-track": "deezer",
  "yandex-track": "yandex",
  shazam: "shazam",
};

const NAVIGATE_PATHS = {
  artist: "/artist?id=",
  album: "/collection?type=album&id=",
  playlist: "/collection?type=playlist&id=",
} as const;

function routeService(route: LinkRoute): Service {
  if (route.kind === "error" || route.kind === "short" || route.kind === "import") return route.service;
  return SERVICE_OF_KIND[route.kind] ?? "web";
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export function LinkBlock(props: LinkBlockProps): JSX.Element {
  const { t } = useTranslation();
  const say = ({ key, vars }: Message) => t(key, vars);
  const route = routeLink(props.text);
  const [work, setWork] = useState<Work>({ kind: "route" });
  const [state, setState] = useState<State>({ phase: "working", stage: null });
  const [slow, setSlow] = useState(false);
  const [chosen, setChosen] = useState<CatalogTrack | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => setWork({ kind: "route" }), [props.text]);

  useEffect(() => {
    propsRef.current.onSlow(slow);
  }, [slow]);
  useEffect(() => () => propsRef.current.onSlow(false), []);

  useEffect(() => {
    if (!route) return;
    const controller = new AbortController();
    const report = (stage: Stage) => setState({ phase: "working", stage });
    setState({ phase: "working", stage: null });
    setChosen(null);
    setShowOthers(false);
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), PROGRESS_DELAY_MS);
    const job =
      work.kind === "listen"
        ? listenAgain(work.url, work.part, propsRef.current.ports, report, controller.signal)
        : resolveLink(route, propsRef.current.ports, report, controller.signal);
    job.then(
      (result) => {
        window.clearTimeout(timer);
        setSlow(false);
        setState({ phase: "done", result });
        const p = propsRef.current;
        if (result.kind === "share") p.onShare(result.share);
        if (result.kind === "import") p.onImport?.(result.service, result.url);
        if (result.kind === "navigate") p.onNavigate(NAVIGATE_PATHS[result.type] + encodeURIComponent(result.id));
      },
      () => {
        window.clearTimeout(timer);
        if (controller.signal.aborted) return;
        setSlow(false);
        setState({ phase: "done", result: { kind: "error", code: "failed", service: routeService(route) } });
      },
    );
    // closing the block aborts the recognize stream, which stops the daemon's child processes
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `route` follows `props.text`
  }, [props.text, work]);

  if (!route) return <></>;
  const source = serviceLabel(routeService(route), t);
  const originalUrl = "url" in route ? route.url : undefined;
  const working = state.phase === "working";

  return (
    <section className={`${styles.block} n-enter`} aria-busy={working} aria-label={source}>
      <p className={styles.source}>{source}</p>
      {working ? (
        <p key={state.stage ? say(stageMessage(state.stage)) : "start"} className={styles.stage} role="status">
          {state.stage ? say(stageMessage(state.stage)) : ""}
        </p>
      ) : (
        renderResult(state.result)
      )}
    </section>
  );

  function renderResult(result: LinkResult): JSX.Element | null {
    switch (result.kind) {
      case "track": {
        const unsure = !result.sure && !chosen;
        return (
          <>
            {trackRow(chosen ?? result.track, result.listenUrl)}
            <p className={styles.caption}>
              {unsure ? `${t("ui.links.probably")} · ` : ""}
              {chosen ? t("ui.links.via.by_name") : say(viaMessage(result.via))}
            </p>
            {result.playlistUrl && props.onImport ? (
              <div className={styles.actions}>
                <Button variant="text" size="s" onClick={() => props.onImport?.("youtube", result.playlistUrl as string)}>
                  {t("ui.links.import_playlist")}
                </Button>
              </div>
            ) : null}
            {unsure && result.others.length > 0 ? others(result.others.slice(0, MAX_OTHERS)) : null}
          </>
        );
      }
      case "not_found":
        return (
          <>
            <p className={styles.message}>{say(notFoundMessage(result))}</p>
            {result.proposal ? (
              <>
                {trackRow(result.proposal, result.listenUrl)}
                <p className={styles.caption}>{t("ui.links.probably")}</p>
              </>
            ) : null}
            {result.title || (result.more && result.listenUrl) ? (
              <div className={styles.actions}>
                {result.title ? (
                  <Button variant="text" size="s" onClick={() => props.onSearch(`${result.author ?? ""} ${result.title}`.trim())}>
                    {t("ui.links.search_for_it")}
                  </Button>
                ) : null}
                {result.more && result.listenUrl ? (
                  <Button variant="text" size="s" onClick={() => setWork({ kind: "listen", url: result.listenUrl as string, part: 1 })}>
                    {t("ui.links.try_another_part")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        );
      case "import":
        return props.onImport ? null : <p className={styles.message}>{say(errorMessage("unsupported", source, hostOf(result.url)))}</p>;
      case "error":
        return (
          <>
            <p className={styles.message}>{say(errorMessage(result.code, serviceLabel(result.service, t), result.host))}</p>
            {result.code === "spotify_file_only" ? (
              <div className={styles.actions}>
                <Button variant="text" size="s" onClick={props.onImportFile}>
                  {t("ui.links.import_file")}
                </Button>
              </div>
            ) : null}
          </>
        );
      default:
        return null;
    }
  }

  function trackRow(catalogTrack: CatalogTrack, listenUrl?: string): JSX.Element {
    const track = toPlayerTrack(catalogTrack);
    const name = songLine(track.artists, track.title);
    const items: MenuItem[] = [
      { label: t("common.like"), onSelect: () => props.onLike(track) },
      { label: t("common.add_to_playlist"), onSelect: () => menuAnchor && props.onAddToPlaylist(track, menuAnchor) },
      { label: t("ui.links.copy_name", { name }), onSelect: () => void navigator.clipboard?.writeText(name) },
      ...(originalUrl ? [{ label: t("ui.links.open_original"), onSelect: () => props.onOpenExternal(originalUrl) }] : []),
      ...(listenUrl ? [{ label: t("ui.links.listen_video"), onSelect: () => setWork({ kind: "listen", url: listenUrl, part: 0 }) }] : []),
    ];
    return (
      <div className={searchStyles.rows}>
        <Row
          variant="track"
          data-selected={menuOpen ? "" : undefined}
          leading={<Cover src={track.coverUrl ?? ""} size={40} />}
          title={track.title}
          subtitle={track.artists}
          meta={formatDuration(track.durationMs)}
          onActivate={() => props.onPlay(track)}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuAnchor(event.currentTarget);
            setMenuOpen(true);
          }}
          actions={
            <>
              <IconButton icon="play" label={t("ui.links.play")} size="s" onClick={() => props.onPlay(track)} />
              <DislikeButton track={track} size="s" />
              <IconButton
                icon="playlist-add"
                label={t("common.add_to_playlist")}
                size="s"
                onClick={(event) => props.onAddToPlaylist(track, event.currentTarget)}
              />
              <IconButton
                icon="more"
                label={t("common.more")}
                size="s"
                tooltip={!menuOpen}
                onClick={(event) => {
                  setMenuAnchor(event.currentTarget);
                  setMenuOpen(true);
                }}
              />
            </>
          }
        />
        <Menu open={menuOpen} anchor={menuAnchor} onClose={() => setMenuOpen(false)} items={items} />
      </div>
    );
  }

  function others(list: CatalogTrack[]): JSX.Element {
    return (
      <div className={styles.others}>
        <div className={styles.actions}>
          <Button variant="text" size="s" aria-expanded={showOthers} onClick={() => setShowOthers((open) => !open)}>
            {t("ui.links.choose_another")}
          </Button>
        </div>
        {showOthers ? (
          <div className={searchStyles.rows}>
            {list.map((other) => {
              const track = toPlayerTrack(other);
              return (
                <Row
                  key={other.id}
                  variant="compact"
                  title={track.title}
                  subtitle={track.artists}
                  meta={formatDuration(track.durationMs)}
                  onActivate={() => {
                    setChosen(other);
                    setShowOthers(false);
                  }}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }
}
