import { useState, type JSX } from "react";
import { Button } from "../components/Button";
import { Cover } from "../components/Cover";
import { Icon } from "../icons/Icon";
import { useTranslation } from "../ports/i18n";
import { toSearchResult, useSearchArtists, type SearchResult } from "../ports/search";
import { STARTER_ARTISTS, startFromArtists } from "../ports/starters";
import { MediaRow } from "../screens/MediaRow";
import { SearchField } from "../screens/SearchField";
import styles from "./StartWithArtists.module.css";

const SEARCH = { limit: 6, debounceMs: 250 };

export function StartWithArtists({ onStarted }: { onStarted(): void }): JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const typing = query.trim().length >= 2;
  const search = useSearchArtists(query, { ...SEARCH, enabled: typing });
  const isPicked = (artist: SearchResult) => picked.some((p) => p.id === artist.id);
  const found = search.artists.map(toSearchResult).filter((artist) => !isPicked(artist));
  const full = picked.length >= STARTER_ARTISTS;

  const toggle = (artist: SearchResult) =>
    setPicked((list) => {
      if (list.some((p) => p.id === artist.id)) return list.filter((p) => p.id !== artist.id);
      return list.length < STARTER_ARTISTS ? [...list, artist] : list;
    });

  const start = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await startFromArtists(picked.map((artist) => artist.id));
    setBusy(false);
    if (ok) onStarted();
    else setFailed(true);
  };

  let note: string | null = null;
  if (typing && found.length === 0 && search.hasLoaded && !search.loading) note = t("ui.tour.start.taste_none", { query: query.trim() });
  else if (typing && found.length === 0) note = t("ui.tour.start.taste_searching");

  return (
    <section className={styles.start} aria-labelledby="start-artists-title">
      <h2 id="start-artists-title" className={styles.title}>
        {t("ui.recs.start.title")}
      </h2>
      <p className={styles.message}>{t("ui.recs.start.message")}</p>
      <SearchField className={styles.field} value={query} onChange={setQuery} placeholder={t("ui.recs.start.search")} clearLabel={t("ui.clear")} />
      <div className={styles.rows}>
        {[...picked, ...found].map((artist) => {
          const on = isPicked(artist);
          return (
            <MediaRow
              key={artist.id}
              leading={<Cover src={artist.cover} size={48} shape="circle" />}
              title={artist.title}
              active={on}
              data-selected={on ? "" : undefined}
              className={!on && full ? styles.spare : undefined}
              extra={<Icon name={on ? "check" : "add"} size={20} className={styles.mark} />}
              onActivate={() => toggle(artist)}
            />
          );
        })}
        {note ? <p className={styles.note}>{note}</p> : null}
      </div>
      <div className={styles.foot}>
        <span className={styles.note} role="status">
          {failed ? t("ui.recs.start.failed") : t("ui.tour.start.taste_count", { n: picked.length, total: STARTER_ARTISTS })}
        </span>
        <Button variant="primary" disabled={picked.length === 0 || busy} onClick={() => void start()}>
          {t("ui.recs.start.go")}
        </Button>
      </div>
    </section>
  );
}
