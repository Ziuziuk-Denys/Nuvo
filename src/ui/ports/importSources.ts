import { useImportsUi } from "../screens/imports/importsUi";

/** The services Nuvo imports from, in the order the first run shows them. */
export const IMPORT_SOURCES = ["spotify", "apple", "deezer", "youtube", "soundcloud"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

/** How each service hands its music over: a file export, a playlist link, or a profile's likes. */
export const IMPORT_MODES: Record<ImportSource, "file" | "link" | "likes"> = {
  spotify: "link",
  apple: "link",
  deezer: "link",
  youtube: "link",
  soundcloud: "likes",
};

/** Opens the import sheet on the service's tab and resolves once the sheet closes. */
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
