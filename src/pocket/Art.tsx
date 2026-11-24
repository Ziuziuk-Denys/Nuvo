import { useEffect, useRef, useState } from "react";
import { Icon } from "@/ui/icons/Icon";
import { lampColor } from "./lamp";

const SAMPLE = 24;

function colorOf(image: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "#ffffff";
  try {
    context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
    return lampColor(context.getImageData(0, 0, SAMPLE, SAMPLE).data);
  } catch {
    return "#ffffff";
  }
}

interface Layer {
  key: number;
  src: string | null;
}

export function Art({ src, onLight }: { src: string | null; onLight?: (color: string) => void }) {
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
        onLight?.(colorOf(image));
        show();
      },
      () => {
        if (!live) return;
        onLight?.("#ffffff");
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
