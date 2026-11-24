import { useMemo, type JSX } from "react";
import { ICON_FILL, ICON_NAMES, ICON_STROKE, ICON_SVG, type IconName, type IconSize } from "./index";
import styles from "./Icon.module.css";

const drawing = (svg: string) => svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

// One object per name: React compares the object, so a fresh one per render rewrites the SVG
const ICON_BODY = Object.fromEntries(ICON_NAMES.map((name) => [name, { __html: drawing(ICON_SVG[name]) }])) as Record<IconName, { __html: string }>;

const STATES: IconName[][] = [
  ["like", "liked"],
  ["repeat", "repeat-one"],
  ["volume-mute", "volume-low", "volume-high"],
  ["playlist-add", "playlist-added"],
  ["download", "downloaded"],
];

interface Layer {
  body: { __html: string };
  states: Set<string>;
}

interface Stack {
  id: string;
  layers: Layer[];
}

function stack(states: [key: string, svg: string][]): Stack {
  const layers = new Map<string, Layer>();
  for (const [key, svg] of states) {
    for (const shape of drawing(svg).match(/<path[^>]*\/>/g) ?? []) {
      const layer = layers.get(shape) ?? { body: { __html: shape }, states: new Set() };
      layer.states.add(key);
      layers.set(shape, layer);
    }
  }
  return { id: states[0][0], layers: [...layers.values()] };
}

const STACKS = new Map<IconName, Stack>();
for (const names of STATES) {
  const shared = stack(names.map((name) => [name, ICON_SVG[name]]));
  for (const name of names) STACKS.set(name, shared);
}
for (const [name, fill] of Object.entries(ICON_FILL) as [IconName, string][]) {
  STACKS.set(
    name,
    stack([
      [name, ICON_SVG[name]],
      [`${name}-fill`, fill],
    ]),
  );
}

export interface IconProps {
  name: IconName;
  size?: IconSize;
  filled?: boolean;
  className?: string;
}

export function Icon({ name, size = 20, filled = false, className }: IconProps): JSX.Element {
  const art = useMemo(() => {
    const layered = STACKS.get(name);
    if (!layered) return <g key={name} className={styles.art} data-icon={name} dangerouslySetInnerHTML={ICON_BODY[name]} />;
    const state = filled && ICON_FILL[name] ? `${name}-fill` : name;
    return (
      <g key={layered.id} className={styles.stack} data-icon={layered.id} data-state={state}>
        {layered.layers.map((layer, i) => (
          <g key={i} className={styles.layer} data-off={layer.states.has(state) ? undefined : ""} dangerouslySetInnerHTML={layer.body} />
        ))}
      </g>
    );
  }, [name, filled]);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE[size]}
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      data-filled={filled ? "" : undefined}
    >
      {art}
    </svg>
  );
}
