import { useRef, useState, type CSSProperties, type FormEvent, type JSX, type KeyboardEvent } from "react";
import { Button } from "../components/Button";
import { Cover } from "../components/Cover";
import { Icon } from "../icons/Icon";
import { useTranslation } from "../ports/i18n";
import { useStreamingReachable } from "../ports/network";
import type { FavoritePick } from "../ports/recs";
import { toSearchResult, useSearchAll, type SearchResult } from "../ports/search";
import { STARTER_PICKS } from "../ports/starters";
import styles from "./TastePicker.module.css";

const SEARCH = { limit: 12, debounceMs: 250 };

type Seed = FavoritePick & { subtitle: string; cover: string };

const sameness = (item: { kind: string; title: string; subtitle: string }) => `${item.kind}\n${item.title}\n${item.subtitle}`.toLowerCase();

interface TastePickerProps {
  start(picks: FavoritePick[]): Promise<boolean>;
  action: string;
  rows: number;
  className?: string;
}

export function TastePicker({ start, action, rows, className }: TastePickerProps): JSX.Element {
  const { t } = useTranslation();
  const online = useStreamingReachable();
  const [query, setQuery] = useState("");
  const [picks, setPicks] = useState<Seed[]>([]);
  const [state, setState] = useState<"idle" | "busy" | "sent" | "failed">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const typing = query.trim().length >= 2;
  const search = useSearchAll(query, { ...SEARCH, enabled: online && typing });
  const sent = state === "sent";
  const full = picks.length >= STARTER_PICKS;

  // the catalog often lists one song under several ids, so a song is told apart by its title and artists
  const seen = new Set(picks.map(sameness));
  const found: SearchResult[] =
    typing && online
      ? search.items
          .map(toSearchResult)
          .filter((item) => (item.kind === "song" || item.kind === "artist") && !seen.has(sameness(item)) && seen.add(sameness(item)))
          .slice(0, rows)
      : [];

  const add = (item: SearchResult) => {
    if (full) return;
    setPicks((list) => [
      ...list,
      { kind: item.kind === "artist" ? "artist" : "song", id: item.id, title: item.title, subtitle: item.subtitle, cover: item.cover },
    ]);
    setQuery("");
    inputRef.current?.focus();
  };

  const remove = (id: string) => {
    setPicks((list) => list.filter((pick) => pick.id !== id));
    inputRef.current?.focus();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (found[0]) add(found[0]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
    } else if (event.key === "Backspace" && !query && picks.length > 0) {
      setPicks((list) => list.slice(0, -1));
    }
  };

  const send = async () => {
    setState("busy");
    const ok = await start(picks.map(({ kind, id, title }) => ({ kind, id, title })));
    setState(ok ? "sent" : "failed");
  };

  let note: string | null = null;
  if (typing && !online) note = t("ui.tour.start.taste_offline");
  else if (typing && found.length === 0 && search.hasLoaded && !search.loading) note = t("ui.tour.start.taste_none", { query: query.trim() });
  else if (typing && found.length === 0) note = t("ui.tour.start.taste_searching");

  return (
    <div className={className ? `${styles.picker} ${className}` : styles.picker}>
      <form className={styles.field} role="search" onSubmit={onSubmit}>
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={sent || state === "busy"}
          placeholder={t("ui.tour.start.taste_placeholder")}
          aria-label={t("ui.tour.start.taste_placeholder")}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {query ? (
          <button type="button" className={styles.clear} aria-label={t("ui.clear")} onClick={() => setQuery("")}>
            <Icon name="clear-circle" size={16} />
          </button>
        ) : null}
      </form>
      {picks.length > 0 ? (
        <ul className={styles.seeds} aria-label={t("ui.tour.start.taste_picked")}>
          {picks.map((pick) => (
            <li key={pick.id} className={styles.seed} data-seed={pick.kind}>
              <Cover src={pick.cover} size={20} shape={pick.kind === "artist" ? "circle" : "square"} radius={4} />
              <span>{pick.title}</span>
              {sent ? null : (
                <button type="button" aria-label={t("ui.tour.start.remove", { title: pick.title })} onClick={() => remove(pick.id)}>
                  <Icon name="close" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {found.length > 0 ? (
        <ul className={styles.found} aria-label={t("ui.tour.start.taste_suggestions")}>
          {found.map((item, index) => (
            <li key={item.id} style={{ "--i": index } as CSSProperties}>
              <button type="button" className={styles.row} disabled={full} onClick={() => add(item)}>
                <Cover src={item.cover} size={36} shape={item.kind === "artist" ? "circle" : "square"} radius={6} />
                <span className={styles.text}>
                  <b>{item.title}</b>
                  <span>{item.kind === "artist" ? t("ui.tour.start.artist") : t("ui.tour.start.song", { artists: item.subtitle })}</span>
                </span>
                <Icon name="add" size={16} className={styles.add} />
              </button>
            </li>
          ))}
        </ul>
      ) : note ? (
        <p className={styles.note}>{note}</p>
      ) : null}
      <div className={styles.foot}>
        <span className={styles.note} role="status">
          {sent ? (
            <>
              <Icon name="check" size={14} /> {t("ui.tour.start.taste_done")}
            </>
          ) : state === "failed" ? (
            t("ui.recs.start.failed")
          ) : state === "busy" ? (
            t("ui.tour.start.taste_busy")
          ) : (
            t("ui.tour.start.taste_count", { n: picks.length, total: STARTER_PICKS })
          )}
        </span>
        {sent ? null : (
          <Button variant="primary" size="s" disabled={picks.length === 0 || state === "busy"} onClick={() => void send()}>
            {action}
          </Button>
        )}
      </div>
    </div>
  );
}
