import { useEffect, useRef, useState } from "react";
import { Icon } from "@/ui/icons/Icon";

interface Layer {
  key: number;
  src: string | null;
}

export function Art({ src }: { src: string | null }) {
  const [layers, setLayers] = useState<Layer[]>([{ key: 0, src: null }]);
  const count = useRef(0);

  useEffect(() => {
    let live = true;
    const show = (shown: string | null) => {
      if (!live) return;
      count.current += 1;
      const layer = { key: count.current, src: shown };
      setLayers((now) => (now.at(-1)?.src === shown ? now : [now.at(-1)!, layer]));
    };
    if (!src) {
      show(null);
      return;
    }
    const image = new Image();
    image.src = src;
    image.decode().then(
      () => show(src),
      () => show(null),
    );
    return () => {
      live = false;
    };
  }, [src]);

  return (
    <div className="art">
      {layers.map((layer, at) => (
        <span key={layer.key} className="art-layer" data-in={(at > 0 && layer.key > 1) || undefined}>
          {layer.src ? <img src={layer.src} alt="" draggable={false} /> : <Icon name="nuvo-mark" size={26} />}
        </span>
      ))}
    </div>
  );
}
