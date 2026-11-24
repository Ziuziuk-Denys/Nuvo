import { useEffect, useRef, useState } from "react";
import { coverLight } from "@/notch/lib/coverLight";
import { Icon } from "@/ui/icons/Icon";
import { NEUTRAL, type CoverLight } from "@/ui/light/readLight";

interface Layer {
  key: number;
  src: string | null;
}

export function Art({ src, onLight }: { src: string | null; onLight?: (light: CoverLight) => void }) {
  const [layers, setLayers] = useState<Layer[]>([{ key: 0, src: null }]);
  const count = useRef(0);

  useEffect(() => {
    let live = true;
    const show = () => {
      count.current += 1;
      const layer = { key: count.current, src };
      setLayers((now) => (now.at(-1)?.src === src ? now : [now.at(-1)!, layer]));
    };
    if (!src) {
      show();
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = src;
    image.decode().then(
      () => {
        if (!live) return;
        onLight?.(coverLight(image) ?? NEUTRAL);
        show();
      },
      () => {
        if (!live) return;
        onLight?.(NEUTRAL);
        setLayers((now) => [now.at(-1)!, { key: (count.current += 1), src: null }]);
      },
    );
    return () => {
      live = false;
    };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {layers.map((layer, at) => (
        <span key={layer.key} className="art-layer" data-top={at === layers.length - 1} data-first={layer.key <= 1 || undefined}>
          {layer.src ? <img src={layer.src} alt="" draggable={false} crossOrigin="anonymous" /> : <Icon name="nuvo-mark" size={26} />}
        </span>
      ))}
    </>
  );
}
