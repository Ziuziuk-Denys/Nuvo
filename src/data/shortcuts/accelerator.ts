/** Accelerators: Electron's "modifiers+key" text in one canonical spelling, built from key positions. */

export const MAX_ACCELERATOR = 64;

const MODIFIER_ORDER = ["Control", "Alt", "Shift", "Super"] as const;
export type Modifier = (typeof MODIFIER_ORDER)[number];

const MODIFIER_NAMES: Record<string, Modifier> = {
  control: "Control",
  ctrl: "Control",
  commandorcontrol: "Control",
  cmdorctrl: "Control",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  super: "Super",
  meta: "Super",
  command: "Super",
  cmd: "Super",
};

const NAMED_KEYS: Record<string, string> = {
  space: "Space",
  tab: "Tab",
  return: "Return",
  enter: "Return",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  plus: "Plus",
  minus: "-",
  escape: "Escape",
  esc: "Escape",
  numadd: "numadd",
  numsub: "numsub",
  numenter: "numenter",
  numdec: "numdec",
  nummult: "nummult",
  numdiv: "numdiv",
};

const PUNCTUATION = new Set(["-", "=", "[", "]", ";", "'", "`", ",", ".", "/", "\\"]);

/** Russian ЙЦУКЕН and Ukrainian letters to the US key in the same place. */
const CYRILLIC_POSITIONS: Record<string, string> = {
  й: "Q",
  ц: "W",
  у: "E",
  к: "R",
  е: "T",
  н: "Y",
  г: "U",
  ш: "I",
  щ: "O",
  з: "P",
  х: "[",
  ъ: "]",
  ф: "A",
  ы: "S",
  в: "D",
  а: "F",
  п: "G",
  р: "H",
  о: "J",
  л: "K",
  д: "L",
  ж: ";",
  э: "'",
  я: "Z",
  ч: "X",
  с: "C",
  м: "V",
  и: "B",
  т: "N",
  ь: "M",
  б: ",",
  ю: ".",
  ё: "`",
  і: "S",
  ї: "]",
  є: "'",
  ґ: "\\",
};

const CODE_KEYS: Record<string, string> = {
  Space: "Space",
  Tab: "Tab",
  Enter: "Return",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Escape: "Escape",
  NumpadAdd: "numadd",
  NumpadSubtract: "numsub",
  NumpadEnter: "numenter",
  NumpadDecimal: "numdec",
  NumpadMultiply: "nummult",
  NumpadDivide: "numdiv",
};

const CHARACTER_KEYS: Record<string, string> = {
  " ": "Space",
  Tab: "Tab",
  Enter: "Return",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Escape: "Escape",
};

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "AltGraph", "Meta", "OS", "Super", "Hyper"]);
const MODIFIER_CODE = /^(Control|Shift|Alt|Meta|OS)(Left|Right)$/;

function canonicalKey(raw: string): string | null {
  if (raw.length === 1) {
    const lower = raw.toLowerCase();
    if (lower >= "a" && lower <= "z") return lower.toUpperCase();
    if (raw >= "0" && raw <= "9") return raw;
    if (PUNCTUATION.has(raw)) return raw;
    return CYRILLIC_POSITIONS[lower] ?? null;
  }
  const lower = raw.toLowerCase();
  const fKey = /^f([1-9]|1[0-9]|2[0-4])$/.exec(lower);
  if (fKey) return `F${fKey[1]}`;
  const numpad = /^num([0-9])$/.exec(lower);
  if (numpad) return `num${numpad[1]}`;
  return NAMED_KEYS[lower] ?? null;
}

function join(modifiers: Iterable<Modifier>, key: string): string {
  const held = new Set(modifiers);
  return [...MODIFIER_ORDER.filter((modifier) => held.has(modifier)), key].join("+");
}

/** The canonical form of an accelerator, or null when it does not parse. "Control++" reads as Control+Plus. */
export function parseAccelerator(text: string): string | null {
  if (!text || text.length > MAX_ACCELERATOR) return null;
  let parts = text.split("+");
  let key: string | null;
  if (text.endsWith("++")) {
    key = "Plus";
    parts = parts.slice(0, -2);
  } else {
    key = canonicalKey(parts.pop()!.trim());
  }
  if (!key) return null;
  const modifiers: Modifier[] = [];
  for (const part of parts) {
    const modifier = MODIFIER_NAMES[part.trim().toLowerCase()];
    if (!modifier) return null;
    modifiers.push(modifier);
  }
  return join(modifiers, key);
}

export interface KeyLike {
  code: string;
  key: string;
  /** Set while an input method is composing; such events belong to the input method. */
  isComposing?: boolean;
  keyCode?: number;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

function keyFromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  const numpad = /^Numpad([0-9])$/.exec(code);
  if (numpad) return `num${numpad[1]}`;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return CODE_KEYS[code] ?? null;
}

function keyFromCharacter(key: string): string | null {
  return CHARACTER_KEYS[key] ?? (key.length === 1 ? canonicalKey(key) : null);
}

/** True for key events of an input method composition (keyCode 229 on engines that do not set isComposing). */
export function isComposing(event: Pick<KeyLike, "isComposing" | "keyCode">): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

export function heldModifiers(event: KeyLike): Modifier[] {
  const held: Modifier[] = [];
  if (event.ctrlKey) held.push("Control");
  if (event.altKey) held.push("Alt");
  if (event.shiftKey) held.push("Shift");
  if (event.metaKey) held.push("Super");
  return held;
}

/** The accelerator a key press makes, from the key's position; null for a modifier alone. */
export function acceleratorFromEvent(event: KeyLike): string | null {
  if (MODIFIER_KEYS.has(event.key) || MODIFIER_CODE.test(event.code)) return null;
  // the code names the physical key, so the layout does not matter; some virtual keyboards send no code
  const key = keyFromCode(event.code) ?? keyFromCharacter(event.key);
  if (!key) return null;
  return join(heldModifiers(event), key);
}

/** The key of a canonical accelerator, without its modifiers. */
export function acceleratorKey(accelerator: string): string {
  return accelerator.slice(accelerator.lastIndexOf("+") + 1);
}

export type Platform = "mac" | "other";

export interface Keycap {
  text: string;
  /** Words for screen readers. */
  label: string;
}

const MODIFIER_CAPS: Record<Platform, Record<Modifier, string>> = {
  other: { Control: "Ctrl", Alt: "Alt", Shift: "Shift", Super: "Super" },
  mac: { Control: "⌃", Alt: "⌥", Shift: "⇧", Super: "⌘" },
};

const KEY_CAPS: Record<string, Keycap> = {
  Return: { text: "Enter", label: "Enter" },
  Up: { text: "↑", label: "Up arrow" },
  Down: { text: "↓", label: "Down arrow" },
  Left: { text: "←", label: "Left arrow" },
  Right: { text: "→", label: "Right arrow" },
  Plus: { text: "+", label: "Plus" },
  numadd: { text: "Num +", label: "Num plus" },
  numsub: { text: "Num -", label: "Num minus" },
  numenter: { text: "Num Enter", label: "Num Enter" },
  numdec: { text: "Num .", label: "Num decimal" },
  nummult: { text: "Num *", label: "Num multiply" },
  numdiv: { text: "Num /", label: "Num divide" },
};

/** Keycaps for display: Ctrl, Alt, Shift, Super on Linux and Windows, ⌃ ⌥ ⇧ ⌘ on macOS. */
export function formatKeycaps(accelerator: string, platform: Platform): Keycap[] {
  const canonical = parseAccelerator(accelerator);
  if (!canonical) return [];
  const parts = canonical.split("+");
  const key = parts.pop()!;
  const caps: Keycap[] = (parts as Modifier[]).map((modifier) => ({ text: MODIFIER_CAPS[platform][modifier], label: modifier }));
  const numpad = /^num([0-9])$/.exec(key);
  caps.push(KEY_CAPS[key] ?? (numpad ? { text: `Num ${numpad[1]}`, label: `Num ${numpad[1]}` } : { text: key, label: key }));
  return caps;
}
