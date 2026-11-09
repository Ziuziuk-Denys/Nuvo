import { useEffect, useRef, type CSSProperties, type JSX } from "react";
import { createPortal } from "react-dom";
import { playerEngine, usePlayerStore } from "../../ports/player";
import { useTranslation } from "../../ports/i18n";
import { Cover } from "../../components/Cover";
import { Explicit } from "../../components/Explicit";
import { IconButton } from "../../components/IconButton";
import { Icon } from "../../icons/Icon";
import { Row } from "../../components/Row";
import { useListReorder } from "../../components/useListReorder";
import { DislikeButton } from "../../recs/DislikeButton";
import { formatDuration } from "../../screens/entity/entityModel";
import { useShellStore } from "../shellStore";
import { QUEUE_PANEL } from "../../geometry";
import styles from "./QueuePanel.module.css";

const ROW_HEIGHT = 56;

export function radioSeed(queue: readonly { title: string }[], context: string | null, autoplayFrom: number | null): string | null {
  if (context?.startsWith("radio:")) return queue[0]?.title ?? null;
  return queue[(autoplayFrom ?? queue.length) - 1]?.title ?? null;
}

export function QueuePanel(): JSX.Element | null {
  const { t } = useTranslation();
  const open = useShellStore((state) => state.queueOpen);
  const setOpen = useShellStore((state) => state.setQueueOpen);
  const queue = usePlayerStore((state) => state.queue);
  const currentIndex = usePlayerStore((state) => state.currentIndex);
  const seed = usePlayerStore((state) => (state.repeat === "off" ? radioSeed(state.queue, state.playbackContext, state.autoplayFrom) : null));
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reorder = useListReorder({
    items: queue,
    scrollContainerRef: scrollRef,
    listContainerRef: listRef,
    itemHeight: ROW_HEIGHT,
    onReorder: (from, to) => playerEngine.reorderQueue(from, to),
  });

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, setOpen]);

  if (!open) return null;
  const panel = (
    <aside
      className={styles.panel}
      style={{ "--queue-width": `${QUEUE_PANEL.width}px`, "--queue-radius": `${QUEUE_PANEL.radius}px` } as CSSProperties}
      aria-label={t("ui.queue.title")}
      data-no-window-drag
    >
      <header className={styles.head}>
        <h2 className={styles.title}>{t("ui.queue.title")}</h2>
        <IconButton icon="trash" size="s" label={t("ui.queue.clear")} disabled={queue.length <= 1} onClick={() => playerEngine.clearQueue()} />
        <IconButton icon="close" size="s" label={t("ui.queue.close")} onClick={() => setOpen(false)} />
      </header>
      <div ref={scrollRef} className={`${styles.scroll} n-scroll`}>
        {queue.length === 0 ? <p className={styles.empty}>{t("ui.queue.empty")}</p> : null}
        <div ref={listRef} className={styles.list}>
          {queue.map((track, index) => (
            <div
              key={`${track.id}:${index}`}
              className={styles.item}
              data-dragging={reorder.dragIndex === index ? "" : undefined}
              data-drop={reorder.isDragging && reorder.dropIndex === index ? "" : undefined}
              onPointerDown={(event) => reorder.handleCardGrab(index, track, event)}
            >
              <Row
                variant="list"
                leading={<Cover src={track.coverUrl} size={40} />}
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
          ))}
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
