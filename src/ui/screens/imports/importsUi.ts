import { create } from "zustand";
import type { CatalogTrack, ImportTarget } from "../../ports/imports";
import type { ImportMode } from "./ImportSheet";

export interface ImportRequest {
  /** A playlist or album link to read at once (search's link block, a pasted link). */
  initialLink?: string;
  /** The tab to open on (File for "Import a file"). */
  mode?: ImportMode;
  target?: ImportTarget;
  /** "Add to playlist" from a link: this song joins the new playlist once it exists. */
  pendingTrack?: CatalogTrack;
}

interface ImportsUi {
  sheet: ImportRequest | null;
  reportId: string | null;
  openImport(request?: ImportRequest): void;
  openReport(importId: string): void;
  close(): void;
}

/** Which import dialog is open. One at a time: opening the report closes the sheet. */
export const useImportsUi = create<ImportsUi>((set) => ({
  sheet: null,
  reportId: null,
  openImport: (request = {}) => set({ sheet: request, reportId: null }),
  openReport: (importId) => set({ sheet: null, reportId: importId }),
  close: () => set({ sheet: null, reportId: null }),
}));
