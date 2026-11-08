import { useEffect, useState, type JSX } from "react";
import { Chip } from "../../components/Chip";
import { Menu } from "../../components/Menu";
import { Row } from "../../components/Row";
import { Sheet } from "../../components/Sheet";
import { useTranslation } from "../../ports/i18n";
import {
  PREVIEW_ROWS,
  displayText,
  importShare,
  lookupNames,
  previewRows,
  type CatalogTrack,
  type ImportPorts,
  type ImportSummary,
  type ImportTarget,
  type Share,
} from "../../ports/links";
import styles from "./SharePreview.module.css";

export interface SharePreviewProps {
  share: Share;
  ports: ImportPorts;
  /** The person's playlists, for "Add to". */
  playlists: { id: string; title: string }[];
  onClose(): void;
  onImported(summary: ImportSummary, unreadable: number): void;
}

/**
 * A shared playlist before anything happens: title, count, the first 12 songs and where they go.
 * Nothing is imported before Import. Mount it with `key` per share, so its state starts fresh.
 */
export function SharePreview({ share, ports, playlists, onClose, onImported }: SharePreviewProps): JSX.Element {
  const { t } = useTranslation();
  const [looked, setLooked] = useState<Map<number, CatalogTrack>>(new Map());
  const [target, setTarget] = useState<ImportTarget>({ kind: "new" });
  // the last anchor stays set while the menu fades out; the flag says whether it is up
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // names for the id-only songs on screen; closing the sheet stops the lookups
  useEffect(() => {
    const controller = new AbortController();
    const first = share.tracks.slice(0, PREVIEW_ROWS).map((_, index) => index);
    lookupNames(share, first, ports, controller.signal).then(setLooked, () => undefined);
    return () => controller.abort();
  }, [share, ports]);

  const untitled = t("ui.links.preview.untitled");
  const title = displayText(share.title) || untitled;
  const chosenPlaylist = target.kind === "playlist" ? playlists.find((playlist) => playlist.id === target.id) : undefined;

  const start = () => {
    setBusy(true);
    setFailed(false);
    importShare(share, target, untitled, ports, new AbortController().signal)
      .then(({ summary, unreadable }) => {
        if (summary) onImported(summary, unreadable);
        else setFailed(true);
      })
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      actions={[
        { label: t("common.cancel"), onClick: onClose },
        { label: t("ui.links.preview.import"), onClick: start, primary: true, disabled: busy },
      ]}
    >
      <div className={styles.body}>
        <p className={styles.caption}>{t("ui.links.preview.count", { count: share.tracks.length })}</p>
        <div className={`${styles.rows} n-scroll`}>
          {previewRows(share, looked).map((row) => (
            <Row
              key={row.index}
              variant="compact"
              leading={row.index + 1}
              title={row.missing ? t("ui.links.preview.missing") : displayText(row.title)}
              subtitle={displayText(row.artist)}
              data-missing={row.missing ? "" : undefined}
            />
          ))}
        </div>
        <div className={styles.targets} role="group" aria-label={t("ui.links.preview.target")}>
          <Chip active={target.kind === "new"} onClick={() => setTarget({ kind: "new" })}>
            {t("ui.links.preview.target_new")}
          </Chip>
          <Chip active={target.kind === "liked"} onClick={() => setTarget({ kind: "liked" })}>
            {t("ui.links.preview.target_liked")}
          </Chip>
          {playlists.length > 0 ? (
            <Chip
              active={target.kind === "playlist"}
              aria-haspopup="menu"
              onClick={(event) => {
                setPickerAnchor(event.currentTarget);
                setPickerOpen(true);
              }}
            >
              {chosenPlaylist ? displayText(chosenPlaylist.title) : t("common.add_to_playlist")}
            </Chip>
          ) : null}
        </div>
        {failed ? (
          <p className={styles.line} role="alert">
            {t("ui.links.preview.failed")}
          </p>
        ) : null}
      </div>
      <Menu
        open={pickerOpen}
        anchor={pickerAnchor}
        onClose={() => setPickerOpen(false)}
        items={playlists.map((playlist) => ({
          label: displayText(playlist.title),
          onSelect: () => setTarget({ kind: "playlist", id: playlist.id }),
        }))}
      />
    </Sheet>
  );
}
