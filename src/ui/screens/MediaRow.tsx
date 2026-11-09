import type { HTMLAttributes, JSX, KeyboardEvent, MouseEvent, ReactNode, SyntheticEvent } from "react";
import { Tooltip } from "../components/Tooltip";
import { Icon } from "../icons/Icon";
import styles from "./MediaRow.module.css";

export interface MediaRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  leading?: ReactNode;
  number?: boolean;
  title: string;
  badge?: ReactNode;
  subtitle?: ReactNode;
  meta?: string;
  menuLabel?: string;
  onMenu?: (anchor: HTMLElement) => void;
  extra?: ReactNode;
  active?: boolean;
  unavailableReason?: string;
  // A click whose default an outer handler prevented (a Ctrl or Shift pick) does not activate
  onActivate?: () => void;
}

function stop(event: SyntheticEvent) {
  event.stopPropagation();
}

export function MediaRow({
  leading,
  number = false,
  title,
  badge,
  subtitle,
  meta,
  menuLabel,
  onMenu,
  extra,
  active,
  unavailableReason,
  onActivate,
  className,
  ...rest
}: MediaRowProps): JSX.Element {
  const unavailable = unavailableReason !== undefined;
  const activate = onActivate && !unavailable ? onActivate : undefined;
  const focusable = onActivate !== undefined || unavailable;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    rest.onKeyDown?.(event);
    if (event.defaultPrevented || event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    if (!event.repeat) activate?.();
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    rest.onClick?.(event);
    // the second click of a double click must not start the song again
    if (event.defaultPrevented || event.detail > 1) return;
    activate?.();
  };

  const row = (
    <div
      {...rest}
      role={focusable ? "button" : rest.role}
      tabIndex={focusable ? 0 : rest.tabIndex}
      aria-disabled={unavailable ? true : undefined}
      aria-current={active ? "true" : undefined}
      data-active={active ? "" : undefined}
      data-unavailable={unavailable ? "" : undefined}
      data-short={number && !subtitle ? "" : undefined}
      className={[styles.row, className].filter(Boolean).join(" ")}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      <span className={number ? styles.number : styles.lead}>{leading}</span>
      <span className={styles.text}>
        {badge ? (
          <span className={styles.titleLine}>
            <span className={styles.title} data-strong={number && !subtitle ? "" : undefined}>
              {title}
            </span>
            {badge}
          </span>
        ) : (
          <span className={styles.title} data-strong={number && !subtitle ? "" : undefined}>
            {title}
          </span>
        )}
        {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
      </span>
      <span className={styles.end} onClick={stop} onKeyDown={stop}>
        {extra}
        {meta ? <span className={styles.meta}>{meta}</span> : null}
        {onMenu && menuLabel ? (
          <button type="button" className={styles.dots} aria-label={menuLabel} onClick={(event) => onMenu(event.currentTarget)}>
            <Icon name="vertical-dots" size={24} />
          </button>
        ) : null}
      </span>
    </div>
  );

  return unavailable ? <Tooltip text={unavailableReason}>{row}</Tooltip> : row;
}

export function MediaRowPlaceholder(): JSX.Element {
  return (
    <div aria-hidden className={`${styles.row} ${styles.placeholder}`}>
      <span className={styles.lead} />
      <span className={styles.text}>
        <span className={styles.bar} />
        <span className={`${styles.bar} ${styles.short}`} />
      </span>
    </div>
  );
}
