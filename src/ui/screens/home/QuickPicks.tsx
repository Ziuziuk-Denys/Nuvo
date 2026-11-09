import type { JSX, ReactNode } from "react";
import { Cover } from "../../components/Cover";
import { Icon } from "../../icons/Icon";
import { useTranslation, type TFunction } from "../../ports/i18n";
import { livePins, useHomePinsStore, useLikedTrackCount, usePlaylistsList, type HomePin } from "../../ports/library";
import styles from "./QuickPicks.module.css";

const LIKED_HREF = "/library/playlist?id=likes";
const COVER_SIZE = 56;

interface Pick {
  key: string;
  href: string;
  title: string;
  subtitle?: string;
  cover: ReactNode;
}

function pinSubtitle(pin: HomePin, liveCount: number | undefined, t: TFunction): string | undefined {
  if (liveCount !== undefined) return t("ui.home.tracks", { count: liveCount });
  if (pin.kind === "artist") return t("ui.library.kind_artist");
  if (pin.trackCount !== undefined) return t("ui.home.tracks", { count: pin.trackCount });
  return pin.subtitle;
}

export function QuickPicks({ onOpen }: { onOpen(href: string): void }): JSX.Element {
  const { t } = useTranslation();
  const { data: likedCount, isLoading: likedLoading } = useLikedTrackCount();
  const playlists = usePlaylistsList();
  const pins = useHomePinsStore((state) => state.pins);

  // a failed fetch lists no playlists, so only a clean one may hide pins of deleted playlists
  const settled = playlists.isFetched && !playlists.error && !playlists.isLoading;
  const own = playlists.data.playlists;
  const shown = livePins(pins, settled ? own.map((playlist) => playlist.id) : null);

  const picks: Pick[] = [
    {
      key: "liked",
      href: LIKED_HREF,
      title: t("ui.library.liked"),
      subtitle: likedLoading ? undefined : t("ui.home.songs", { count: likedCount ?? 0 }),
      cover: (
        <span className={styles.liked}>
          <Icon name="liked" size={24} />
        </span>
      ),
    },
    ...shown.map((pin): Pick => {
      const live = pin.href.startsWith("/library/playlist") ? own.find((playlist) => playlist.id === pin.id) : undefined;
      return {
        key: `${pin.kind}:${pin.id}`,
        href: pin.href,
        title: live?.title ?? pin.title,
        subtitle: pinSubtitle(pin, live?.trackCount, t),
        cover: <Cover src={pin.imageUrl ?? ""} size={COVER_SIZE} radius={8} shape={pin.kind === "artist" ? "circle" : "square"} />,
      };
    }),
  ];

  return (
    <div className={styles.grid}>
      {picks.map((pick) => (
        <a
          key={pick.key}
          className={styles.pick}
          href={`#${pick.href}`}
          data-pick
          draggable={false}
          onClick={(event) => {
            event.preventDefault();
            onOpen(pick.href);
          }}
        >
          {pick.cover}
          <span className={styles.text}>
            <span className={styles.title}>{pick.title}</span>
            {pick.subtitle ? <span className={styles.subtitle}>{pick.subtitle}</span> : null}
          </span>
        </a>
      ))}
    </div>
  );
}
