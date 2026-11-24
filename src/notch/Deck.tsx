import { useTranslation } from "@/i18n";
import { Icon } from "@/ui/icons/Icon";
import { Cover } from "./Cover";
import type { NotchTrack } from "./contracts";
import type { NotchPage } from "./lib/geometry";

const NAMES = { now: "ui.notch.now", lyrics: "ui.notch.lyrics", upNext: "ui.notch.up_next", add: "ui.add.title" } as const;

interface DeckProps {
  track: NotchTrack;
  page: NotchPage;
  next: NotchPage | null;
  ahead: number;
  nudge: boolean;
  onPage: (page: NotchPage) => void;
  onFocusApp: () => void;
}

export function Deck({ track, page, next, ahead, nudge, onPage, onFocusApp }: DeckProps) {
  const { t } = useTranslation();
  const front = page === "now";
  const coverLabel = !front ? t("ui.notch.back") : next ? t("ui.notch.show", { page: t(NAMES[next]) }) : t("ui.notch.open_app");
  const onCover = () => {
    if (!front) onPage("now");
    else if (next) onPage(next);
    else onFocusApp();
  };
  return (
    <div className="deck" data-front={front} data-hidden={page === "add"} data-nudge={nudge || undefined}>
      {[2, 1].map((depth) => (
        <span key={depth} className="sheet" data-depth={depth} data-on={depth <= ahead} aria-hidden="true" />
      ))}
      <button type="button" className="deck-cover" aria-label={coverLabel} onClick={onCover}>
        <Cover src={track.coverUrl} size={100} radius={14} />
        {next && (
          <span className="deck-name" aria-hidden="true">
            {t(NAMES[next])}
          </span>
        )}
        <span className="deck-back" aria-hidden="true">
          <Icon name="back" size={26} />
        </span>
      </button>
      <div className="deck-row" aria-hidden={front}>
        <button type="button" className="deck-title" tabIndex={-1} aria-hidden="true" onClick={() => onPage("now")}>
          <span>{track.title}</span>
          <span>{track.artist}</span>
        </button>
        {next && !front && (
          <button type="button" className="deck-next" onClick={() => onPage(next)}>
            {t(NAMES[next])}
          </button>
        )}
      </div>
    </div>
  );
}
