import { createContext, useContext, type JSX, type ReactNode } from "react";
import { Chip } from "../../components/Chip";
import { Toggle } from "../../components/Toggle";
import { matchesQuery } from "./sections";
import styles from "./controls.module.css";

/** The settings search; rows and blocks that do not match it render nothing. */
export const SearchQuery = createContext("");

function useHidden(title: string, description: string | undefined, keys: (string | undefined)[]): boolean {
  const query = useContext(SearchQuery);
  return !matchesQuery(query, keys, [title, description ?? ""]);
}

interface RowProps {
  title: string;
  description?: string;
  /** Show the description under the title; without it the description only feeds search. */
  explained?: boolean;
  control?: ReactNode;
  icon?: ReactNode;
  titleKey?: string;
  descKey?: string;
}

/** One line: title on the left, the control pinned right. */
export function SettingRow({ title, description, explained, control, icon, titleKey, descKey }: RowProps): JSX.Element | null {
  if (useHidden(title, description, [titleKey, descKey])) return null;
  return (
    <div className={styles.row}>
      {icon ? <span className={styles.rowIcon}>{icon}</span> : null}
      <div className={styles.text}>
        <span className={styles.title}>{title}</span>
        {explained && description ? <span className={styles.description}>{description}</span> : null}
      </div>
      {control ? <div className={styles.control}>{control}</div> : null}
    </div>
  );
}

/** Title on top and a wide control below it, such as a grid of cards. */
export function SettingBlock({
  title,
  description,
  titleKey,
  descKey,
  children,
}: Omit<RowProps, "control" | "explained" | "icon"> & { children: ReactNode }): JSX.Element | null {
  if (useHidden(title, description, [titleKey, descKey])) return null;
  return (
    <div className={styles.block}>
      <div className={styles.blockHead}>
        <span className={styles.title}>{title}</span>
        {description ? <span className={styles.blockDescription}>{description}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** A run of rows, optionally under a quiet label. */
export function SettingGroup({ label, children }: { label?: string; children: ReactNode }): JSX.Element {
  return (
    <section className={styles.group}>
      {label ? <h3 className={styles.groupLabel}>{label}</h3> : null}
      <div className={styles.stack}>{children}</div>
    </section>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}): JSX.Element {
  return <Toggle checked={checked} onChange={onChange} label={label} labelHidden disabled={disabled} />;
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Why a disabled option cannot be picked; shown on hover. */
  reason?: string;
}

/** Pill buttons in a row, one pressed. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}): JSX.Element {
  return (
    <div role="group" aria-label={label} className={styles.segmented}>
      {options.map((option) => (
        <Chip
          key={option.value}
          active={option.value === value}
          disabled={option.disabled}
          title={option.disabled ? option.reason : undefined}
          className={styles.segment}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Chip>
      ))}
    </div>
  );
}
