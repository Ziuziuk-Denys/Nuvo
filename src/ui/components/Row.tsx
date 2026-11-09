import type { HTMLAttributes, JSX, KeyboardEvent, MouseEvent, ReactNode, SyntheticEvent } from "react";
import styles from "./Row.module.css";
import { Tooltip } from "./Tooltip";

export type RowVariant = "list" | "track" | "compact";

export interface RowProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  variant?: RowVariant;
  leading?: ReactNode;
  title: string;
  badge?: ReactNode;
  subtitle?: string;
  column?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  active?: boolean;
  unavailableReason?: string;
  titleSize?: "body" | "heading";
  onActivate?: () => void;
}

export function Row({
  variant = "list",
  leading,
  title,
  badge,
  subtitle,
  column,
  meta,
  actions,
  active,
  unavailableReason,
  titleSize = "body",
  onActivate,
  className,
  ...rest
}: RowProps): JSX.Element {
  const unavailable = unavailableReason !== undefined;
  const activate = onActivate && !unavailable ? onActivate : undefined;
  const focusable = onActivate !== undefined || unavailable;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    rest.onKeyDown?.(event);
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
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
      className={[styles.row, styles[variant], className].filter(Boolean).join(" ")}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      {leading === undefined || leading === null ? null : typeof leading === "object" ? (
        <span className={styles.leading}>{leading}</span>
      ) : (
        <span className={styles.index}>{leading}</span>
      )}
      <span className={styles.text}>
        {badge ? (
          <span className={styles.titleLine}>
            <span className={styles.title} data-size={titleSize === "heading" ? "heading" : undefined}>
              {title}
            </span>
            {badge}
          </span>
        ) : (
          <span className={styles.title} data-size={titleSize === "heading" ? "heading" : undefined}>
            {title}
          </span>
        )}
        {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
      </span>
      {column !== undefined ? <span className={styles.column}>{column}</span> : null}
      {actions ? (
        <span className={styles.actions} onClick={stop} onKeyDown={stop}>
          {actions}
        </span>
      ) : null}
      {meta ? <span className={styles.meta}>{meta}</span> : null}
    </div>
  );

  return unavailable ? <Tooltip text={unavailableReason}>{row}</Tooltip> : row;
}

function stop(event: SyntheticEvent) {
  event.stopPropagation();
}

export function RowPlaceholder({ variant = "list", leading = "cover" }: { variant?: RowVariant; leading?: "cover" | "index" | "none" }): JSX.Element {
  return (
    <div aria-hidden className={[styles.row, styles[variant], styles.placeholder].join(" ")}>
      {leading === "none" ? null : <span className={leading === "cover" ? styles.leading : styles.index} />}
      <span className={styles.text}>
        <span className={styles.bar} />
        {variant === "compact" ? null : <span className={`${styles.bar} ${styles.short}`} />}
      </span>
    </div>
  );
}
