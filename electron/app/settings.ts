/** `main-settings.json`: what main needs before the library unlocks. */
import { default as fs } from "node:fs";
import { default as path } from "node:path";
import { DEFAULT_APPEARANCE, type AppearanceFlags } from "./appearanceSafeMode";
import { validZoom } from "./zoom";

export interface ProxySettings {
  mode: "system" | "none" | "manual";
  url?: string;
  username?: string;
  passwordEnc?: string;
}

export interface MainSettings {
  closeToTray: boolean;
  trayHintShown: boolean;
  proxy: ProxySettings;
  discord: { enabled: boolean };
  trackChangeNotice: boolean;
  autoUpdate: boolean;
  /** AppImage only: Nuvo's own entry and icons in the applications menu. */
  menuEntry: boolean;
  appearance: AppearanceFlags;
  /** The main window's zoom level, 0 for 100 %; changed only by the zoom keys. */
  zoomLevel: number;
}

export interface MainSettingsView extends Omit<MainSettings, "proxy"> {
  proxy: Omit<ProxySettings, "passwordEnc"> & { hasPassword: boolean; passwordStorable: boolean };
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
}

export const DEFAULT_MAIN_SETTINGS: MainSettings = {
  closeToTray: true,
  trayHintShown: false,
  proxy: { mode: "system" },
  discord: { enabled: false },
  trackChangeNotice: false,
  autoUpdate: true,
  menuEntry: true,
  appearance: DEFAULT_APPEARANCE,
  zoomLevel: 0,
};

const MAX_USERNAME = 256;
const BOOLEAN_KEYS = ["closeToTray", "trayHintShown", "trackChangeNotice", "autoUpdate", "menuEntry"] as const;

/** The proxy rule: http, https, socks5, socks5h with a host and a port 1..65535. */
export function validProxyUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // `URL` drops a port equal to the scheme's default, so it is read from the text.
    const port = Number(/:(\d+)\/?$/.exec(url)?.[1] ?? 0);
    // credentials never live in the URL; the password is stored encrypted on its own
    return (
      ["http:", "https:", "socks5:", "socks5h:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password &&
      parsed.hostname.length > 0 &&
      Number.isInteger(port) &&
      port >= 1 &&
      port <= 65535
    );
  } catch {
    return false;
  }
}

function repair(raw: Record<string, unknown>, log: (message: string) => void): MainSettings {
  const out: MainSettings = structuredClone(DEFAULT_MAIN_SETTINGS);
  for (const key of BOOLEAN_KEYS) if (typeof raw[key] === "boolean") out[key] = raw[key] as boolean;
  out.zoomLevel = validZoom(raw.zoomLevel);
  const discord = raw.discord as { enabled?: unknown } | undefined;
  if (typeof discord?.enabled === "boolean") out.discord = { enabled: discord.enabled };
  const proxy = raw.proxy as ProxySettings | undefined;
  if (proxy && ["system", "none", "manual"].includes(proxy.mode)) {
    out.proxy = { mode: proxy.mode };
    if (proxy.mode === "manual" && typeof proxy.url === "string" && validProxyUrl(proxy.url)) {
      out.proxy.url = proxy.url;
      if (typeof proxy.username === "string") out.proxy.username = proxy.username;
      if (typeof proxy.passwordEnc === "string") out.proxy.passwordEnc = proxy.passwordEnc;
    }
  }
  const appearance = raw.appearance as Partial<AppearanceFlags> | undefined;
  if (typeof appearance?.safe === "boolean" && Number.isInteger(appearance.failedStarts) && appearance.failedStarts! >= 0) {
    out.appearance = { safe: appearance.safe, failedStarts: Math.min(appearance.failedStarts!, 10) };
  }
  const unknown = Object.keys(raw).filter((key) => !(key in DEFAULT_MAIN_SETTINGS));
  if (unknown.length > 0) log(`[settings] dropping unknown keys: ${unknown.join(", ")}`);
  return out;
}

export class MainSettingsStore {
  private settings: MainSettings;

  constructor(
    private readonly file: string,
    private readonly safeStorage: SafeStorageLike,
    private readonly log: (message: string) => void,
  ) {
    this.settings = this.read();
  }

  private read(): MainSettings {
    let text: string;
    try {
      text = fs.readFileSync(this.file, "utf8");
    } catch {
      return structuredClone(DEFAULT_MAIN_SETTINGS);
    }
    try {
      return repair(JSON.parse(text) as Record<string, unknown>, this.log);
    } catch {
      // keep the unreadable file for the bug report
      fs.copyFileSync(this.file, `${this.file}.bad`);
      return structuredClone(DEFAULT_MAIN_SETTINGS);
    }
  }

  get value(): MainSettings {
    return this.settings;
  }

  view(): MainSettingsView {
    const { passwordEnc, ...proxy } = this.settings.proxy;
    return { ...this.settings, proxy: { ...proxy, hasPassword: Boolean(passwordEnc), passwordStorable: this.safeStorage.isEncryptionAvailable() } };
  }

  /** The stored proxy password; undefined when none is stored or it no longer decrypts. Main only. */
  proxyPassword(): string | undefined {
    const stored = this.settings.proxy.passwordEnc;
    if (!stored) return undefined;
    try {
      return this.safeStorage.decryptString(Buffer.from(stored, "base64"));
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown): { ok: boolean; error?: string } {
    const next = structuredClone(this.settings);
    if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== "boolean") return { ok: false, error: `${key} must be a boolean` };
      next[key as (typeof BOOLEAN_KEYS)[number]] = value;
    } else if (key === "discord") {
      const enabled = (value as { enabled?: unknown } | null)?.enabled;
      if (typeof enabled !== "boolean") return { ok: false, error: "discord.enabled must be a boolean" };
      next.discord = { enabled };
    } else if (key === "proxy") {
      const proxy = value as { mode?: unknown; url?: unknown; username?: unknown; password?: unknown } | null;
      if (!proxy || !["system", "none", "manual"].includes(proxy.mode as string)) return { ok: false, error: "proxy.mode is invalid" };
      next.proxy = { mode: proxy.mode as ProxySettings["mode"] };
      if (proxy.mode === "manual") {
        if (typeof proxy.url !== "string" || !validProxyUrl(proxy.url)) return { ok: false, error: "proxy.url is invalid" };
        next.proxy.url = proxy.url;
        if (proxy.username !== undefined && (typeof proxy.username !== "string" || proxy.username.length > MAX_USERNAME))
          return { ok: false, error: "proxy.username is invalid" };
        if (typeof proxy.username === "string" && proxy.username) next.proxy.username = proxy.username;
        if (typeof proxy.password === "string" && proxy.password.length > 0) {
          if (!this.safeStorage.isEncryptionAvailable()) return { ok: false, error: "passwordStorable: false" };
          next.proxy.passwordEnc = this.safeStorage.encryptString(proxy.password).toString("base64");
        } else if (next.proxy.username && next.proxy.username === this.settings.proxy.username && this.settings.proxy.passwordEnc) {
          // The form never gets the password back: saving it unchanged keeps the stored one.
          next.proxy.passwordEnc = this.settings.proxy.passwordEnc;
        }
      }
    } else if (key === "appearance") {
      // the renderer only switches safe mode; the crash count is main's (setAppearance)
      const safe = (value as { safe?: unknown } | null)?.safe;
      if (typeof safe !== "boolean") return { ok: false, error: "appearance.safe must be a boolean" };
      next.appearance = { safe, failedStarts: safe ? next.appearance.failedStarts : 0 };
    } else {
      return { ok: false, error: `unknown key ${key}` };
    }
    this.write(next);
    this.settings = next;
    return { ok: true };
  }

  /** Main's own write of the zoom level, from the zoom keys. */
  setZoom(level: number): void {
    const next = { ...structuredClone(this.settings), zoomLevel: validZoom(level) };
    this.write(next);
    this.settings = next;
  }

  /** Main's own write of the safe-mode flags (StartWatch). */
  setAppearance(flags: AppearanceFlags): void {
    const next = { ...structuredClone(this.settings), appearance: { ...flags } };
    this.write(next);
    this.settings = next;
  }

  /** Atomic: temporary file in the same directory, fsync, rename. */
  private write(settings: MainSettings): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    try {
      const fd = fs.openSync(temporary, "w", 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(settings, null, 2));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporary, this.file);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
  }
}
