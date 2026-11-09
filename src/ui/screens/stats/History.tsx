import { useEffect, useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/Button";
import { Cover } from "../../components/Cover";
import { EmptyState } from "../../components/EmptyState";
import { Enter } from "../../components/Enter";
import { useTranslation, type TFunction } from "../../ports/i18n";
import { playerEngine, usePlayerStore } from "../../ports/player";
import { listeningHistory, type HistoryEntry, type HistoryFilter } from "../../ports/stats";
import { navigateWithTransition } from "../../shell/navigate";
import look from "../look.module.css";
import { MediaRow } from "../MediaRow";
import { addDays, formatInstant, isoDate } from "./statsModel";
import { useSongMenu } from "./StatsRows";
import styles from "./Stats.module.css";

const FILTERS: HistoryFilter[] = ["all", "completed", "skipped"];

function dayLabel(day: string, today: string, locale: string, t: TFunction): string {
  if (day === today) return t("ui.history.today");
  if (day === addDays(today, -1)) return t("ui.history.yesterday");
  return formatInstant(`${day}T12:00:00`, locale);
}

function byDay(items: HistoryEntry[]): Array<{ day: string; items: HistoryEntry[] }> {
  const groups: Array<{ day: string; items: HistoryEntry[] }> = [];
  for (const item of items) {
    const day = isoDate(new Date(item.listenedAt));
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

export function History(): JSX.Element {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [today] = useState(() => isoDate(new Date()));
  const currentId = usePlayerStore((player) => player.currentTrack?.id ?? null);
  const menu = useSongMenu();

  useEffect(() => {
    const controller = new AbortController();
    listeningHistory(filter, null, controller.signal).then(
      (page) => {
        setItems(page.items);
        setNext(page.next);
        setState("ready");
      },
      () => !controller.signal.aborted && setState("failed"),
    );
    return () => controller.abort();
  }, [filter]);

  const more = () => {
    if (!next) return;
    void listeningHistory(filter, next).then(
      (page) => {
        setItems((list) => [...list, ...page.items]);
        setNext(page.next);
      },
      () => undefined,
    );
  };

  let content: JSX.Element | null = null;
  if (state === "failed") {
    content = <EmptyState title={t("ui.stats.failed_title")} message={t("ui.stats.failed_message")} />;
  } else if (state === "ready" && items.length === 0) {
    content = (
      <EmptyState
        title={t(filter === "all" ? "ui.history.empty" : "ui.history.empty_filter")}
        actions={filter === "all" ? [{ label: t("ui.stats.empty_action"), primary: true, onClick: () => navigateWithTransition(navigate, "/library") }] : []}
      />
    );
  } else if (state === "ready") {
    content = (
      <>
        {byDay(items).map((group) => (
          <section key={group.day} className={styles.section} aria-label={dayLabel(group.day, today, locale, t)}>
            <h2 className={styles.sectionTitle}>{dayLabel(group.day, today, locale, t)}</h2>
            <div className={styles.rows}>
              {group.items.map((item) => (
                <MediaRow
                  key={item.id}
                  data-history-row=""
                  className={styles.mediaRow}
                  leading={<Cover src={item.track.coverUrl ?? ""} size={48} radius={8} fetchPriority="low" />}
                  title={item.track.title}
                  subtitle={item.skipped ? `${item.track.artists} · ${t("ui.history.skipped")}` : item.track.artists}
                  meta={new Date(item.listenedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                  active={item.track.id === currentId}
                  onActivate={() => void playerEngine.playTrack(item.track, [item.track], "history", "")}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    menu.open(item.track, event.currentTarget, { x: event.clientX, y: event.clientY });
                  }}
                  menuLabel={t("ui.entity.more")}
                  onMenu={(anchor) => menu.open(item.track, anchor)}
                />
              ))}
            </div>
          </section>
        ))}
        {next ? (
          <Button variant="text" onClick={more}>
            {t("ui.history.more")}
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <div className={styles.page} data-testid="history-page">
      <Enter index={0} screen="history">
        <h1 className={styles.title}>{t("ui.history.title")}</h1>
        <div className={styles.bar}>
          <div className={styles.ranges} role="tablist" aria-label={t("ui.history.filter")}>
            {FILTERS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={key === filter}
                className={`${look.pill} ${key === filter ? look.solid : look.glass}`}
                onClick={() => {
                  if (key === filter) return;
                  setState("loading");
                  setFilter(key);
                }}
              >
                {t(`ui.history.filter_${key}`)}
              </button>
            ))}
          </div>
        </div>
      </Enter>
      {content}
      {menu.layers}
    </div>
  );
}
