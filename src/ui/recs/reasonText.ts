import type { TFunction } from "../ports/i18n";
import type { RankReason } from "../ports/recs";

export function reasonText(reason: RankReason | null, t: TFunction): string | null {
  const name = reason?.name;
  switch (reason?.kind) {
    case "session":
      return name ? t("ui.recs.reason.session", { name }) : null;
    case "similar":
      return name ? t("ui.recs.reason.similar", { name }) : null;
    case "artist":
      return name ? t("ui.recs.reason.artist", { name }) : null;
    case "time":
      return t("ui.recs.reason.time");
    case "new":
      return t("ui.recs.reason.new");
    default:
      return null;
  }
}
