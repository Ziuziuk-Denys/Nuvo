export const MAX_BINDINGS = 32;
export const MAX_ACCELERATOR = 64;
export const PLAYER_COMMAND_IDS: Record<string, "toggle" | "next" | "previous"> = {
  "player.toggle": "toggle",
  "player.next": "next",
  "player.previous": "previous",
};

// Only these commands may be bound system-wide, whatever the renderer sends
export const GLOBAL_COMMAND_IDS: ReadonlySet<string> = new Set([
  "player.toggle",
  "player.next",
  "player.previous",
  "player.seek-forward",
  "player.seek-back",
  "player.volume-up",
  "player.volume-down",
  "player.mute",
  "library.like-toggle",
  "app.show",
  "app.palette",
]);

const MODIFIER_NAMES: Record<string, string> = {
  command: "super",
  cmd: "super",
  super: "super",
  meta: "super",
  control: "control",
  ctrl: "control",
  commandorcontrol: "control",
  cmdorctrl: "control",
  alt: "alt",
  option: "alt",
  altgr: "alt",
  shift: "shift",
};

function reserved(accelerator: string): boolean {
  const parts = accelerator.toLowerCase().split("+");
  const key = parts.pop()!;
  const modifiers = new Set(parts.map((part) => MODIFIER_NAMES[part]));
  if (key === "escape" || key === "esc") return true;
  if (modifiers.has("alt") && !modifiers.has("control") && (key === "tab" || key === "f4")) return true;
  if (modifiers.has("alt") && modifiers.has("control") && key === "delete") return true;
  const onlyMain = modifiers.size === 1 && (modifiers.has("control") || modifiers.has("super"));
  return onlyMain && "cvxazy".includes(key) && key.length === 1;
}

export interface Binding {
  commandId: string;
  accelerator: string;
}

export interface BindingResult {
  commandId: string;
  ok: boolean;
  reason?: "invalid" | "taken" | "unsupported";
}

export interface GlobalShortcutLike {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

const MODIFIERS = new Set(["command", "cmd", "control", "ctrl", "commandorcontrol", "cmdorctrl", "alt", "option", "altgr", "shift", "super", "meta"]);
const KEYS =
  /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Plus|Space|Tab|Capslock|Numlock|Scrolllock|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|VolumeUp|VolumeDown|VolumeMute|MediaNextTrack|MediaPreviousTrack|MediaStop|MediaPlayPause|PrintScreen|num[0-9]|numdec|numadd|numsub|nummult|numdiv|numenter|[)!@#$%^&*(:;=<,_\-.>/?~`{}|\\[\]'"])$/i;

const STANDALONE_KEYS = /^(F([1-9]|1[0-9]|2[0-4])|VolumeUp|VolumeDown|VolumeMute|MediaNextTrack|MediaPreviousTrack|MediaStop|MediaPlayPause)$/i;

export function validAccelerator(accelerator: string): boolean {
  if (accelerator.length === 0 || accelerator.length > MAX_ACCELERATOR) return false;
  const parts = accelerator.split("+");
  const key = parts.pop()!;
  if (!parts.every((p) => MODIFIERS.has(p.toLowerCase())) || !KEYS.test(key)) return false;
  // a bare letter or Shift+letter would hijack typing system-wide; only media keys and F1-F24 may stand alone
  const hasRealModifier = parts.some((p) => p.toLowerCase() !== "shift");
  return hasRealModifier || STANDALONE_KEYS.test(key);
}

export class GlobalShortcuts {
  private registered: string[] = [];

  constructor(
    private readonly shortcuts: GlobalShortcutLike,
    private readonly supported: () => boolean,
    private readonly fire: (commandId: string) => void,
  ) {}

  set(bindings: Binding[]): BindingResult[] {
    for (const accelerator of this.registered) this.shortcuts.unregister(accelerator);
    this.registered = [];
    return bindings.slice(0, MAX_BINDINGS).map(({ commandId, accelerator }) => {
      if (!GLOBAL_COMMAND_IDS.has(commandId) || !validAccelerator(accelerator) || reserved(accelerator)) return { commandId, ok: false, reason: "invalid" };
      if (!this.supported()) return { commandId, ok: false, reason: "unsupported" };
      let ok = false;
      try {
        ok = this.shortcuts.register(accelerator, () => this.fire(commandId));
      } catch {
        return { commandId, ok: false, reason: "invalid" };
      }
      if (!ok) return { commandId, ok: false, reason: "taken" };
      this.registered.push(accelerator);
      return { commandId, ok: true };
    });
  }

  clear(): void {
    this.set([]);
  }
}
