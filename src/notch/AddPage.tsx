import { useEffect, useState } from "react";
import { useTranslation } from "@/i18n";
import { Icon } from "@/ui/icons/Icon";
import { Cover } from "./Cover";
import type { NotchAction, NotchPlaylists } from "./contracts";

const ADDED_HOLD_MS = 1200;
const OUTCOMES = { added: "ui.add.added", already: "ui.add.already", failed: "ui.add.failed" } as const;

interface AddPageProps {
  trackId: string;
  playlists: NotchPlaylists | null;
  accent: string;
  onAction: (action: NotchAction) => void;
  onDone: () => void;
}

export function AddPage({ trackId, playlists, accent, onAction, onDone }: AddPageProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<string | null>(null);
  const listed = playlists?.items ?? [];
  const [order] = useState(() => new Map(listed.map((item, index) => [item.id, index])));
  const items = [...listed].sort((a, b) => (order.get(a.id) ?? listed.length) - (order.get(b.id) ?? listed.length));
  const outcome = playlists?.outcome?.trackId === trackId ? playlists.outcome : null;
  const settled = pending !== null && outcome?.playlistId === pending ? outcome : null;
  const added = settled?.kind === "added";

  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(onDone, ADDED_HOLD_MS);
    return () => clearTimeout(timer);
  }, [added, onDone]);

  const meta = (playlistId: string, count: number) => (outcome?.playlistId === playlistId ? t(OUTCOMES[outcome.kind]) : t("common.songs", { count }));

  return (
    <>
      <h2 className="add-title">{t("ui.add.title")}</h2>
      {items.length === 0 ? (
        <p className="empty">{t("ui.add.empty")}</p>
      ) : (
        <ul className="rows add-rows" data-control>
          {items.map((item) => {
            const done = outcome?.playlistId === item.id && outcome.kind !== "failed";
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="row"
                  onClick={() => {
                    if (done) return;
                    setPending(item.id);
                    onAction({ type: "addToPlaylist", trackId, playlistId: item.id });
                  }}
                >
                  <Cover src={item.coverUrl} size={34} radius={7} />
                  <span className="row-text">
                    <span className="row-title">{item.title}</span>
                    <span className="row-meta">{meta(item.id, item.trackCount)}</span>
                  </span>
                  <span className="row-mark" data-done={done} style={done ? { color: accent } : undefined}>
                    <Icon name={done ? "check" : "add"} size={18} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
