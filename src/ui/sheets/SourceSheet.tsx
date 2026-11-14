import { useEffect, useId, useRef, useState, type JSX } from "react";
import { create } from "zustand";
import { Cover } from "../components/Cover";
import { Button } from "../components/Button";
import { useScrollActivity } from "../components/useScrollActivity";
import { useToastStore } from "../feedback/toastStore";
import { Icon } from "../icons/Icon";
import { useTranslation } from "../ports/i18n";
import { chooseSource, chosenSource, type Track } from "../ports/player";
import { useSearchTracks } from "../ports/search";
import { formatDuration } from "../screens/entity/entityModel";
import { MediaRow } from "../screens/MediaRow";
import { GlassSheet } from "./GlassSheet";
import glass from "./GlassSheet.module.css";
import styles from "./SourceSheet.module.css";

const VERSIONS = 8;

export const useSourceSheet = create<{ track: Track | null; open(track: Track): void; close(): void }>((set) => ({
  track: null,
  open: (track) => set({ track }),
  close: () => set({ track: null }),
}));

function SourcePicker({ track, onClose }: { track: Track; onClose(): void }): JSX.Element {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useScrollActivity(listRef);
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
    <GlassSheet open onClose={onClose} labelledBy={titleId} width={460}>
      <div className={styles.head}>
        <h2 id={titleId} className={glass.title}>
          {t("ui.source.title")}
        </h2>
        <p className={glass.caption}>{t("ui.source.lead", { title: track.title })}</p>
      </div>
      <div className={styles.body}>
        <MediaRow
          data-source-row=""
          className={styles.row}
          leading={<Cover src={track.coverUrl ?? ""} size={40} radius={8} />}
          title={t("ui.source.original")}
          subtitle={[track.artists, formatDuration(track.durationMs)].filter(Boolean).join(" · ")}
          extra={tick(chosen === null)}
          onActivate={() => pick(null)}
        />
        <p className={styles.label}>{t("ui.source.others")}</p>
        <div ref={listRef} className={`${styles.versions} n-scroll`} aria-busy={loading}>
          {versions.map((version) => (
            <MediaRow
              key={version.id}
              data-source-row=""
              className={styles.row}
              leading={<Cover src={version.coverUrl ?? ""} size={40} radius={8} fetchPriority="low" />}
              title={version.title}
              subtitle={[version.artists, formatDuration(version.durationMs)].filter(Boolean).join(" · ")}
              extra={tick(chosen === version.id)}
              onActivate={() => pick(version)}
            />
          ))}
          {loading && versions.length === 0 ? [0, 1, 2].map((slot) => <span key={slot} className={styles.ghost} aria-hidden="true" />) : null}
          {!loading && versions.length === 0 ? <p className={styles.none}>{t("ui.source.none")}</p> : null}
        </div>
      </div>
      <div className={glass.footer}>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
      </div>
    </GlassSheet>
  );
}

export function SourceSheetHost(): JSX.Element | null {
  const track = useSourceSheet((state) => state.track);
  const close = useSourceSheet((state) => state.close);
  return track ? <SourcePicker key={track.id} track={track} onClose={close} /> : null;
}
