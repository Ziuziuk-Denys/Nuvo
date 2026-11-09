import { useRef, type CSSProperties, type JSX, type KeyboardEvent, type MouseEvent, type SyntheticEvent } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { Cover } from "../../components/Cover";
import { Explicit } from "../../components/Explicit";
import { useScrollMargin } from "../../components/useScrollMargin";
import { Icon } from "../../icons/Icon";
import { DislikeButton } from "../../recs/DislikeButton";
import { useTranslation, type TFunction } from "../../ports/i18n";
import { useListReorder } from "../../ports/library";
import type { Track } from "../../ports/player";
import { useShellScroller } from "../../shell/scroller";
import { MediaRow } from "../MediaRow";
import { formatDuration, type TrackMatch } from "./entityModel";
import type { TrackSelection } from "./trackSelection";
import styles from "./TrackList.module.css";

const ROW_PX = 64;
const SHORT_ROW_PX = 44;
const VIRTUAL_FROM = 100;

export interface TrackListProps {
  tracks: TrackMatch<Track>[];
  numbered?: boolean;
  hideArtists?: boolean;
  currentId: string | null;
  playing?: boolean;
  onPlay: (index: number) => void;
  onTogglePlay?: () => void;
  onReorder?: (from: number, to: number) => void;
  unavailable?: (track: Track) => string | null;
  onMenu: (track: Track, anchor: HTMLElement | null, at?: { x: number; y: number }) => void;
  selectedKey?: string | null;
  selection?: TrackSelection;
}

export function trackKey(match: TrackMatch<Track>): string {
  return match.track.playlistItemId ?? `${match.track.id}:${match.index}`;
}

function stop(event: SyntheticEvent) {
  event.stopPropagation();
}

function IndexCell({ number, current, playing, onToggle, t }: { number: number; current: boolean; playing: boolean; onToggle?: () => void; t: TFunction }) {
  return (
    <span className={styles.index} data-current={current ? "" : undefined}>
      <span className={styles.number}>{number}</span>
      {current && onToggle ? (
        <button
          type="button"
          className={styles.glyph}
          aria-label={t(playing ? "ui.island.pause" : "ui.island.play")}
          onClick={(event) => {
            stop(event);
            onToggle();
          }}
          onKeyDown={stop}
        >
          <Icon name={playing ? "pause" : "play"} size={16} />
        </button>
      ) : null}
    </span>
  );
}

export function TrackList({
  tracks,
  numbered = false,
  hideArtists = false,
  currentId,
  playing = false,
  onPlay,
  onTogglePlay,
  onReorder,
  unavailable,
  onMenu,
  selectedKey,
  selection,
}: TrackListProps): JSX.Element {
  const rowPx = numbered && hideArtists ? SHORT_ROW_PX : ROW_PX;
  const { t } = useTranslation();
  const scroller = useShellScroller();
  const listRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useScrollMargin(listRef);
  const drag = useListReorder({
    items: tracks,
    scrollContainerRef: scroller,
    listContainerRef: listRef,
    itemHeight: rowPx,
    onReorder: (from: number, to: number) => onReorder?.(from, to),
  });
  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowPx,
    overscan: tracks.length <= VIRTUAL_FROM ? tracks.length : 10,
    scrollMargin,
    getItemKey: (index) => trackKey(tracks[index]),
    // the lifted row stays mounted when auto-scroll carries it out of the window
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      const lifted = drag.isDragging ? drag.dragIndex : null;
      return lifted === null || indexes.includes(lifted) ? indexes : [...indexes, lifted].sort((a, b) => a - b);
    },
    // tests and the first frame have no measured scroller yet
    initialRect: { width: 1120, height: 800 },
  });
  const listTop = drag.isDragging ? (listRef.current?.getBoundingClientRect().top ?? 0) : 0;

  const offsetOf = (position: number): number => {
    const { dragIndex, dropIndex } = drag;
    if (!drag.isDragging || dragIndex === null || dropIndex === null) return 0;
    if (dragIndex < dropIndex && position > dragIndex && position <= dropIndex) return -rowPx;
    if (dragIndex > dropIndex && position >= dropIndex && position < dragIndex) return rowPx;
    return 0;
  };

  const onRowClick = (event: MouseEvent<HTMLDivElement>, position: number) => {
    if (!selection) return;
    const ctrl = event.ctrlKey || event.metaKey;
    if (event.shiftKey || ctrl) {
      event.preventDefault();
      selection.onPick(position, { shift: event.shiftKey, ctrl });
      return;
    }
    if (selection.keys.size > 0) selection.clear();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, position: number) => {
    const row = event.currentTarget;
    const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
    if (selection && event.target === row) {
      const ctrl = event.ctrlKey || event.metaKey;
      if (event.shiftKey && vertical && !event.altKey) {
        event.preventDefault();
        const target = selection.onStep(position, event.key === "ArrowUp" ? -1 : 1);
        const slot = row.closest("[data-reorder-item]");
        const next = target === position ? null : event.key === "ArrowUp" ? slot?.previousElementSibling : slot?.nextElementSibling;
        next?.querySelector<HTMLElement>("[data-track-row]")?.focus();
        return;
      }
      if (ctrl && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selection.onAll();
        return;
      }
      if (ctrl && event.key === " ") {
        event.preventDefault();
        selection.onPick(position, { ctrl: true });
        return;
      }
      if (event.key === "Escape" && selection.keys.size > 0) {
        event.preventDefault();
        selection.clear();
        return;
      }
    }
    if (!onReorder || !event.altKey || !vertical) return;
    event.preventDefault();
    const to = position + (event.key === "ArrowUp" ? -1 : 1);
    if (to < 0 || to >= tracks.length) return;
    onReorder(position, to);
    requestAnimationFrame(() => row.scrollIntoView?.({ block: "nearest" }));
  };

  return (
    <div ref={listRef} className={styles.list} style={{ height: virtualizer.getTotalSize() }} data-dragging={drag.isDragging ? "" : undefined}>
      {virtualizer.getVirtualItems().map((item) => {
        const match = tracks[item.index];
        const { track, index } = match;
        const key = trackKey(match);
        const current = track.id === currentId;
        const lifted = drag.isDragging && drag.dragIndex === item.index;
        const top = lifted ? drag.pointerPos.y - listTop - drag.grabOffset.y : item.start - scrollMargin + offsetOf(item.index);
        const reason = unavailable?.(track) ?? undefined;
        return (
          <div
            key={key}
            className={styles.slot}
            data-reorder-item
            data-lifted={lifted ? "" : undefined}
            style={{ transform: `translateY(${top}px)` } as CSSProperties}
          >
            <MediaRow
              data-track-row=""
              data-selected={selectedKey === key || selection?.keys.has(key) ? "" : undefined}
              className={styles.row}
              number={numbered}
              leading={
                numbered ? (
                  <IndexCell number={index + 1} current={current} playing={playing} onToggle={onTogglePlay} t={t} />
                ) : (
                  <Cover src={track.coverUrl ?? ""} size={48} radius={8} fetchPriority="low" />
                )
              }
              title={track.title}
              badge={track.explicit ? <Explicit label={t("ui.entity.explicit")} /> : undefined}
              subtitle={hideArtists ? undefined : track.artists}
              meta={formatDuration(track.durationMs)}
              extra={<DislikeButton track={track} />}
              active={current}
              unavailableReason={reason ?? undefined}
              onActivate={() => onPlay(index)}
              onClick={selection ? (event) => onRowClick(event, item.index) : undefined}
              onKeyDown={(event) => onKeyDown(event, item.index)}
              onPointerDown={onReorder ? (event) => drag.handleCardGrab(item.index, match, event) : undefined}
              onContextMenu={(event) => {
                event.preventDefault();
                onMenu(track, event.currentTarget, { x: event.clientX, y: event.clientY });
              }}
              menuLabel={t("ui.entity.more")}
              onMenu={(anchor) => onMenu(track, anchor)}
            />
          </div>
        );
      })}
    </div>
  );
}
