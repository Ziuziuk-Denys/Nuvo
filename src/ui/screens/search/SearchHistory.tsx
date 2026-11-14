import type { JSX } from "react";
import { useShallow } from "zustand/react/shallow";
import { Cover } from "../../components/Cover";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { useSearchHistoryStore, type SearchHistoryItem } from "../../ports/search";
import { MediaRow } from "../MediaRow";
import styles from "./Search.module.css";

export interface SearchHistoryProps {
  onActivate: (item: SearchHistoryItem) => void;
}

function historyArt(entry: SearchHistoryItem): JSX.Element {
  if (entry.type !== "query") {
    const round = entry.type === "artist";
    return <Cover src={entry.coverUrl ?? ""} size={48} radius={8} shape={round ? "circle" : "square"} fetchPriority="low" />;
  }
  return (
    <span className={styles.queryMark}>
      <Icon name="history" size={20} />
    </span>
  );
}

function HistoryRow({
  entry,
  removeLabel,
  onOpen,
  onForget,
}: {
  entry: SearchHistoryItem;
  removeLabel: string;
  onOpen(): void;
  onForget(): void;
}): JSX.Element {
  const forget = (
    <button type="button" className={styles.remove} aria-label={removeLabel} data-row-action="" onClick={onForget}>
      <Icon name="close" size={14} />
    </button>
  );
  return (
    <MediaRow
      data-history=""
      leading={historyArt(entry)}
      title={entry.title}
      subtitle={entry.type !== "query" ? entry.subtitle : undefined}
      extra={forget}
      onActivate={onOpen}
    />
  );
}

export function SearchHistory({ onActivate }: SearchHistoryProps): JSX.Element {
  const { t } = useTranslation();
  const { entries, forget, forgetAll } = useSearchHistoryStore(
    useShallow((history) => ({ entries: history.items, forget: history.removeItem, forgetAll: history.clearHistory })),
  );

  if (!entries.length) return <p className={styles.line}>{t("ui.search.hint")}</p>;

  const recent = t("ui.search.recent");
  const removeLabel = t("ui.search.remove");
  return (
    <section className={styles.group} aria-label={recent}>
      <div className={styles.headingLine}>
        <h2 className={styles.heading}>{recent}</h2>
        <button type="button" className={styles.more} onClick={forgetAll}>
          {t("ui.search.clear_history")}
        </button>
      </div>
      <div className={styles.columns}>
        {entries.map((entry) => (
          <HistoryRow key={entry.id} entry={entry} removeLabel={removeLabel} onOpen={() => onActivate(entry)} onForget={() => forget(entry.id)} />
        ))}
      </div>
    </section>
  );
}
