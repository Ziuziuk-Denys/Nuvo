import type { JSX } from "react";
import { IconButton } from "../components/IconButton";
import { useTranslation } from "../ports/i18n";
import type { Track } from "../ports/player";
import { songMenuNotInterested } from "./notInterested";

export interface DislikeButtonProps {
  track: Track | (() => Promise<Track | null>);
  size?: "m" | "s";
  className?: string;
  onDisliked?(track: Track): void;
}

export function DislikeButton({ track, size, className, onDisliked }: DislikeButtonProps): JSX.Element {
  const { t } = useTranslation();
  const dislike = async () => {
    const song = typeof track === "function" ? await track() : track;
    if (!song) return;
    songMenuNotInterested?.(song, "exact");
    onDisliked?.(song);
  };
  return (
    <IconButton
      icon="dislike"
      label={t("ui.recs.dislike")}
      size={size}
      className={className}
      data-dislike=""
      data-row-action=""
      onClick={() => void dislike()}
    />
  );
}
