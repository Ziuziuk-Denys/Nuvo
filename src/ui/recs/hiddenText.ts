import type { TFunction } from "../ports/i18n";
import type { Suppression } from "../ports/recs";
import { firstArtist } from "./notInterestedItems";

const MONTH_MS = 30 * 86_400_000;

export function hiddenTitle(item: Suppression, t: TFunction): string {
  if (!item.track) return t("ui.recs.hidden.unknown");
  if (item.scope === "artist" || item.scope === "artist_forever") return firstArtist(item.track) || item.track.title;
  return item.track.title;
}

export function hiddenLine(item: Suppression, now: number, t: TFunction): string {
  const scope = t(`ui.recs.hidden.scope_${item.scope}`);
  if (item.fadesAt === null) return `${scope} · ${t("ui.recs.hidden.always")}`;
  const months = Math.max(1, Math.ceil((item.fadesAt - now) / MONTH_MS));
  return `${scope} · ${t("ui.recs.hidden.fades", { count: months })}`;
}
