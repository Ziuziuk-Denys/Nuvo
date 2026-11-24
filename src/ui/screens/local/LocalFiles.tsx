import { useEffect, useMemo, useState, type JSX } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../icons/Icon";
import { useTranslation, type TFunction } from "../../ports/i18n";
import {
  addMusicFolder,
  removeMusicFolder,
  rescanMusicFolders,
  scanLine,
  skippedSummary,
  toPlayerTrack,
  useLocalRoots,
  useLocalScan,
  useLocalTracks,
} from "../../ports/localFiles";
import { playerEngine, type Track } from "../../ports/player";
import { EntityTracks } from "../entity/EntityTracks";
import look from "../look.module.css";
import { isMusicFile, useAddMusic } from "./addMusic";
import styles from "./LocalFiles.module.css";
import { sortLocal, type LibrarySort } from "../library/libraryModel";

type Skipped = NonNullable<ReturnType<typeof skippedSummary>>;

function skippedText(skipped: Skipped, t: TFunction): string {
  const kinds = [
    ...skipped.kinds.map((kind) =>
      kind.ext ? t("ui.local.skipped_kind", { ext: kind.ext, files: kind.count }) : t("ui.local.skipped_no_ext", { files: kind.count }),
    ),
    ...(skipped.links ? [t("ui.local.skipped_links", { count: skipped.links })] : []),
    ...(skipped.dirs ? [t("ui.local.skipped_dirs", { count: skipped.dirs })] : []),
  ].join(", ");
  return skipped.count ? t("ui.local.scan_skipped", { count: skipped.count, kinds }) : t("ui.local.scan_skipped_plain", { kinds });
}

export function LocalFiles({ query, sort = "artist" }: { query: string; sort?: LibrarySort }): JSX.Element {
  const { t } = useTranslation();
  const { roots, failed: rootsFailed, reload: reloadRoots } = useLocalRoots();
  const scan = useLocalScan();
  const { items, loading, failed: tracksFailed, reload: reloadTracks } = useLocalTracks(query.trim());
  const [error, setError] = useState<string | null>(null);
  const tracks = useMemo(() => sortLocal(items.map(toPlayerTrack), sort), [items, sort]);
  const shown = useMemo(() => tracks.map((track, index) => ({ track, index })), [tracks]);
  const reasons = useMemo(() => new Map(items.flatMap((item) => (item.unsupported ? [[item.track.id, item.unsupported] as const] : []))), [items]);
  const playable = useMemo(() => tracks.filter((track) => !reasons.has(track.id)), [tracks, reasons]);
  const unavailable = (track: Track) => {
    const reason = reasons.get(track.id);
    return reason ? t(`ui.local.unsupported_${reason}`) : null;
  };
  const add = async () => setError(await addMusicFolder());
  const addFiles = useAddMusic();
  const reading = scan?.scanning ? scan.read : null;
  // The folder counts come from the library, so they follow each batch of read files
  useEffect(() => {
    if (reading !== null) reloadRoots();
  }, [reading, reloadRoots]);
  const line = scanLine(scan, roots);
  const skipped = scan && !scan.scanning ? skippedSummary(scan) : null;
  const errorLine = error ? (
    <p className={styles.line} role="alert">
      {error}
    </p>
  ) : null;

  if (roots.length === 0 && rootsFailed) {
    return (
      <div className={styles.empty}>
        <EmptyState
          title={t("ui.library.load_error_title")}
          message={t("ui.library.load_error_message")}
          actions={[{ label: t("ui.library.retry"), primary: true, onClick: reloadRoots }]}
        />
      </div>
    );
  }

  if (roots.length === 0) {
    return (
      <div className={styles.empty}>
        <EmptyState
          title={t("ui.local.empty_title")}
          message={t("ui.local.empty_message")}
          actions={[
            { label: t("ui.local.add_files"), primary: true, onClick: () => void addFiles() },
            { label: t("ui.local.add_folder"), onClick: () => void add() },
          ]}
        />
        {errorLine}
      </div>
    );
  }

  return (
    <div className={styles.local}>
      <div className={styles.head}>
        <ul className={styles.folders}>
          {roots.map((root) => (
            <li key={root.id} className={`${look.chip} ${styles.folder}`} data-missing={root.status === "missing" ? "" : undefined} title={root.path}>
              <Icon name={isMusicFile(root.path) ? "track" : "folder"} size={14} />
              <span className={styles.path}>{root.path}</span>
              {root.status === "missing" ? (
                <span className={styles.missing}>
                  <Icon name="warning" size={14} />
                  {t("ui.local.folder_missing")}
                </span>
              ) : null}
              <span className={styles.count}>{t("ui.local.files", { count: root.files })}</span>
              <button
                type="button"
                className={styles.remove}
                aria-label={t("ui.local.remove_folder", { path: root.path })}
                onClick={() => void removeMusicFolder(root.id)}
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <button type="button" className={`${look.pill} ${look.glass}`} onClick={() => void addFiles()}>
            <Icon name="add" size={16} />
            {t("ui.local.add_files")}
          </button>
          <button type="button" className={`${look.pill} ${look.glass}`} onClick={() => void add()}>
            <Icon name="folder-add" size={16} />
            {t("ui.local.add_folder")}
          </button>
          <button type="button" className={look.icon} aria-label={t("ui.local.rescan")} title={t("ui.local.rescan")} onClick={() => void rescanMusicFolders()}>
            <Icon name="refresh" size={18} />
          </button>
        </div>
      </div>
      {line ? (
        <p className={styles.line} role="status">
          {t(line.key, line.vars)}
        </p>
      ) : null}
      {skipped ? <p className={styles.line}>{skippedText(skipped, t)}</p> : null}
      {errorLine}
      {tracksFailed ? (
        <p className={styles.line} role="alert">
          {t("ui.library.load_error_line")}{" "}
          <button type="button" className={`${look.pill} ${look.glass}`} onClick={reloadTracks}>
            {t("ui.library.retry")}
          </button>
        </p>
      ) : null}
      <div className={styles.rows} aria-busy={loading ? "true" : undefined}>
        <EntityTracks
          shown={shown}
          tracks={tracks}
          unavailable={unavailable}
          withAlbum
          onPlay={(track) => void playerEngine.playTrack(track, playable, "local:library", "")}
        />
      </div>
    </div>
  );
}
