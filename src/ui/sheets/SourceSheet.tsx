import { useEffect, useState, type JSX } from "react";
import { create } from "zustand";
import { Cover } from "../components/Cover";
import { Sheet } from "../components/Sheet";
import { useToastStore } from "../feedback/toastStore";
import { Icon } from "../icons/Icon";
import { useTranslation } from "../ports/i18n";
import { chooseSource, chosenSource, type Track } from "../ports/player";
import { useSearchTracks } from "../ports/search";
import { formatDuration } from "../screens/entity/entityModel";
import { MediaRow } from "../screens/MediaRow";
import styles from "./TrimSheet.module.css";

const VERSIONS = 8;

/** The one source picker of the window: the track menu opens it, the shell hosts it. */
export const useSourceSheet = create<{ track: Track | null; open(track: Track): void; close(): void }>((set) => ({
  track: null,
  open: (track) => set({ track }),
  close: () => set({ track: null }),
}));

/** The song's own source first, then other versions the catalog finds for it; the one that plays is ticked. */
function SourcePicker({ track, onClose }: { track: Track; onClose(): void }): JSX.Element {
  const { t } = useTranslation();
  // undefined while the daemon answers, null for the original
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const { tracks, loading } = useSearchTracks(`${track.artists} ${track.title}`, { limit: VERSIONS + 1 });
  const versions = tracks.filter((version) => version.id !== track.id).slice(0, VERSIONS);

  useEffect(() => {
    let live = true;
    void chosenSource(track.id).then(
      (answer) => live && setChosen(answer?.reason === "pinned" ? answer.altId : null),
      () => live && setChosen(null),
    );
    return () => {
      live = false;
    };
  }, [track.id]);

  const pick = (version: Track | null) => {
    onClose();
    void chooseSource(track.id, version ? { id: version.id, durationMs: version.durationMs } : null).then(
      () => useToastStore.getState().show({ message: t(version ? "ui.source.chosen" : "ui.source.original_back"), variant: "checkmark" }),
      () => useToastStore.getState().show({ message: t("ui.source.failed"), variant: "error" }),
    );
  };
  const tick = (on: boolean) => (on ? <Icon name="check" size={16} /> : undefined);

  return (
    <Sheet open onClose={onClose} title={t("ui.source.title")} actions={[{ label: t("common.cancel"), onClick: onClose }]}>
      <p className={styles.lead}>{t("ui.source.lead", { title: track.title })}</p>
      <MediaRow
        data-source-row=""
        leading={<Cover src={track.coverUrl ?? ""} size={40} radius={6} />}
        title={t("ui.source.original")}
        subtitle={[track.artists, formatDuration(track.durationMs)].filter(Boolean).join(" · ")}
        extra={tick(chosen === null)}
        onActivate={() => pick(null)}
      />
      {versions.map((version) => (
        <MediaRow
          key={version.id}
          data-source-row=""
          leading={<Cover src={version.coverUrl ?? ""} size={40} radius={6} fetchPriority="low" />}
          title={version.title}
          subtitle={[version.artists, formatDuration(version.durationMs)].filter(Boolean).join(" · ")}
          extra={tick(chosen === version.id)}
          onActivate={() => pick(version)}
        />
      ))}
      {!loading && versions.length === 0 ? <p className={styles.lead}>{t("ui.source.none")}</p> : null}
    </Sheet>
  );
}

export function SourceSheetHost(): JSX.Element | null {
  const track = useSourceSheet((state) => state.track);
  const close = useSourceSheet((state) => state.close);
  return track ? <SourcePicker key={track.id} track={track} onClose={close} /> : null;
}
