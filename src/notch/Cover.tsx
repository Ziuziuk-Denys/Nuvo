import { useState } from "react";
import { Icon } from "@/ui/icons/Icon";
import { coverLight, NEUTRAL_LIGHT } from "./lib/coverLight";

interface CoverProps {
  src: string | null;
  size: number;
  radius: number;
  onAccent?: (color: string) => void;
}

export function Cover({ src, size, radius, onAccent }: CoverProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const style = { width: size, height: size, borderRadius: radius };
  if (!src || failedSrc === src) {
    return (
      <span className="cover cover-placeholder" style={style}>
        <Icon name="nuvo-mark" size={size > 60 ? 26 : 14} />
      </span>
    );
  }
  return (
    <img
      className="cover"
      src={src}
      alt=""
      width={size}
      height={size}
      style={style}
      crossOrigin="anonymous"
      draggable={false}
      onLoad={onAccent ? (event) => onAccent(coverLight(event.currentTarget)) : undefined}
      onError={() => {
        setFailedSrc(src);
        onAccent?.(NEUTRAL_LIGHT);
      }}
    />
  );
}
