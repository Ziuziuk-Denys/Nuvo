import { useRef, useState, type FormEvent, type JSX } from "react";
import { Button } from "../components/Button";
import { Cover } from "../components/Cover";
import pop from "../components/Popover.module.css";
import { Icon } from "../icons/Icon";
import { useTranslation } from "../ports/i18n";
import { IMPORT_SOURCES, openImportSheet, type ImportSource } from "../ports/importSources";
import { useStreamingReachable } from "../ports/network";
import { seedFavorites, type FavoritePick } from "../ports/recs";
import { toSearchResult, useSearchAll, type SearchResult } from "../ports/search";
import { ServiceMark } from "./ServiceMark";
import { useTour } from "./tourStore";
import styles from "./tour.module.css";

export const ENOUGH_PICKS = 3;
const SUGGESTIONS = 3;

interface StartStepProps {
  onContinue: () => void;
  onSkipTour: () => void;
}

export function StartStep({ onContinue, onSkipTour }: StartStepProps): JSX.Element {
  const { t } = useTranslation();
  const started = useTour((state) => state.started);

  return (
    <div
      role="dialog"
      aria-labelledby="tour-start-title"
      aria-describedby="tour-start-text"
      className={`${styles.card} ${styles.start} ${pop.pop}`}
      data-state="in"
    >
      <div className={styles.startHead}>
        <span className={styles.mark} aria-hidden="true">
          <Icon name="nuvo-mark" size={26} />
        </span>
        <h2 id="tour-start-title" className={styles.posterTitle}>
          {t("ui.tour.poster.title")}
        </h2>
        <p id="tour-start-text" className={styles.posterText}>
          {t("ui.tour.start.text")}
        </p>
      </div>
      <div className={styles.startPanels}>
        <ImportPanel />
        <TastePanel />
      </div>
      <div className={styles.actions}>
        <Button variant="text" onClick={onSkipTour}>
          {t("ui.tour.poster.finish")}
        </Button>
        <Button variant={started ? "primary" : "secondary"} data-primary="" onClick={onContinue}>
          {t(started ? "ui.tour.start.continue" : "ui.tour.start.skip_now")}
        </Button>
      </div>
    </div>
  );
}

function ImportPanel(): JSX.Element {
  const { t } = useTranslation();

  const choose = async (source: ImportSource) => {
    const tour = useTour.getState();
    tour.setAway(true);
    try {
      await openImportSheet(source);
    } finally {
      tour.setAway(false);
    }
    tour.markStarted();
  };

  return (
    <section className={styles.panel} aria-labelledby="tour-import-title">
      <h3 id="tour-import-title" className={styles.panelTitle}>
        {t("ui.tour.start.import_title")}
      </h3>
      <p className={styles.panelText}>{t("ui.tour.start.import_text")}</p>
      <ul className={styles.sources}>
        {IMPORT_SOURCES.map((source) => (
          <li key={source}>
            <button type="button" className={styles.source} data-source={source} onClick={() => void choose(source)}>
              <ServiceMark source={source} />
              <span className={styles.sourceText}>
                <b>{t(`ui.tour.start.sources.${source}`)}</b>
                <span>{t(`ui.tour.start.sources.${source}_line`)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TastePanel(): JSX.Element {
  const { t } = useTranslation();
  const online = useStreamingReachable();
  const [query, setQuery] = useState("");
  const [picks, setPicks] = useState<FavoritePick[]>([]);
  const [sending, setSending] = useState<"idle" | "busy" | "sent" | "failed">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const search = useSearchAll(query, { enabled: online, limit: 10, debounceMs: 250 });
  const typing = query.trim().length >= 2;
  const sent = sending === "sent";

  const suggestions: SearchResult[] = typing
    ? search.items
        .map(toSearchResult)
        .filter((item) => (item.kind === "song" || item.kind === "artist") && !picks.some((pick) => pick.id === item.id))
        .slice(0, SUGGESTIONS)
    : [];

  const pick = (item: SearchResult) => {
    setPicks((list) => [...list, { kind: item.kind === "artist" ? "artist" : "song", id: item.id, title: item.title }]);
    setQuery("");
    inputRef.current?.focus();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (suggestions[0]) pick(suggestions[0]);
  };

  const send = async () => {
    setSending("busy");
    try {
      await seedFavorites(picks);
      setSending("sent");
      useTour.getState().markStarted();
    } catch {
      setSending("failed");
    }
  };

  let body: JSX.Element;
  if (typing && !online) {
    body = <p className={styles.panelNote}>{t("ui.tour.start.taste_offline")}</p>;
  } else if (typing && suggestions.length > 0) {
    body = (
      <ul className={styles.suggestions} aria-label={t("ui.tour.start.taste_suggestions")}>
        {suggestions.map((item) => (
          <li key={item.id}>
            <button type="button" className={styles.suggestion} onClick={() => pick(item)}>
              <Cover src={item.cover} size={32} radius={item.kind === "artist" ? undefined : 6} shape={item.kind === "artist" ? "circle" : "square"} />
              <span className={styles.sourceText}>
                <b>{item.title}</b>
                <span>{item.kind === "artist" ? t("ui.tour.start.artist") : item.subtitle}</span>
              </span>
              <Icon name="add" size={16} />
            </button>
          </li>
        ))}
      </ul>
    );
  } else if (typing && search.hasLoaded && !search.loading) {
    body = <p className={styles.panelNote}>{t("ui.tour.start.taste_none", { query: query.trim() })}</p>;
  } else if (typing) {
    body = <p className={styles.panelNote}>{t("ui.tour.start.taste_searching")}</p>;
  } else {
    body = (
      <>
        {picks.length > 0 ? (
          <ul className={styles.picks}>
            {picks.map((item) => (
              <li key={item.id} className={styles.pick}>
                <span>{item.title}</span>
                {sent ? null : (
                  <button
                    type="button"
                    aria-label={t("ui.tour.start.remove", { title: item.title })}
                    onClick={() => setPicks((list) => list.filter((other) => other.id !== item.id))}
                  >
                    <Icon name="close" size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <div className={styles.pickFoot}>
          <span className={styles.panelNote} role="status">
            {sent ? (
              <>
                <Icon name="check" size={14} /> {t("ui.tour.start.taste_done")}
              </>
            ) : sending === "failed" ? (
              t("ui.tour.start.taste_failed")
            ) : (
              t("ui.tour.start.taste_count", { n: Math.min(picks.length, ENOUGH_PICKS), total: ENOUGH_PICKS })
            )}
          </span>
          {sent ? null : (
            <Button variant="primary" size="s" disabled={picks.length < ENOUGH_PICKS || sending === "busy"} onClick={() => void send()}>
              {t("ui.tour.start.taste_use")}
            </Button>
          )}
        </div>
      </>
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="tour-taste-title">
      <h3 id="tour-taste-title" className={styles.panelTitle}>
        {t("ui.tour.start.taste_title")}
      </h3>
      <p className={styles.panelText}>{t("ui.tour.start.taste_text")}</p>
      <form className={styles.tasteField} role="search" onSubmit={onSubmit}>
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={sent}
          placeholder={t("ui.tour.start.taste_placeholder")}
          aria-label={t("ui.tour.start.taste_placeholder")}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>
      <div className={styles.tasteBody}>{body}</div>
    </section>
  );
}
