import { createStore } from "zustand/vanilla";
import type { YtAccount } from "@/youtube";
import type { AccountPlaylistRow } from "@/youtube/account/tv";
import type { LibraryItemViewModel } from "./collections";

export const ALBUM_PREFIX = "OLAK5uy_";

export function shelfItems(rows: AccountPlaylistRow[]): LibraryItemViewModel[] {
  return rows.map((row) => {
    const kind = row.id.startsWith(ALBUM_PREFIX) ? "album" : "playlist";
    return {
      kind,
      type: kind,
      id: row.id,
      title: row.title,
      creator: row.subtitle,
      imageUrl: row.coverUrl ?? "",
      href: `/collection?type=${kind}&id=${encodeURIComponent(row.id)}`,
      addedAt: "",
      owned: false,
      source: "youtube",
    };
  });
}

export function createShelf(account: Pick<YtAccount, "status" | "preferences" | "playlists" | "onChange">) {
  const store = createStore<{ items: LibraryItemViewModel[] }>(() => ({ items: [] }));
  let readFor: boolean | null = null;
  account.onChange(() => {
    readFor = null;
    void load();
  });

  async function load(): Promise<void> {
    const signedIn = account.status();
    if (!signedIn || !account.preferences.get().showAccountPlaylists) {
      readFor = null;
      store.setState({ items: [] });
      return;
    }
    if (readFor === signedIn) return;
    readFor = signedIn;
    try {
      store.setState({ items: shelfItems(await account.playlists(new AbortController().signal)) });
    } catch {
      readFor = null;
    }
  }
  return { store, load };
}
