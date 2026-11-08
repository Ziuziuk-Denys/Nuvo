import type { JSX } from "react";
import { IconButton } from "../components/IconButton";
import { useTranslation } from "../ports/i18n";
import type { Track } from "../ports/player";
import { songMenuNotInterested } from "./notInterested";

export interface DislikeButtonProps {
  /** The song, or how to get it when a row holds only what was heard. */
  track: Track | (() => Promise<Track | null>);
  size?: "m" | "s";
  className?: string;
  /** After the dislike was sent, as when a suggestion leaves its list. */
  onDisliked?(track: Track): void;
}

/** One press: "Not this recording", with the Undo notice; the narrower and wider choices stay in the song menu. */
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
