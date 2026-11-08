import type { JSX } from "react";
import { Icon } from "../icons/Icon";
import look from "./look.module.css";

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  clearLabel: string;
  className?: string;
}

/** The 220 px tinted search field: a glass, the input, and a clear button while it holds text. Escape clears. */
export function SearchField({ value, onChange, placeholder, clearLabel, className }: SearchFieldProps): JSX.Element {
  return (
    <div role="search" className={className ? `${look.field} ${className}` : look.field}>
      <Icon name="search" size={16} />
      <input
        type="text"
        className={look.fieldInput}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
      />
      {value ? (
        <button type="button" className={look.fieldClear} aria-label={clearLabel} onClick={() => onChange("")}>
          <Icon name="clear-circle" size={16} />
        </button>
      ) : null}
    </div>
  );
}
