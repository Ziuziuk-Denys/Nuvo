import type { PresetMode } from "./presets";

export type DrawnPresetId = "ink" | "frost" | "moss" | "matcha" | "amber" | "dusk" | "blossom" | "velvet";

const MARK =
  "M32 62 A30 30 0 0 1 62 32 L87.92 32 A14 14 0 0 1 100.04 39 L130.14 91.14 A16 16 0 0 0 160 83.14 L160 50 A18 18 0 0 1 178 32 L194 32 A30 30 0 0 1 224 62 L224 194 A30 30 0 0 1 194 224 L168.08 224 A14 14 0 0 1 155.96 217 L125.86 164.86 A16 16 0 0 0 96 172.86 L96 206 A18 18 0 0 1 78 224 L62 224 A30 30 0 0 1 32 194 Z";

const RADIUS = 112.64;
const MARK_AT = `transform="translate(256 256) scale(1.12) translate(-128 -128)"`;

interface Scene {
  sky: [string, string];
  mark: [string, string];
  shade: string;
  defs?: string;
  art: string;
}

const round = (value: number) => Math.round(value * 10) / 10;

function polar(radius: number, degrees: number, cx = 256, cy = 256): [number, number] {
  const angle = (degrees * Math.PI) / 180;
  return [round(cx + radius * Math.cos(angle)), round(cy + radius * Math.sin(angle))];
}

function arc(radius: number, from: number, to: number): string {
  const [x0, y0] = polar(radius, from);
  const [x1, y1] = polar(radius, to);
  return `M${x0} ${y0} A${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

function pine(x: number, base: number, height: number, fill: string): string {
  const width = height * 0.42;
  const tiers = [0, 0.3, 0.55].map((at, i) => {
    const top = base - height + height * at;
    const spread = width * (0.55 + i * 0.25);
    return `M${round(x)} ${round(top)} L${round(x + spread)} ${round(top + height * 0.42)} L${round(x - spread)} ${round(top + height * 0.42)} Z`;
  });
  return `<path d="${tiers.join(" ")} M${round(x - 3)} ${round(base - height * 0.1)} h6 v${round(height * 0.12)} h-6 Z" fill="${fill}"/>`;
}

function stars(points: [number, number, number][], fill: string): string {
  return points.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" opacity="${r > 2 ? 0.95 : 0.6}"/>`).join("");
}

function brush(radius: number, from: number, to: number): string {
  const steps = 48;
  const outer: string[] = [];
  const inner: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const half = 26 * (t < 0.08 ? 0.55 + 5.6 * t : 1 - 0.62 * t);
    const wobble = radius + 4 * Math.sin(t * 7);
    const angle = from + (to - from) * t;
    outer.push(polar(wobble + half, angle).join(" "));
    inner.unshift(polar(wobble - half, angle).join(" "));
  }
  return `M${outer.join(" L")} L${inner.join(" L")} Z`;
}

function ink(mode: PresetMode): Scene {
  const dark = mode === "dark";
  const stroke = dark ? "#f2f2f0" : "#141414";
  const paper = dark ? "#121212" : "#f6f5f0";
  return {
    sky: dark ? ["#1d1d1d", "#0b0b0b"] : ["#fbfaf7", "#ecebe6"],
    mark: dark ? ["#ffffff", "#d9d9d6"] : ["#2a2a2a", "#0a0a0a"],
    shade: dark ? "#000000" : "#5c5a52",
    art:
      `<path d="${brush(192, 132, 410)}" fill="${stroke}"/>` +
      `<g fill="none" stroke="${stroke}" stroke-linecap="round" stroke-width="3.5" opacity="0.7">` +
      `<path d="${arc(186, 330, 424)}"/><path d="${arc(198, 350, 418)}"/><path d="${arc(206, 372, 428)}"/></g>` +
      stars(
        [
          [124, 432, 8],
          [100, 456, 4.5],
          [146, 462, 3.2],
          [84, 414, 2.6],
        ],
        stroke,
      ) +
      `<rect x="390" y="398" width="46" height="46" rx="6" fill="#c8322b"/>` +
      `<rect x="398" y="406" width="30" height="30" rx="3" fill="none" stroke="${paper}" stroke-width="3.5"/>`,
  };
}

function frost(mode: PresetMode): Scene {
  const dark = mode === "dark";
  const back = dark ? "#123c4c" : "#a9d6e8";
  const front = dark ? "#0b2a37" : "#5d9fbd";
  const snow = dark ? "#d6eef6" : "#ffffff";
  const ridge = "M0 372 L70 300 L118 338 L176 262 L236 352 L280 336 L336 270 L392 330 L446 252 L512 318 L512 512 L0 512 Z";
  return {
    sky: dark ? ["#082230", "#0f3a4a"] : ["#eaf8fd", "#c8e8f4"],
    mark: dark ? ["#ffffff", "#cdeef8"] : ["#164a60", "#0b3344"],
    shade: dark ? "#00080c" : "#2c6f8a",
    defs:
      `<filter id="soft" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="16"/></filter>` +
      `<linearGradient id="field" x1="0" y1="400" x2="0" y2="512" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${snow}" stop-opacity="0"/><stop offset="1" stop-color="${snow}" stop-opacity="${dark ? 0.2 : 0.75}"/></linearGradient>` +
      `<linearGradient id="aurora" x1="0" y1="0" x2="512" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#5ff2c9"/><stop offset="0.6" stop-color="#5fd6f2"/><stop offset="1" stop-color="#8f9cff"/></linearGradient>`,
    art:
      (dark
        ? `<g filter="url(#soft)" opacity="0.75"><path d="M-20 170 C110 90 220 200 330 120 S500 70 540 110 L540 150 C470 120 410 190 330 170 S120 140 -20 230 Z" fill="url(#aurora)"/></g>` +
          stars(
            [
              [60, 70, 2.6],
              [148, 46, 1.6],
              [262, 58, 2],
              [372, 40, 1.6],
              [452, 84, 2.6],
              [96, 210, 1.6],
              [430, 196, 1.6],
            ],
            "#ffffff",
          )
        : `<circle cx="402" cy="104" r="120" fill="#ffffff" opacity="0.55" filter="url(#soft)"/><circle cx="402" cy="104" r="34" fill="#ffffff"/>`) +
      `<path d="M0 330 L92 236 L150 286 L214 214 L300 316 L366 222 L430 282 L512 206 L512 512 L0 512 Z" fill="${back}"/>` +
      `<path d="M92 236 L150 286 L130 282 L112 262 L96 270 L78 252 Z M214 214 L254 262 L232 256 L214 270 L198 246 L190 242 Z M366 222 L398 252 L380 248 L366 262 L352 246 L340 248 Z M512 206 L512 248 L484 240 L470 252 L462 238 Z" fill="${snow}" opacity="${dark ? 0.5 : 0.85}"/>` +
      `<path d="${ridge}" fill="${front}"/>` +
      `<path d="M70 300 L104 326 L88 322 L74 334 L60 318 L42 330 Z M176 262 L214 316 L192 306 L176 322 L162 300 L146 304 Z M336 270 L366 304 L348 298 L334 312 L320 294 L306 302 Z M446 252 L484 290 L464 286 L450 300 L436 282 L420 286 Z" fill="${snow}"/>` +
      `<rect y="400" width="512" height="112" fill="url(#field)"/>`,
  };
}

function moss(mode: PresetMode): Scene {
  const dark = mode === "dark";
  const far = dark ? "#1c4a33" : "#9fd2b0";
  const mid = dark ? "#123824" : "#5fa57c";
  const near = dark ? "#0a2416" : "#2f6f4c";
  return {
    sky: dark ? ["#0b2418", "#174631"] : ["#eef8f0", "#cfe9d7"],
    mark: dark ? ["#ffffff", "#d3f0dc"] : ["#16452c", "#0c2c1b"],
    shade: dark ? "#010a05" : "#2e6b4a",
    defs: `<filter id="mist" x="-10%" y="-80%" width="120%" height="260%"><feGaussianBlur stdDeviation="14"/></filter>`,
    art:
      (dark ? `<circle cx="402" cy="100" r="38" fill="#f1f6e6"/>` : `<circle cx="402" cy="104" r="44" fill="#fff7dc"/>`) +
      `<path d="M0 360 C110 312 200 344 290 322 S450 300 512 330 L512 512 L0 512 Z" fill="${far}"/>` +
      pine(52, 372, 150, mid) +
      pine(112, 380, 112, mid) +
      pine(404, 372, 130, mid) +
      pine(464, 366, 168, mid) +
      `<ellipse cx="256" cy="404" rx="300" ry="22" fill="#ffffff" opacity="${dark ? 0.05 : 0.45}" filter="url(#mist)"/>` +
      `<path d="M0 420 C120 384 220 412 300 404 S440 390 512 412 L512 512 L0 512 Z" fill="${near}"/>` +
      pine(24, 452, 190, near) +
      pine(84, 448, 128, near) +
      pine(432, 446, 140, near) +
      pine(490, 452, 206, near),
  };
}

function matcha(mode: PresetMode): Scene {
  const dark = mode === "dark";
  const bubbles = Array.from({ length: 22 }, (_, i) => {
    const [x, y] = polar(60 + i * 5.6, i * 47 - 30);
    return `<circle cx="${x}" cy="${y}" r="${round(2.4 + (i % 3) * 1.6)}" fill="#ffffff" opacity="${dark ? 0.16 : 0.32}"/>`;
  }).join("");
  return {
    sky: dark ? ["#22241c", "#121410"] : ["#f4f0e2", "#e2dac2"],
    mark: dark ? ["#fbfbea", "#e4ecc0"] : ["#2c3a08", "#1a2404"],
    shade: dark ? "#050700" : "#3d4f0a",
    defs:
      `<radialGradient id="bowl" cx="220" cy="210" r="300" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${dark ? "#4a4740" : "#ffffff"}"/><stop offset="1" stop-color="${dark ? "#1e1c18" : "#d9d1bb"}"/></radialGradient>` +
      `<radialGradient id="foam" cx="236" cy="226" r="210" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${dark ? "#a2c24a" : "#cfe383"}"/><stop offset="0.7" stop-color="${dark ? "#6f9124" : "#9cbe3a"}"/><stop offset="1" stop-color="${dark ? "#45610f" : "#6f8f1c"}"/></radialGradient>` +
      `<filter id="drop" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>`,
    art:
      `<circle cx="268" cy="282" r="214" fill="#000000" opacity="${dark ? 0.45 : 0.18}" filter="url(#drop)"/>` +
      `<circle cx="256" cy="256" r="216" fill="url(#bowl)"/>` +
      `<circle cx="256" cy="256" r="182" fill="url(#foam)"/>` +
      `<path d="${arc(150, 200, 290)}" fill="none" stroke="#ffffff" stroke-width="14" stroke-linecap="round" opacity="${dark ? 0.14 : 0.3}"/>` +
      bubbles +
      `<circle cx="256" cy="256" r="182" fill="none" stroke="#000000" stroke-opacity="0.18" stroke-width="4"/>` +
      `<path d="${arc(204, 196, 254)}" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" opacity="${dark ? 0.18 : 0.8}"/>`,
  };
}

function amber(mode: PresetMode): Scene {
  const dark = mode === "dark";
  const grooves = Array.from({ length: 17 }, (_, i) => {
    const radius = 168 + i * 4;
    return `<circle cx="256" cy="256" r="${radius}" fill="none" stroke="#ffffff" stroke-width="1.4" opacity="${i % 4 === 0 ? 0.14 : 0.06}"/>`;
  }).join("");
  const wedge = (from: number, to: number) => {
    const [x0, y0] = polar(236, from);
    const [x1, y1] = polar(236, to);
    return `M256 256 L${x0} ${y0} A236 236 0 0 1 ${x1} ${y1} Z`;
  };
  return {
    sky: dark ? ["#4a3212", "#1e1408"] : ["#fbf0d6", "#efd9a8"],
    mark: ["#4a2604", "#2e1702"],
    shade: "#7a4a08",
    defs:
      `<radialGradient id="label" cx="214" cy="200" r="230" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffe29a"/><stop offset="0.55" stop-color="#f2b33d"/><stop offset="1" stop-color="#c47a12"/></radialGradient>` +
      `<filter id="drop" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>`,
    art:
      `<circle cx="266" cy="280" r="234" fill="#000000" opacity="${dark ? 0.5 : 0.22}" filter="url(#drop)"/>` +
      `<circle cx="256" cy="256" r="236" fill="#141210"/>` +
      `<circle cx="256" cy="256" r="234" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="3"/>` +
      grooves +
      `<path d="${wedge(200, 236)} ${wedge(20, 56)}" fill="#ffffff" opacity="0.07"/>` +
      `<circle cx="256" cy="256" r="156" fill="url(#label)"/>` +
      `<circle cx="256" cy="256" r="148" fill="none" stroke="#8a5208" stroke-opacity="0.35" stroke-width="2"/>`,
  };
}

function dusk(mode: PresetMode): Scene {
  const dark = mode === "dark";
  const sea = dark ? "#2a1030" : "#e9805e";
  const reflection = dark ? "#ff9a5c" : "#fff1c8";
  return {
    sky: dark ? ["#2a0f2e", "#7a2c3a"] : ["#ffd9b8", "#ffb08a"],
    mark: dark ? ["#ffffff", "#ffe2cf"] : ["#5a1f08", "#3d1203"],
    shade: dark ? "#1a0410" : "#a8401a",
    defs:
      `<linearGradient id="sun" x1="0" y1="190" x2="0" y2="400" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${dark ? "#ffb35c" : "#fff4c9"}"/><stop offset="1" stop-color="${dark ? "#ff5a3c" : "#ffc773"}"/></linearGradient>` +
      `<mask id="cuts"><rect width="512" height="512" fill="#fff"/><rect y="318" width="512" height="7" fill="#000"/><rect y="346" width="512" height="10" fill="#000"/><rect y="374" width="512" height="13" fill="#000"/></mask>` +
      `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="30"/></filter>`,
    art:
      `<circle cx="256" cy="330" r="190" fill="${dark ? "#ff7a45" : "#fff2c4"}" opacity="${dark ? 0.35 : 0.6}" filter="url(#glow)"/>` +
      `<circle cx="256" cy="340" r="160" fill="url(#sun)" mask="url(#cuts)"/>` +
      `<path d="M0 392 C60 376 110 380 150 400 L0 400 Z M512 384 C450 368 400 376 362 400 L512 400 Z" fill="${dark ? "#3a1538" : "#d9694a"}"/>` +
      `<rect y="400" width="512" height="112" fill="${sea}"/>` +
      `<g fill="${reflection}" opacity="${dark ? 0.85 : 0.9}"><rect x="146" y="416" width="220" height="7" rx="3.5"/><rect x="178" y="438" width="156" height="6" rx="3"/><rect x="208" y="458" width="96" height="5" rx="2.5"/><rect x="232" y="476" width="48" height="4" rx="2"/></g>`,
  };
}

function blossom(mode: PresetMode): Scene {
  const dark = mode === "dark";
  const bark = dark ? "#5a2440" : "#5b2a3a";
  const flowers: [number, number, number, number][] = [
    [84, 112, 1.25, 10],
    [168, 64, 1, 40],
    [252, 96, 0.8, 70],
    [362, 56, 1.15, 20],
    [446, 128, 1.3, 50],
    [44, 196, 0.85, 30],
    [470, 222, 0.75, 0],
  ];
  const petals: [number, number, number][] = [
    [118, 408, 30],
    [428, 352, 120],
    [70, 444, 200],
    [458, 450, 60],
    [150, 470, 300],
  ];
  return {
    sky: dark ? ["#2e0f20", "#13060d"] : ["#fff1f6", "#ffd6e5"],
    mark: dark ? ["#ffffff", "#ffd9ea"] : ["#5e1238", "#3e0a24"],
    shade: dark ? "#0a0206" : "#b8487c",
    defs:
      `<g id="flower"><g fill="${dark ? "#ff9cc6" : "#ffb3d0"}">${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-17" rx="13" ry="18" transform="rotate(${a})"/>`).join("")}</g>` +
      `<g fill="#ffffff" opacity="${dark ? 0.35 : 0.7}">${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-20" rx="6" ry="9" transform="rotate(${a})"/>`).join("")}</g>` +
      `<circle r="7" fill="${dark ? "#ffd56b" : "#e0567f"}"/></g>`,
    art:
      `<path d="M-20 160 C60 120 120 120 190 84 S320 40 400 82 S480 150 540 160" fill="none" stroke="${bark}" stroke-width="16" stroke-linecap="round"/>` +
      `<path d="M120 124 C110 160 70 190 40 200 M330 62 C350 40 370 34 384 30 M430 112 C452 150 468 190 476 220" fill="none" stroke="${bark}" stroke-width="8" stroke-linecap="round"/>` +
      flowers.map(([x, y, s, a]) => `<use href="#flower" transform="translate(${x} ${y}) rotate(${a}) scale(${s})"/>`).join("") +
      petals
        .map(
          ([x, y, a]) =>
            `<ellipse cx="${x}" cy="${y}" rx="9" ry="13" transform="rotate(${a} ${x} ${y})" fill="${dark ? "#ff9cc6" : "#ff8fb8"}" opacity="0.85"/>`,
        )
        .join(""),
  };
}

function velvet(mode: PresetMode): Scene {
  const dark = mode === "dark";
  const drape = (side: 1 | -1) => {
    const x = (value: number) => (side === 1 ? value : 512 - value);
    return `M${x(0)} 0 L${x(156)} 0 C${x(140)} 140 ${x(104)} 250 ${x(96)} 300 C${x(110)} 360 ${x(148)} 440 ${x(160)} 512 L${x(0)} 512 Z`;
  };
  const scallops = Array.from({ length: 8 }, (_, i) => `A32 22 0 0 1 ${448 - i * 64} 60`).join(" ");
  return {
    sky: dark ? ["#170b2a", "#2a1450"] : ["#f6f0ff", "#e4d6fb"],
    mark: dark ? ["#ffffff", "#e6dbff"] : ["#3a1a6e", "#250e4c"],
    shade: dark ? "#07020f" : "#7a4fc0",
    defs:
      `<linearGradient id="folds" x1="0" y1="0" x2="38" y2="0" gradientUnits="userSpaceOnUse" spreadMethod="reflect"><stop offset="0" stop-color="${dark ? "#2b0f57" : "#7b47c9"}"/><stop offset="1" stop-color="${dark ? "#5a2aa3" : "#b28af0"}"/></linearGradient>` +
      `<radialGradient id="spot" cx="256" cy="440" r="210" gradientTransform="translate(0 264) scale(1 0.4)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff" stop-opacity="${dark ? 0.32 : 0.8}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>` +
      `<linearGradient id="beam" x1="0" y1="60" x2="0" y2="440" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff" stop-opacity="${dark ? 0.16 : 0.5}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>`,
    art:
      `<path d="M210 60 L302 60 L420 470 L92 470 Z" fill="url(#beam)"/>` +
      `<rect width="512" height="512" fill="url(#spot)"/>` +
      `<path d="${drape(1)}" fill="url(#folds)"/><path d="${drape(-1)}" fill="url(#folds)"/>` +
      `<path d="M96 300 l18 -6 l8 14 l-18 8 Z M416 300 l-18 -6 l-8 14 l18 8 Z" fill="${dark ? "#e3b75a" : "#f0c766"}"/>` +
      `<path d="M0 0 H512 V60 ${scallops} Z" fill="url(#folds)"/>` +
      `<rect width="512" height="10" y="0" fill="#000000" opacity="0.15"/>`,
  };
}

const SCENES: Record<DrawnPresetId, (mode: PresetMode) => Scene> = { ink, frost, moss, matcha, amber, dusk, blossom, velvet };

export function drawPresetIcon(id: DrawnPresetId, mode: PresetMode): string {
  const { sky, mark, shade, defs = "", art } = SCENES[id](mode);
  const rim = mode === "dark" ? `stroke="#ffffff" stroke-opacity="0.1"` : `stroke="#000000" stroke-opacity="0.08"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><defs>` +
    `<clipPath id="tile"><rect width="512" height="512" rx="${RADIUS}"/></clipPath>` +
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="512" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient>` +
    `<linearGradient id="mk" x1="0" y1="148" x2="0" y2="364" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${mark[0]}"/><stop offset="1" stop-color="${mark[1]}"/></linearGradient>` +
    `<linearGradient id="light" x1="0" y1="0" x2="0" y2="512" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff" stop-opacity="${mode === "dark" ? 0.1 : 0.22}"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/></linearGradient>` +
    `<filter id="lift" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="${shade}" flood-opacity="${mode === "dark" ? 0.55 : 0.35}"/></filter>` +
    defs +
    `</defs><g clip-path="url(#tile)"><rect width="512" height="512" fill="url(#bg)"/>${art}` +
    `<path ${MARK_AT} d="${MARK}" fill="url(#mk)" filter="url(#lift)"/>` +
    `<rect width="512" height="512" fill="url(#light)"/></g>` +
    `<rect x="1" y="1" width="510" height="510" rx="${RADIUS - 1}" fill="none" ${rim} stroke-width="2"/></svg>`
  );
}
