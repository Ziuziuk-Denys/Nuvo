import { CORE_BASE_URL } from "@/data/core/request";
import { playerEngine } from "@/engine/compat";
import { createDaemonClient } from "@/engine/sources/daemon";
import type { Track } from "@/engine/types";

// Test-only e2e hooks: loaded in dev builds only, never in a packaged build
export interface NuvoDebug {
  playBlob(blob: Blob, id: string, title?: string): Promise<void>;
}

declare global {
  interface Window {
    __nuvo_debug?: NuvoDebug;
  }
}

window.__nuvo_debug = {
  async playBlob(blob, id, title = id) {
    const status = await createDaemonClient(CORE_BASE_URL).putCache(id, blob, blob.type || "audio/wav", "wav", 0);
    if (status < 200 || status >= 300) throw new Error(`core cache refused the audio for ${id}`);
    const track: Track = {
      id,
      title,
      artists: "E2E Artist",
      coverUrl: "",
      playCount: 0,
      durationMs: 30_000,
    };
    await playerEngine.playTrack(track);
  },
};
