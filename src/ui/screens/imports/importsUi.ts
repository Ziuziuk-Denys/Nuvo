import { create } from "zustand";
import type { CatalogTrack, ImportTarget } from "../../ports/imports";
import type { ImportMode } from "./ImportSheet";

export interface ImportRequest {
  initialLink?: string;
  mode?: ImportMode;
  target?: ImportTarget;
  pendingTrack?: CatalogTrack;
}

interface ImportsUi {
  sheet: ImportRequest | null;
  reportId: string | null;
  openImport(request?: ImportRequest): void;
  openReport(importId: string): void;
  close(): void;
}

export const useImportsUi = create<ImportsUi>((set) => ({
  sheet: null,
  reportId: null,
  openImport: (request = {}) => set({ sheet: request, reportId: null }),
  openReport: (importId) => set({ sheet: null, reportId: importId }),
  close: () => set({ sheet: null, reportId: null }),
}));
