import { useEffect, useId, useState, type JSX } from "react";
import { create } from "zustand";
import { IconButton } from "../components/IconButton";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons";
import { useTranslation } from "../ports/i18n";
import { buildShareLink, displayText, shareMessage, songLine, sourceUrl, textList, youtubeListUrl, type BuiltLink, type ShareItem } from "../ports/links";
import type { Track } from "../ports/player";
import { GlassSheet } from "./GlassSheet";
import glass from "./GlassSheet.module.css";
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

type Copied = "link" | "youtube" | "text";

export function ShareSheet({ title, items, onClose }: ShareSheetProps): JSX.Element {
  const { t } = useTranslation();
  const [built, setBuilt] = useState<BuiltLink | null>(null);
  const [copied, setCopied] = useState<{ what: Copied; status: string } | null>(null);
  const headingId = useId();

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
  const copy = (what: Copied, text: string, status: string) => {
    void navigator.clipboard.writeText(text).then(() => setCopied({ what, status }));
  };
  const heading = single
    ? songLine(items[0].artist, items[0].title)
    : t("ui.links.share.heading", { title: displayText(title), count: built?.trackCount ?? items.length });
  const copyLink = () => {
    if (built?.link)
      copy("link", shareMessage(heading, t("ui.links.share.open_in_nuvo"), built.link, single ? sourceUrl(items[0]) : null), t("ui.links.share.copied"));
  };
  const option = (icon: IconName, label: string, onClick: () => void, what?: Copied, hint?: string) => {
    const done = what !== undefined && copied?.what === what;
    return (
      <button
        type="button"
        className={styles.option}
        data-done={done ? "" : undefined}
        aria-label={done ? copied.status : label}
        aria-describedby={hint ? `${headingId}-${icon}` : undefined}
        onClick={onClick}
      >
        <span className={styles.glyph} key={done ? "done" : "idle"}>
          <Icon name={done ? "check" : icon} size={18} />
        </span>
        <span className={styles.text}>
          <span className={styles.label}>{done ? copied.status : label}</span>
          {hint ? (
            <span id={`${headingId}-${icon}`} className={styles.hint}>
              {hint}
            </span>
          ) : null}
        </span>
      </button>
    );
  };
  const artists = [...new Set(items.map((item) => item.artist).filter(Boolean))].slice(0, 3).join(", ");
  const linkHint =
    [
      built?.overBudget ? t("ui.links.share.long_link", { count: (built.link ?? "").length }) : "",
      built && built.skipped > 0 ? `${t("ui.links.share.skipped", { count: built.skipped })}.` : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <GlassSheet open onClose={onClose} labelledBy={headingId} width={380}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 id={headingId} className={glass.title}>
            {displayText(heading)}
          </h2>
          {single || !artists ? null : <p className={styles.artists}>{displayText(artists)}</p>}
        </div>
        <IconButton icon="close" label={t("common.close")} size="s" tone="solo" tooltip={false} className={styles.close} onClick={onClose} />
      </div>
      <div className={styles.options}>
        {built && !built.copyAllowed ? (
          <p className={styles.note}>
            {t("ui.links.share.too_long")}
            {built.skipped > 0 ? ` ${t("ui.links.share.skipped", { count: built.skipped })}.` : null}
          </p>
        ) : null}
        {built?.copyAllowed
          ? option("link", built.overBudget ? t("ui.links.share.copy_long") : t("ui.links.share.copy_link"), copyLink, "link", linkHint)
          : null}
        {youtube
          ? option(
              "external",
              t("ui.links.share.copy_youtube"),
              () => copy("youtube", youtube.url, t("ui.links.share.copied")),
              "youtube",
              youtube.total > 50 ? t("ui.links.share.youtube_first_50") : undefined,
            )
          : null}
        {single ? null : option("copy", t("ui.links.share.copy_text"), () => copy("text", textList(items), t("ui.links.share.copied_text")), "text")}
        {single ? null : option("download", t("ui.links.share.save_file"), () => saveFile(title, items))}
      </div>
      <p className={styles.live} role="status">
        {copied?.status}
      </p>
    </GlassSheet>
  );
}
