import { useEffect, useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { useTranslation } from "../../ports/i18n";
import { useModalStore } from "../../ports/navigation";
import { useStreamingReachable } from "../../ports/network";
import { recsChanged } from "../../ports/recs";
import { coldStartNeeded } from "../../ports/starters";
import { StartWithArtists } from "../../recs/StartWithArtists";
import { useTour } from "../../tour/tourStore";
import styles from "./ColdStart.module.css";

/**
 * What Home shows while it has nothing to offer. A library with no taste yet asks for a few artists once the
 * tour is out of the way (its start card asks the same); offline, or after that, a plain empty state with search.
 */
export function ColdStart({ onImport }: { onImport?: () => void } = {}): JSX.Element | null {
  const { t } = useTranslation();
  const online = useStreamingReachable();
  const tourOff = useTour((state) => state.phase === "off");
  const [cold, setCold] = useState<boolean | null>(null);
  // after "Start listening" a station plays and Home refetches its mixes, so "nothing to suggest" would be wrong
  const [started, setStarted] = useState(false);

  useEffect(() => {
    let live = true;
    const check = () =>
      void coldStartNeeded().then((needed) => {
        if (live) setCold(needed);
      });
    check();
    // favourites sent from the tour's start card answer the ask before it shows
    recsChanged.addEventListener("change", check);
    return () => {
      live = false;
      recsChanged.removeEventListener("change", check);
    };
  }, []);

  if (cold === null || started) return null;
  if (cold && online && tourOff) {
    // an empty library can also bring its music in instead of naming artists
    return (
      <div className={styles.ask} data-cold-ask="">
        <StartWithArtists onStarted={() => setStarted(true)} />
        {onImport ? (
          <Button variant="text" className={styles.import} onClick={onImport}>
            {t("ui.library.import")}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <EmptyState
      title={t("ui.recs.home.empty_title")}
      message={t("ui.recs.home.empty_message")}
      tour="home-start"
      actions={[
        { label: t("ui.recs.home.search"), primary: true, onClick: () => useModalStore.getState().openSearch() },
        ...(onImport ? [{ label: t("ui.library.import"), onClick: onImport }] : []),
      ]}
    />
  );
}
