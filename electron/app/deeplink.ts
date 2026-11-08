/** `nuvo://` links: parsing and a pull-based delivery that survives a cold start. */

export type DeeplinkType = "artist" | "album" | "playlist" | "track" | "share";

export interface DeeplinkTarget {
  type: DeeplinkType;
  id: string;
}

const ID_RULES: Record<DeeplinkType, RegExp> = {
  artist: /^UC[A-Za-z0-9_-]{22}$/,
  album: /^MPRE[A-Za-z0-9_-]{4,64}$/,
  playlist: /^[A-Za-z0-9_-]{8,64}$/,
  track: /^[A-Za-z0-9_-]{11}$/,
  // a share link carries its songs in the id
  share: /^[A-Za-z0-9_-]{2,65536}$/,
};

/** The longest link: `nuvo://share?id=` and a 65,536-character id. Longer text is refused unparsed. */
export const MAX_LINK_CHARS = 65_536 + "nuvo://share?id=".length;

/** Every other link type stays short. */
const MAX_LINK_LENGTH = 2048;

export function parseDeeplink(raw: string): DeeplinkTarget | null {
  if (raw.length > MAX_LINK_CHARS) return null;
  const match = /^nuvo:\/\/([A-Za-z]+)\?(.*)$/.exec(raw.trim());
  if (!match) return null;
  const type = match[1].toLowerCase() as DeeplinkType;
  if (!(type in ID_RULES)) return null;
  if (type !== "share" && raw.length > MAX_LINK_LENGTH) return null;
  const params = new URLSearchParams(match[2]);
  // a share link is its id alone: any other parameter makes it a different, unknown link
  if (type === "share" && match[2] !== `id=${params.get("id")}`) return null;
  const ids = params.getAll("id");
  if (ids.length !== 1 || !ID_RULES[type].test(ids[0])) return null;
  return { type, id: ids[0] };
}

export function findLinkArg(argv: readonly string[]): string | null {
  return argv.find((arg) => arg.startsWith("nuvo://")) ?? null;
}

/**
 * Holds at most one pending link (the newest wins). The renderer pulls it with `take()` once its listener
 * exists; from then on new links are pushed. A reload or crash stops the push until the next `take()`.
 */
export class LinkInbox {
  private pending: DeeplinkTarget | null = null;
  private listening = false;

  constructor(
    private readonly push: (target: DeeplinkTarget) => void,
    private readonly show: () => void,
  ) {}

  receive(raw: string | null): void {
    const target = raw ? parseDeeplink(raw) : null;
    if (!target) return;
    this.show();
    if (this.listening) this.push(target);
    else this.pending = target;
  }

  take(): DeeplinkTarget | null {
    this.listening = true;
    const target = this.pending;
    this.pending = null;
    return target;
  }

  rendererGone(): void {
    this.listening = false;
  }
}
