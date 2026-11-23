import type { JSX } from "react";
import { Cover } from "../components/Cover";
import { Icon } from "../icons/Icon";
import type { HomePin } from "../ports/library";

export function PinArt({ pin, size, radius }: { pin: HomePin; size: number; radius: number }): JSX.Element {
  if (pin.imageUrl) return <Cover src={pin.imageUrl} size={size} radius={radius} shape={pin.kind === "artist" ? "circle" : "square"} />;
  return <Icon name={pin.kind === "artist" ? "artist" : pin.kind === "album" ? "album" : "playlist"} size={20} />;
}
