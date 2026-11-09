import type { JSX } from "react";
import { Menu } from "../components/Menu";
import { useTranslation } from "../ports/i18n";
import type { Track } from "../ports/recs";
import { markNotInterested } from "./notInterested";
import { notInterestedItems } from "./notInterestedItems";

export interface NotInterestedMenuProps {
  track: Track;
  open: boolean;
  at: { x: number; y: number };
  onClose(): void;
}

export function NotInterestedMenu({ track, open, at, onClose }: NotInterestedMenuProps): JSX.Element {
  const { t } = useTranslation();
  const items = notInterestedItems(track, t, (picked, scope) => void markNotInterested(picked, scope));
  return <Menu open={open} anchor={null} at={at} onClose={onClose} items={items} />;
}
