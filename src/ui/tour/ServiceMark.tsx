import { useId, type JSX, type ReactNode } from "react";
import type { ImportSource } from "../ports/importSources";

function Cut({ shape, figure }: { shape: ReactNode; figure: ReactNode }): JSX.Element {
  const id = useId();
  return (
    <>
      <mask id={id}>
        <g fill="#fff">{shape}</g>
        <g fill="#000" stroke="#000">
          {figure}
        </g>
      </mask>
      <rect width="24" height="24" fill="currentColor" mask={`url(#${id})`} />
    </>
  );
}

const MARKS: Record<ImportSource, () => JSX.Element> = {
  spotify: () => (
    <Cut
      shape={<circle cx="12" cy="12" r="11" />}
      figure={
        <g fill="none" strokeLinecap="round">
          <path d="M6 9.3c3.9-1.2 8.3-.8 11.8 1.2" strokeWidth="2" />
          <path d="M6.7 12.6c3.2-.9 6.8-.6 9.7 1" strokeWidth="1.7" />
          <path d="M7.4 15.7c2.6-.7 5.3-.5 7.6.8" strokeWidth="1.45" />
        </g>
      }
    />
  ),
  apple: () => (
    <Cut
      shape={<rect x="1" y="1" width="22" height="22" rx="6" />}
      figure={
        <g strokeWidth="0">
          <path d="M9 8.2 16.6 6.3v2.1L10.6 9.9V16h-1.6z" />
          <rect x="15" y="6.4" width="1.6" height="8.6" />
          <ellipse cx="8" cy="16.4" rx="2.4" ry="1.9" />
          <ellipse cx="14" cy="15" rx="2.4" ry="1.9" />
        </g>
      }
    />
  ),
  deezer: () => (
    <g fill="currentColor">
      {[0, 1, 2, 3, 4].flatMap((column) =>
        Array.from({ length: column + 1 }, (_, row) => (
          <rect key={`${column}-${row}`} x={1 + column * 4.6} y={19.2 - row * 3.6} width="3.8" height="2.6" rx="0.6" />
        )),
      )}
    </g>
  ),
  youtube: () => (
    <Cut
      shape={<circle cx="12" cy="12" r="11" />}
      figure={
        <>
          <circle cx="12" cy="12" r="6.3" fill="none" strokeWidth="1.4" />
          <path d="M10.2 9.2v5.6l4.6-2.8z" strokeWidth="0" />
        </>
      }
    />
  ),
  soundcloud: () => (
    <g fill="currentColor">
      <path d="M11.2 18.4V8.6c.9-.7 2-1.1 3.2-1.1 2.7 0 4.9 2 5.2 4.6l.5-.1c1.7 0 3 1.3 3 3s-1.3 3.1-3 3.1z" />
      <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <path d="M1.6 14.6v2.6" />
        <path d="M4 12.6v5.2" />
        <path d="M6.4 11v6.8" />
        <path d="M8.8 9.8v8" />
      </g>
    </g>
  ),
};

export function ServiceMark({ source, size = 22 }: { source: ImportSource; size?: number }): JSX.Element {
  const Mark = MARKS[source];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <Mark />
    </svg>
  );
}
