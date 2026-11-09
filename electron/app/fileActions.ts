// Paths come from native dialogs or user-picked files read by the preload; a page never names one
import path from "node:path";
import type { AddFolderResult } from "../../src/shell/nuvoShell";
import { type CoreAnswer, coreError } from "./coreCall";
import { CHANNELS } from "./ipc";
import { documentName, LOCAL_ID, validateSaveDocument, validateSaveFiles } from "./files";

export interface FileActionDeps {
  call(method: string, route: string, body?: unknown): Promise<CoreAnswer>;
  pickFolder(title: string, defaultPath: string): Promise<string | null>;
  pickSavePath(title: string, defaultPath: string): Promise<string | null>;
  musicDir(): string;
  documentsDir(): string;
  lastDir: { get(): string | null; set(dir: string): void };
  showInFolder(path: string): void;
  writeFile(target: string, body: Buffer): Promise<void>;
  refuse(channel: string, why: string): void;
}

const DOWN = "nuvo-core is not running";

export function createFileActions(deps: FileActionDeps) {
  const ask = async (method: string, route: string, body?: unknown): Promise<CoreAnswer | null> => {
    try {
      return await (body === undefined ? deps.call(method, route) : deps.call(method, route, body));
    } catch {
      return null;
    }
  };
  const json = <T>(answer: CoreAnswer): T | null => {
    try {
      return JSON.parse(answer.body.toString("utf8")) as T;
    } catch {
      return null;
    }
  };

  return {
    async addFolder(): Promise<AddFolderResult> {
      const folder = await deps.pickFolder("Add a music folder", deps.lastDir.get() ?? deps.musicDir());
      if (!folder) return null;
      const answer = await ask("POST", "/v1/fs/local/roots", { path: folder });
      if (!answer) return { error: DOWN };
      const root = answer.status === 202 ? json<{ id: number; path: string }>(answer) : null;
      return root ? { root } : { error: coreError(answer) };
    },

    async reveal(payload: unknown): Promise<boolean> {
      const trackId = (payload as { trackId?: unknown } | null)?.trackId;
      if (typeof trackId !== "string" || !LOCAL_ID.test(trackId)) {
        deps.refuse(CHANNELS.localReveal, "shape");
        return false;
      }
      const answer = await ask("GET", `/v1/fs/local/tracks/${encodeURIComponent(trackId)}/path`);
      const found = answer?.status === 200 ? json<{ path?: unknown }>(answer) : null;
      if (typeof found?.path !== "string") return false;
      deps.showInFolder(found.path);
      return true;
    },

    /** The page gets an id it can recognize with, never the path. */
    async grantRecognizeFile(payload: unknown): Promise<{ id: string } | null> {
      const file = (payload as { path?: unknown } | null)?.path;
      if (typeof file !== "string" || !path.isAbsolute(file)) {
        deps.refuse(CHANNELS.recognizeFile, "shape");
        return null;
      }
      const answer = await ask("POST", "/v1/fs/recognize/file", { path: file });
      const grant = answer?.status === 200 ? json<{ id?: unknown }>(answer) : null;
      return typeof grant?.id === "string" ? { id: grant.id } : null;
    },

    async saveFiles(payload: unknown): Promise<{ jobId: string } | { error: string } | null> {
      const request = validateSaveFiles(payload);
      if (!request) {
        deps.refuse(CHANNELS.exportSaveFiles, "shape");
        return null;
      }
      const dir = await deps.pickFolder("Save as files", deps.lastDir.get() ?? deps.musicDir());
      if (!dir) return null;
      // the validated request has no path of its own; the folder is the one just picked
      const answer = await ask("POST", "/v1/fs/downloads", { ...request, dir });
      if (!answer) return { error: DOWN };
      const job = answer.status === 202 ? json<{ id?: unknown }>(answer) : null;
      if (typeof job?.id !== "string") return { error: coreError(answer) };
      deps.lastDir.set(dir);
      return { jobId: job.id };
    },

    async saveDocument(payload: unknown): Promise<{ path: string } | { error: string } | null> {
      const request = validateSaveDocument(payload);
      if (!request) {
        deps.refuse(CHANNELS.exportSaveDocument, "shape");
        return null;
      }
      const titles = { library: "Nuvo library", stats: "Nuvo listening" };
      const name = documentName(request.kind === "playlist" ? request.title : titles[request.kind], request.format);
      const target = await deps.pickSavePath("Export", path.join(deps.lastDir.get() ?? deps.documentsDir(), name));
      if (!target) return null;
      const routes = {
        playlist: () => `/v1/fs/export/playlists/${encodeURIComponent((request as { id: string }).id)}?format=${request.format}`,
        library: () => `/v1/fs/export/library?format=${request.format}`,
        stats: () => {
          const { from, to } = request as { from?: string; to?: string };
          return `/v1/fs/export/stats?format=${request.format}${from && to ? `&from=${from}&to=${to}` : ""}`;
        },
      };
      const route = routes[request.kind]();
      const answer = await ask("GET", route);
      if (!answer) return { error: DOWN };
      if (answer.status !== 200) return { error: coreError(answer) };
      try {
        await deps.writeFile(target, answer.body);
      } catch {
        return { error: "the file could not be written" };
      }
      deps.lastDir.set(path.dirname(target));
      return { path: target };
    },
  };
}
