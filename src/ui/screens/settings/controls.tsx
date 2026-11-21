import { createContext, useContext, useId, type JSX, type ReactNode } from "react";
import { Lens } from "../../components/Lens";
import { Toggle } from "../../components/Toggle";
import type { TFunction } from "../../ports/i18n";
import { findKeyFor, matchesQuery } from "./sections";
import styles from "./controls.module.css";

export const SearchQuery = createContext("");

export function rowText(t: TFunction, base: string) {
  const titleKey = base + ".title";
  const descKey = base + ".description";
  return { titleKey, descKey, title: t(titleKey), description: t(descKey) };
}

function useHidden(title: string, description: string | undefined, keys: (string | undefined)[]): boolean {
  const query = useContext(SearchQuery);
  return !matchesQuery(query, [...keys, findKeyFor(keys[0])], [title, description ?? ""]);
}

interface RowProps {
  title: string;
  description?: string;
  explained?: boolean;
  control?: ReactNode;
  icon?: ReactNode;
  titleKey?: string;
  descKey?: string;
}

export function SettingRow({ title, description, explained, control, icon, titleKey, descKey }: RowProps): JSX.Element | null {
  if (useHidden(title, description, [titleKey, descKey])) return null;
  return (
    <div className={styles.row} data-setting={titleKey}>
      {icon ? <span className={styles.rowIcon}>{icon}</span> : null}
      <div className={styles.text}>
        <span className={styles.title}>{title}</span>
        {explained && description ? <span className={styles.description}>{description}</span> : null}
      </div>
      {control ? <div className={styles.control}>{control}</div> : null}
    </div>
  );
}

export function SettingBlock({
  title,
  description,
  titleKey,
  descKey,
  headless,
  children,
}: Omit<RowProps, "control" | "explained" | "icon"> & { headless?: boolean; children: ReactNode }): JSX.Element | null {
  if (useHidden(title, description, [titleKey, descKey])) return null;
  return (
    <div className={styles.block} data-setting={titleKey}>
      {headless ? (
        description ? (
          <span className={styles.blockDescription}>{description}</span>
        ) : null
      ) : (
        <div className={styles.blockHead}>
          <span className={styles.title}>{title}</span>
          {description ? <span className={styles.blockDescription}>{description}</span> : null}
        </div>
      )}
      {children}
    </div>
  );
}

// CSS hides the group when search leaves its panel empty
export function SettingGroup({ label, children }: { label?: string; children: ReactNode }): JSX.Element {
  return (
    <section className={styles.group}>
      {label ? <h3 className={styles.groupLabel}>{label}</h3> : null}
      <div className={styles.panel}>{children}</div>
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
  reason?: string;
}

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
  const lensGroup = useId();
  return (
    <div role="group" aria-label={label} className={styles.segmented}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={option.disabled}
          title={option.disabled ? option.reason : undefined}
          className={styles.segment}
          onClick={() => onChange(option.value)}
        >
          {option.value === value ? <Lens group={lensGroup} value={value} radius={8} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}
