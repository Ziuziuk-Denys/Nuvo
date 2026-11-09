import { useEffect, useRef, useState, type JSX } from "react";
import { sizedCoverUrl } from "@/ui/components/coverUrl";
import { DEFAULT_COVER_COLORS, colorsFor, isWindowVisible, onWindowVisibilityChange } from "@/ui/ports/karaokeBackdrop";
import { RENDER_SCALE, shouldAnimate, stillBackground } from "./flow";
import { useEffectsStore, useReducedEffects } from "../../effects";
import { createFlowRenderer, type FlowRenderer } from "./shader";
import styles from "./Backdrop.module.css";

const COVER_FADE_MS = 800;
const COVER_PX = 64;

export function Backdrop({ cover, open }: { cover: string; open: boolean }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FlowRenderer | null>(null);
  const [webgl, setWebgl] = useState(true);
  const [coverColors, setCoverColors] = useState({ cover: "", colors: DEFAULT_COVER_COLORS });
  const [visible, setVisible] = useState(isWindowVisible);
  const [shownCover, setShownCover] = useState("");
  const reduced = useReducedEffects();
  const fps = useEffectsStore((state) => state.fps);
  const animateRef = useRef(false);

  useEffect(() => onWindowVisibilityChange(setVisible), []);

  useEffect(() => {
    let live = true;
    if (cover) {
      colorsFor(cover).then(
        (colors) => {
          if (live) setCoverColors({ cover, colors });
        },
        () => undefined,
      );
    }
    return () => {
      live = false;
    };
  }, [cover]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const first = createFlowRenderer(canvas);
    if (!first) {
      setWebgl(false);
      return;
    }
    rendererRef.current = first;
    const lost = (event: Event) => {
      // the still field covers the gap until the browser gives the context back
      event.preventDefault();
      rendererRef.current = null;
      setWebgl(false);
    };
    const restored = () => {
      // every GPU resource is gone: build the renderer again, the cover effect then reloads and redraws the cover
      const next = createFlowRenderer(canvas);
      if (!next) return;
      rendererRef.current?.dispose();
      rendererRef.current = next;
      size();
      setWebgl(true);
    };
    function size() {
      const renderer = rendererRef.current;
      if (!renderer) return;
      renderer.resize(canvas!.clientWidth * devicePixelRatio * RENDER_SCALE, canvas!.clientHeight * devicePixelRatio * RENDER_SCALE);
      renderer.draw(performance.now());
    }
    size();
    const observer = new ResizeObserver(size);
    observer.observe(canvas);
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    return () => {
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!webgl || !cover) return;
    let live = true;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = sizedCoverUrl(cover, COVER_PX, 1);
    image.decode().then(
      () => {
        const renderer = rendererRef.current;
        if (!live || !renderer) return;
        // a loop that is not running would draw a fade once and leave the old cover on screen
        const shown = renderer.setCover(image, animateRef.current ? COVER_FADE_MS : 0);
        renderer.draw(performance.now());
        setShownCover(shown === false ? "" : cover);
      },
      () => {
        if (live) setShownCover("");
      },
    );
    return () => {
      live = false;
    };
  }, [cover, webgl]);

  const colors = coverColors.cover === cover ? coverColors.colors : DEFAULT_COVER_COLORS;
  // while a new cover loads the old one stays, so a track change never flashes the still field
  const showCanvas = webgl && cover !== "" && shownCover !== "";
  const animate = showCanvas && shouldAnimate(open, visible, reduced);
  animateRef.current = animate;
  useEffect(() => {
    if (!animate) {
      const renderer = rendererRef.current;
      if (renderer && showCanvas) {
        renderer.settle();
        renderer.draw(performance.now());
      }
      return;
    }
    let frame = 0;
    let last = -Infinity;
    const tick = (now: number) => {
      // a little slack, so a 60 Hz display does not drop to 20 frames a second
      if (now - last >= 1000 / fps - 2) {
        last = now;
        rendererRef.current?.draw(now);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, showCanvas, fps]);

  return (
    <div className={styles.root} aria-hidden="true">
      {showCanvas ? null : <div data-still="" className={styles.layer} style={{ background: stillBackground(colors) }} />}
      <canvas ref={canvasRef} className={styles.layer} data-hidden={showCanvas ? undefined : ""} />
      <div className={styles.shade} />
    </div>
  );
}
