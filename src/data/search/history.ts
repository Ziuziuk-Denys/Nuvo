// Kept by the daemon in the encrypted library; nothing is written to localStorage
import { create } from "zustand";

export type SearchHistoryType = "query" | "track" | "artist" | "album" | "playlist";

export interface SearchHistoryItem {
  id: string;
  type: SearchHistoryType;
  title: string;
  subtitle?: string;
  coverUrl?: string;
  durationMs?: number;
  itemData?: unknown;
  timestamp?: number;
  entryId?: string;
}

export type NewSearchHistoryItem = Omit<SearchHistoryItem, "timestamp" | "entryId">;

export interface SearchHistoryState {
  items: SearchHistoryItem[];
  addItem(item: NewSearchHistoryItem): void;
  removeItem(id: string): void;
  clearHistory(): void;
}

export const LEGACY_HISTORY_KEY = "nuvo_search_history";
export const SHOWN = 30;
const DAEMON_KEEPS = 50;
const KINDS: readonly SearchHistoryType[] = ["query", "track", "artist", "album", "playlist"];

type PostResult = { ok: true; entryId: string } | { ok: false; retry: boolean };

export function queryId(query: string): string {
  return `query:${query.trim().split(/\s+/).join(" ").toLowerCase()}`;
}

function postBody(item: NewSearchHistoryItem) {
  if (item.type === "query") return { kind: "query", query: item.title };
  return {
    kind: item.type,
    item: { id: item.id, title: item.title, subtitle: item.subtitle, coverUrl: item.coverUrl, durationMs: item.durationMs, itemData: item.itemData },
  };
}

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

function fromEntry(value: unknown): SearchHistoryItem | null {
  const entry = value as { id?: unknown; kind?: unknown; query?: unknown; item?: unknown; at?: unknown } | null;
  if (!entry || typeof entry.id !== "string" || !KINDS.includes(entry.kind as SearchHistoryType)) return null;
  const at = typeof entry.at === "string" ? Date.parse(entry.at) : Number.NaN;
  const timestamp = Number.isNaN(at) ? undefined : at;
  if (entry.kind === "query") {
    return typeof entry.query === "string" ? { id: queryId(entry.query), type: "query", title: entry.query, timestamp, entryId: entry.id } : null;
  }
  const item = entry.item as Record<string, unknown> | null | undefined;
  if (!item || typeof item.id !== "string" || typeof item.title !== "string") return null;
  return {
    id: item.id,
    type: entry.kind as SearchHistoryType,
    title: item.title,
    subtitle: text(item.subtitle),
    coverUrl: text(item.coverUrl),
    durationMs: typeof item.durationMs === "number" ? item.durationMs : undefined,
    itemData: item.itemData,
    timestamp,
    entryId: entry.id,
  };
}

function isLegacyItem(value: unknown): value is SearchHistoryItem {
  const item = value as Partial<SearchHistoryItem> | null;
  return Boolean(item) && typeof item!.id === "string" && typeof item!.title === "string" && KINDS.includes(item!.type as SearchHistoryType);
}

export function legacyItems(raw: string): NewSearchHistoryItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { state?: { items?: unknown } } | null)?.state?.items;
  if (!Array.isArray(list)) return [];
  const items = list.filter(isLegacyItem);
  const stamped = items.every((item) => typeof item.timestamp === "number");
  const ordered = stamped ? [...items].sort((a, b) => a.timestamp! - b.timestamp!) : [...items].reverse();
  return ordered.map(({ id, type, title, subtitle, coverUrl, durationMs, itemData }) => ({ id, type, title, subtitle, coverUrl, durationMs, itemData }));
}

export interface SearchHistoryDeps {
  base: string;
  fetch: typeof fetch;
  storage(): Storage | null;
  now?: () => number;
}

export function createSearchHistory(deps: SearchHistoryDeps) {
  const url = `${deps.base}/v1/me/search-history`;
  const now = deps.now ?? Date.now;
  const pending = new Map<string, Promise<PostResult>>();

  async function post(item: NewSearchHistoryItem): Promise<PostResult> {
    try {
      const response = await deps.fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(postBody(item)) });
      if (!response.ok) return { ok: false, retry: response.status !== 400 };
      const entry = (await response.json()) as { id?: unknown };
      return typeof entry.id === "string" ? { ok: true, entryId: entry.id } : { ok: false, retry: true };
    } catch {
      return { ok: false, retry: true };
    }
  }

  async function send(path: string): Promise<boolean> {
    try {
      return (await deps.fetch(`${url}${path}`, { method: "DELETE" })).ok;
    } catch {
      return false;
    }
  }

  async function list(limit = SHOWN): Promise<SearchHistoryItem[] | null> {
    try {
      const response = await deps.fetch(`${url}?limit=${limit}`);
      if (!response.ok) return null;
      const body = (await response.json()) as { items?: unknown };
      if (!Array.isArray(body.items)) return null;
      return body.items.map(fromEntry).filter((item): item is SearchHistoryItem => item !== null);
    } catch {
      return null;
    }
  }

  const useSearchHistoryStore = create<SearchHistoryState>((set, get) => ({
    items: [],
    addItem(input) {
      const item: SearchHistoryItem = { ...input, timestamp: now() };
      set({ items: [item, ...get().items.filter((existing) => existing.id !== item.id)].slice(0, SHOWN) });
      const request = post(input);
      pending.set(item.id, request);
      void request.then((result) => {
        if (pending.get(item.id) === request) pending.delete(item.id);
        if (!result.ok) return;
        set({ items: get().items.map((existing) => (existing === item ? { ...existing, entryId: result.entryId } : existing)) });
      });
    },
    removeItem(id) {
      const item = get().items.find((existing) => existing.id === id);
      const request = pending.get(id);
      set({ items: get().items.filter((existing) => existing.id !== id) });
      void (async () => {
        // a post still in flight lands first, so its row is deleted too and does not come back next launch
        const entryId = item?.entryId ?? (request ? await request.then((result) => (result.ok ? result.entryId : undefined)) : undefined);
        if (entryId) await send(`/${encodeURIComponent(entryId)}`);
      })();
    },
    clearHistory() {
      set({ items: [] });
      void Promise.allSettled([...pending.values()]).then(() => send(""));
    },
  }));

  async function migrate(): Promise<void> {
    let storage: Storage | null;
    let raw: string | null;
    try {
      storage = deps.storage();
      raw = storage?.getItem(LEGACY_HISTORY_KEY) ?? null;
    } catch {
      return;
    }
    if (!storage || raw === null) return;
    const held = await list(DAEMON_KEEPS);
    if (!held) return;
    const heldIds = new Set(held.map((item) => item.id));
    for (const item of legacyItems(raw)) {
      if (heldIds.has(item.type === "query" ? queryId(item.title) : item.id)) continue;
      const result = await post(item);
      if (!result.ok && result.retry) return;
    }
    try {
      storage.removeItem(LEGACY_HISTORY_KEY);
    } catch {}
  }

  let loading: Promise<void> | null = null;

  function loadSearchHistory(): Promise<void> {
    loading ??= (async () => {
      await migrate();
      const items = await list();
      if (!items) return;
      const stored = new Set(items.map((item) => item.id));
      const unsent = useSearchHistoryStore.getState().items.filter((item) => !item.entryId && !stored.has(item.id));
      useSearchHistoryStore.setState({ items: [...unsent, ...items].slice(0, SHOWN) });
    })().finally(() => {
      loading = null;
    });
    return loading;
  }

  return { useSearchHistoryStore, loadSearchHistory };
}
