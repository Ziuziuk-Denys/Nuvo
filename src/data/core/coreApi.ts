import { coreRequest } from "./request";

export const coreApi = {
  health: () => coreRequest<{ status: string; locked: boolean; passphrase?: boolean }>("GET", "/health"),
  unlockWithPassphrase: (passphrase: string) => coreRequest<void>("POST", "/v1/recovery/passphrase", { passphrase }),
  keyStorage: () => coreRequest<{ protection: "keyring" | "file" | "passphrase" }>("GET", "/v1/system/key-storage"),
  setKeyPassphrase: (passphrase: string | null) => coreRequest<{ protection: "keyring" | "file" | "passphrase" }>("PUT", "/v1/system/key-passphrase", { passphrase }),
  recoveryPhrase: async () => (await coreRequest<{ phrase: string }>("GET", "/v1/recovery/phrase")).phrase,
  confirmPhrase: () => coreRequest<void>("POST", "/v1/recovery/confirm"),
  restore: (phrase: string) => coreRequest<void>("POST", "/v1/recovery/restore", { phrase }),
  async isLibraryEmpty(): Promise<boolean> {
    const [liked, playlists] = await Promise.all([
      coreRequest<{ items: unknown[] }>("GET", "/v1/me/library/tracks?limit=1"),
      coreRequest<{ items: unknown[] }>("GET", "/v1/me/playlists"),
    ]);
    return liked.items.length === 0 && playlists.items.length === 0;
  },
};
