/** Plain texts for failed imports and listing notices, as i18n keys under `ui.imports`. */
import type { Message } from "./report";
import { ImportError, type ListingNotice, type RowSource } from "./types";

export function errorMessage(error: unknown): Message {
  if (!(error instanceof ImportError)) return { key: "ui.imports.error.network" };
  return {
    key: `ui.imports.error.${error.code}`,
    ...(error.host ? { vars: { host: error.host } } : {}),
  };
}

export function noticeMessage(notice: ListingNotice, source: RowSource): Message {
  // Spotify's public page stops at 100 songs whatever the total
  if (notice.kind === "partial" && source === "spotify")
    return { key: "ui.imports.notice.partial_spotify", vars: { shown: notice.shown, count: notice.shown } };
  if (notice.kind === "partial")
    return {
      key: "ui.imports.notice.partial",
      vars: { shown: notice.shown, total: notice.total ?? notice.shown, count: notice.total ?? notice.shown },
    };
  return {
    key: `ui.imports.notice.${notice.kind}`,
    vars: { kept: notice.kept, count: notice.kept },
  };
}
