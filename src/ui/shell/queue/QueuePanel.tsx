import { useEffect, useRef, useState, type CSSProperties, type JSX } from "react";
import { createPortal } from "react-dom";
import { playerEngine, usePlayerStore } from "../../ports/player";
import { useTranslation } from "../../ports/i18n";
import { Cover } from "../../components/Cover";
import { Explicit } from "../../components/Explicit";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { Icon } from "../../icons/Icon";
import { Row } from "../../components/Row";
import { LAYER_ATTRIBUTE, usePresence } from "../../components/layers";
import { useListReorder } from "../../components/useListReorder";
import { DislikeButton } from "../../recs/DislikeButton";
import { formatDuration } from "../../screens/entity/entityModel";
import { useShellStore } from "../shellStore";
import { QUEUE_PANEL } from "../../geometry";
import styles from "./QueuePanel.module.css";

const ROW_HEIGHT = 52;

export function radioSeed(queue: readonly { title: string }[], context: string | null, autoplayFrom: number | null): string | null {
  if (context?.startsWith("radio:")) return queue[0]?.title ?? null;
  return queue[(autoplayFrom ?? queue.length) - 1]?.title ?? null;
}

export function dragShift(index: number, from: number | null, to: number | null, lifted: number, height: number): number {
  if (from === null || to === null) return 0;
  if (index === from) return lifted;
  if (from < index && index <= to) return -height;
  if (to <= index && index < from) return height;
  return 0;
}

export const QUEUE_ID = "queue-panel";

export function QueuePanel(): JSX.Element | null {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLElement>(null);
  const open = useShellStore((state) => state.queueOpen);
  const setOpen = useShellStore((state) => state.setQueueOpen);
  const queue = usePlayerStore((state) => state.queue);
  const currentIndex = usePlayerStore((state) => state.currentIndex);
  const seed = usePlayerStore((state) => (state.repeat === "off" ? radioSeed(state.queue, state.playbackContext, state.autoplayFrom) : null));
  const phase = usePresence(open);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fresh, setFresh] = useState(true);
  const [grab, setGrab] = useState({ listTop: 0, scrollTop: 0, now: 0, start: 0 });
  if (!open && !fresh) setFresh(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const played = Math.max(currentIndex, 0);
  const start = historyOpen ? 0 : played;
  const shown = queue.slice(start);
  const reorder = useListReorder({
    items: shown,
    scrollContainerRef: scrollRef,
    listContainerRef: listRef,
    itemHeight: ROW_HEIGHT,
    onReorder: (from, to) => playerEngine.reorderQueue(from + grab.start, to + grab.start),
  });

  useEffect(() => {
    if (!open) return;
    const settle = window.setTimeout(() => setFresh(false), 600);
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || panelRef.current?.contains(target)) return;
      if (target.closest(`[${LAYER_ATTRIBUTE}], [aria-controls="${QUEUE_ID}"]`)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", close);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [open, setOpen]);

  if (phase === null) return null;
  const listTop = grab.listTop + grab.scrollTop - grab.now;
  const lifted = reorder.dragIndex === null ? 0 : reorder.pointerPos.y - reorder.grabOffset.y - listTop - reorder.dragIndex * ROW_HEIGHT;

  const panel = (
    <aside
      ref={panelRef}
      id={QUEUE_ID}
      className={styles.panel}
      style={{ "--queue-width": `${QUEUE_PANEL.width}px`, "--queue-radius": `${QUEUE_PANEL.radius}px`, "--row": `${ROW_HEIGHT}px` } as CSSProperties}
      aria-label={t("ui.queue.title")}
      data-state={phase}
      data-fresh={fresh ? "" : undefined}
      data-no-window-drag
    >
      <header className={styles.head}>
        <h2 className={styles.title}>{t("ui.queue.title")}</h2>
        <Button variant="text" size="s" aria-label={t("ui.queue.clear")} disabled={queue.length <= 1} onClick={() => playerEngine.clearQueue()}>
          {t("ui.queue.clear_short")}
        </Button>
        <IconButton icon="close" size="s" label={t("ui.queue.close")} onClick={() => setOpen(false)} />
      </header>
      <div
        ref={scrollRef}
        className={`${styles.scroll} n-scroll`}
        onScroll={(event) => {
          if (reorder.isDragging) setGrab({ ...grab, now: event.currentTarget.scrollTop });
        }}
      >
        {queue.length === 0 ? <p className={styles.empty}>{t("ui.queue.empty")}</p> : null}
        {played > 0 ? (
          <button type="button" className={styles.history} aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}>
            <Icon name="history" size={14} />
            <span>{t("ui.queue.history")}</span>
            <span className={styles.count}>{played}</span>
            <Icon name="chevron-down" size={14} className={styles.chevron} />
          </button>
        ) : null}
        <div ref={listRef} className={styles.list}>
          {shown.map((track, step) => {
            const index = step + start;
            const shift = dragShift(step, reorder.dragIndex, reorder.dropIndex, lifted, ROW_HEIGHT);
            return (
              <div
                key={`${track.id}:${index}`}
                className={styles.item}
                style={{ "--i": Math.min(step, 5), transform: shift ? `translateY(${shift}px)` : undefined } as CSSProperties}
                data-played={index < currentIndex ? "" : undefined}
                data-current={index === currentIndex ? "" : undefined}
                data-dragging={reorder.dragIndex === step ? "" : undefined}
                data-moving={reorder.isDragging ? "" : undefined}
                onPointerDown={(event) => {
                  const scrollTop = scrollRef.current?.scrollTop ?? 0;
                  setGrab({ listTop: listRef.current?.getBoundingClientRect().top ?? 0, scrollTop, now: scrollTop, start });
                  reorder.handleCardGrab(step, track, event);
                }}
              >
                <Row
                  variant="track"
                  leading={<Cover src={track.coverUrl} size={36} />}
                  title={track.title}
                  badge={track.explicit ? <Explicit label={t("ui.entity.explicit")} /> : undefined}
                  subtitle={track.artists}
                  meta={formatDuration(track.durationMs)}
                  active={index === currentIndex}
                  onActivate={() => playerEngine.playQueueIndex(index)}
                  actions={
                    <>
                      <DislikeButton track={track} size="s" />
                      <IconButton
                        icon="remove"
                        size="s"
                        label={t("ui.queue.remove")}
                        onClick={(event) => {
                          event.stopPropagation();
                          playerEngine.removeQueueIndex(index);
                        }}
                      />
                    </>
                  }
                />
              </div>
            );
          })}
        </div>
        {seed ? (
          <p className={styles.then}>
            <Icon name="radio" size={14} />
            <span>{t("ui.queue.then_radio", { seed })}</span>
          </p>
        ) : null}
      </div>
    </aside>
  );
  return createPortal(panel, document.body);
}
