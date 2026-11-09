import { useImportsUi } from "../screens/imports/importsUi";

export const IMPORT_SOURCES = ["spotify", "apple", "deezer", "youtube", "soundcloud"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const IMPORT_MODES: Record<ImportSource, "file" | "link" | "likes"> = {
  spotify: "link",
  apple: "link",
  deezer: "link",
  youtube: "link",
  soundcloud: "likes",
};

export function openImportSheet(source: ImportSource): Promise<void> {
  useImportsUi.getState().openImport({ mode: IMPORT_MODES[source] });
  return new Promise((done) => {
    const stop = useImportsUi.subscribe((state) => {
      if (state.sheet !== null) return;
      stop();
      done();
    });
  });
}
