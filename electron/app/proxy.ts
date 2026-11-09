// Only what the owner configured: nothing is bundled, guessed or scanned

type Env = Record<string, string | undefined>;

const PAC_SCHEMES: Record<string, string> = { PROXY: "http", HTTP: "http", HTTPS: "https", SOCKS: "socks5", SOCKS5: "socks5" };
const ENV_NAMES = ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy"];
const USABLE_SCHEMES = ["http:", "https:", "socks5:", "socks5h:"];

export function pacToUrl(pac: string): string | null {
  const [kind, hostPort] = pac.split(";")[0].trim().split(/\s+/);
  const scheme = PAC_SCHEMES[kind?.toUpperCase() ?? ""];
  return scheme && hostPort ? `${scheme}://${hostPort}` : null;
}

function usable(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const withScheme = text.includes("://") ? text : `http://${text}`;
  const port = /:(\d+)\/?$/.exec(withScheme)?.[1];
  try {
    const url = new URL(withScheme);
    if (!USABLE_SCHEMES.includes(url.protocol) || !url.hostname || !port) return null;
    return withScheme.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function envProxy(env: Env): string | null {
  for (const name of ENV_NAMES) {
    const url = usable(env[name]);
    if (url) return url;
  }
  return null;
}

/** `gsettings list-recursively org.gnome.system.proxy`. A PAC mode reaches us through Chromium instead. */
export function gnomeProxy(listing: string | null): string | null {
  if (!listing || !/^org\.gnome\.system\.proxy mode 'manual'$/m.test(listing)) return null;
  const read = (schema: string) => {
    const host = new RegExp(`^org\\.gnome\\.system\\.proxy\\.${schema} host '(.+)'$`, "m").exec(listing)?.[1];
    const port = new RegExp(`^org\\.gnome\\.system\\.proxy\\.${schema} port (\\d+)$`, "m").exec(listing)?.[1];
    return host && port && port !== "0" ? `${host}:${port}` : null;
  };
  const web = read("https") ?? read("http");
  if (web) return `http://${web}`;
  const socks = read("socks");
  return socks ? `socks5://${socks}` : null;
}

/** `~/.config/kioslaverc`: ProxyType 1 is manual; KDE writes `http://host 8080`. */
export function kdeProxy(file: string | null): string | null {
  const section = file?.split(/^\[/m).find((part) => part.startsWith("Proxy Settings]"));
  if (!section || !/^ProxyType=1$/m.test(section)) return null;
  const read = (key: string) => /^(\w+:\/\/)?(.+?)[ :](\d+)\s*$/.exec(new RegExp(`^${key}=(.+)$`, "m").exec(section)?.[1] ?? "");
  const web = read("httpsProxy") ?? read("httpProxy");
  if (web) return usable(`${web[1] ?? "http://"}${web[2]}:${web[3]}`);
  const socks = read("socksProxy");
  return socks ? usable(`socks5://${socks[2]}:${socks[3]}`) : null;
}

export interface ProxySources {
  resolve(): Promise<string>;
  env: Env;
  gsettings(): Promise<string | null>;
  kioslaverc(): Promise<string | null>;
}

const hostPort = (url: string) => url.replace(/^\w+:\/\//, "").replace(/^.*@/, "");

/** `chromiumSees`: Chromium's own system mode already uses it, so it needs no explicit rule. */
export async function detectSystemProxy(sources: ProxySources): Promise<{ url: string | null; chromiumSees: boolean }> {
  const env = envProxy(sources.env);
  const seen = pacToUrl(await sources.resolve().catch(() => "DIRECT"));
  // Chromium's answer never has the credentials an environment URL may carry.
  if (seen) return { url: env && hostPort(env) === hostPort(seen) ? env : seen, chromiumSees: true };
  const url = env ?? gnomeProxy(await sources.gsettings().catch(() => null)) ?? kdeProxy(await sources.kioslaverc().catch(() => null));
  return { url, chromiumSees: false };
}

export function networkBody(url: string | null): string {
  return JSON.stringify({ proxyUrl: url });
}

/** Chromium takes credentials from the `login` event, and calls socks5h plain socks5: it always resolves through the proxy. */
export function chromiumRule(url: string): string {
  return url.replace(/^socks5h:/, "socks5:").replace(/\/\/.*@/, "//");
}

export function withCredentials(url: string, username: string | undefined, password: string | undefined): string {
  if (!username) return url;
  const secret = password ? `:${encodeURIComponent(password)}` : "";
  return url.replace("://", `://${encodeURIComponent(username)}${secret}@`);
}

export function credentialsOf(url: string | null): { username: string; password: string } | null {
  const found = url ? /^\w+:\/\/([^:@]+)(?::([^@]*))?@/.exec(url) : null;
  return found ? { username: decodeURIComponent(found[1]), password: decodeURIComponent(found[2] ?? "") } : null;
}
