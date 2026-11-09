import { useEffect, useState, type JSX } from "react";
import { create } from "zustand";
import { Button } from "../components/Button";
import { Sheet } from "../components/Sheet";
import { useTranslation } from "../ports/i18n";
import { buildShareLink, displayText, shareMessage, songLine, sourceUrl, textList, youtubeListUrl, type BuiltLink, type ShareItem } from "../ports/links";
import type { Track } from "../ports/player";
import styles from "./ShareSheet.module.css";

export interface ShareSheetProps {
  title: string;
  items: ShareItem[];
  onClose(): void;
}

/** What the sheet carries of a song: its id and names, never a file path. */
export function shareItemOf(track: Track): ShareItem {
  return { id: track.id, title: track.title, artist: track.artists, durationMs: track.durationMs };
}

interface ShareSheetState {
  open: { title: string; items: ShareItem[] } | null;
  show(title: string, items: ShareItem[]): void;
  close(): void;
}

export const useShareSheet = create<ShareSheetState>((set) => ({
  open: null,
  show: (title, items) => set({ open: { title, items } }),
  close: () => set({ open: null }),
}));

export function ShareSheetHost(): JSX.Element | null {
  const open = useShareSheet((state) => state.open);
  const close = useShareSheet((state) => state.close);
  return open ? <ShareSheet title={open.title} items={open.items} onClose={close} /> : null;
}

function saveFile(title: string, items: ShareItem[]): void {
  const tracks = items.map((item) => ({
    id: item.id,
    title: item.title,
    artists: item.artist ? [{ id: "", name: item.artist }] : [],
    durationMs: item.durationMs ?? 0,
  }));
  const blob = new Blob([JSON.stringify({ format: "nuvo-playlist", version: 1, title, tracks }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Nuvo"}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ShareSheet({ title, items, onClose }: ShareSheetProps): JSX.Element {
  const { t } = useTranslation();
  const [built, setBuilt] = useState<BuiltLink | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let live = true;
    buildShareLink(title, items).then(
      (next) => live && setBuilt(next),
      () => live && setBuilt(null),
    );
    return () => {
      live = false;
    };
  }, [title, items]);

  const single = items.length === 1 && !title;
  const youtube = single ? null : youtubeListUrl(items);
  const copy = (text: string, done: string) => {
    void navigator.clipboard.writeText(text).then(() => setStatus(done));
  };
  const heading = single
    ? songLine(items[0].artist, items[0].title)
    : t("ui.links.share.heading", { title: displayText(title), count: built?.trackCount ?? items.length });
  const copyLink = () => {
    if (built?.link) copy(shareMessage(heading, t("ui.links.share.open_in_nuvo"), built.link, single ? sourceUrl(items[0]) : null), t("ui.links.share.copied"));
  };

  return (
    <Sheet open onClose={onClose} title={t("ui.links.share.title")} actions={[{ label: t("common.close"), onClick: onClose }]}>
      <div className={styles.body}>
        <div>
          <p className={styles.heading}>{displayText(heading)}</p>
          {single ? null : (
            <ul className={styles.preview}>
              {items.slice(0, 3).map((item, index) => (
                <li key={`${item.id}-${index}`}>{displayText(songLine(item.artist, item.title))}</li>
              ))}
            </ul>
          )}
        </div>
        {built && built.skipped > 0 ? <p className={styles.note}>{t("ui.links.share.skipped", { count: built.skipped })}</p> : null}
        {built?.overBudget && built.copyAllowed ? <p className={styles.note}>{t("ui.links.share.long_link", { count: (built.link ?? "").length })}</p> : null}
        {built && !built.copyAllowed ? <p className={styles.note}>{t("ui.links.share.too_long")}</p> : null}
        <div className={styles.actions}>
          {built?.copyAllowed ? (
            <Button variant="primary" onClick={copyLink}>
              {built.overBudget ? t("ui.links.share.copy_long") : t("ui.links.share.copy_link")}
            </Button>
          ) : null}
          {youtube ? (
            <Button variant="secondary" onClick={() => copy(youtube.url, t("ui.links.share.copied"))}>
              {t("ui.links.share.copy_youtube")}
            </Button>
          ) : null}
          {single ? null : (
            <Button variant="secondary" onClick={() => copy(textList(items), t("ui.links.share.copied_text"))}>
              {t("ui.links.share.copy_text")}
            </Button>
          )}
          {single ? null : (
            <Button variant={built && !built.copyAllowed ? "primary" : "secondary"} onClick={() => saveFile(title, items)}>
              {t("ui.links.share.save_file")}
            </Button>
          )}
          <span className={styles.status} role="status">
            {status}
          </span>
        </div>
        {youtube && youtube.total > 50 ? <p className={styles.note}>{t("ui.links.share.youtube_first_50")}</p> : null}
      </div>
    </Sheet>
  );
}
