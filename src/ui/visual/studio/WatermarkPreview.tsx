import { useEffect, useRef, type JSX } from "react";
import { drawWatermark } from "../../ports/visual";
import styles from "./Player.module.css";

export function WatermarkPreview(): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const draw = () => {
      const width = Math.round(element.clientWidth * devicePixelRatio);
      const height = Math.round(element.clientHeight * devicePixelRatio);
      if (!width || !height) return;
      element.width = width;
      element.height = height;
      const ctx = element.getContext("2d");
      if (ctx) drawWatermark(ctx, width, height);
    };
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    void document.fonts.ready.then(draw);
    document.fonts.addEventListener("loadingdone", draw);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", draw);
    };
  }, []);

  return <canvas ref={canvas} className={styles.watermark} aria-hidden="true" />;
}
