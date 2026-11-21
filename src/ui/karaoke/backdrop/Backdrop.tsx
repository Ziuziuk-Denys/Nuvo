import { useEffect, useRef, useState, type JSX } from "react";
import { sizedCoverUrl } from "@/ui/components/coverUrl";
import { DEFAULT_COVER_COLORS, colorsFor, isWindowVisible, onWindowVisibilityChange } from "@/ui/ports/karaokeBackdrop";
import { RENDER_SCALE, shouldAnimate, stillBackground } from "./flow";
import { useEffectsStore, useReducedEffects } from "../../effects";
import { createFlowRenderer, type FlowRenderer } from "./shader";
import styles from "./Backdrop.module.css";

const COVER_FADE_MS = 800;
const COVER_PX = 64;
const KEY_MS = 2000;

interface BackdropProps {
  cover: string;
  open: boolean;
  drift?: boolean;
  overlay?: string;
  uniforms?: Record<string, readonly number[]>;
}

export function Backdrop({ cover, open, drift = false, overlay, uniforms }: BackdropProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef<Array<HTMLCanvasElement | null>>([]);
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
    const first = createFlowRenderer(canvas, overlay);
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
      const next = createFlowRenderer(canvas, overlay);
      if (!next) return;
      rendererRef.current?.dispose();
      rendererRef.current = next;
      size();
      setWebgl(true);
    };
    function size() {
      const renderer = rendererRef.current;
      if (!renderer) return;
      const scale = (overlay ? Math.min(devicePixelRatio, 1) : devicePixelRatio) * RENDER_SCALE;
      renderer.resize(canvas!.clientWidth * scale, canvas!.clientHeight * scale);
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
  }, [overlay]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !uniforms) return;
    for (const [name, values] of Object.entries(uniforms)) renderer.uniform(name, values);
    renderer.draw(performance.now());
  }, [uniforms, webgl]);

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
        renderer.hold(true);
        renderer.settle();
        renderer.draw(performance.now());
      }
      return;
    }
    rendererRef.current?.hold(false);
    const root = rootRef.current!;
    delete root.dataset.keys;
    root.dataset.moving = "";
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
    return () => {
      cancelAnimationFrame(frame);
      delete root.dataset.moving;
    };
  }, [animate, showCanvas, fps]);

  const drifting = Boolean(overlay) && drift && showCanvas && !animate && visible && !reduced;
  useEffect(() => {
    if (!drifting) return;
    const root = rootRef.current!;
    const canvas = canvasRef.current!;
    const keys = keysRef.current.filter((key): key is HTMLCanvasElement => key !== null);
    rendererRef.current?.hold(false);
    let jump = !("keys" in root.dataset);
    let next = Number(keys[0].style.opacity || 0) > Number(keys[1].style.opacity || 0) ? 1 : 0;
    // each keyframe is drawn once; the compositor blends the two layers and moves them between keyframes
    const keyframe = () => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      renderer.draw(performance.now());
      const key = keys[next];
      if (key.width !== canvas.width || key.height !== canvas.height) Object.assign(key, { width: canvas.width, height: canvas.height });
      const pen = key.getContext("2d");
      pen?.clearRect(0, 0, key.width, key.height);
      pen?.drawImage(canvas, 0, 0);
      for (const each of keys) each.style.transition = jump ? "none" : `opacity ${KEY_MS}ms linear`;
      key.style.opacity = "1";
      keys[1 - next].style.opacity = "0";
      root.dataset.keys = "";
      jump = false;
      next = 1 - next;
    };
    keyframe();
    root.dataset.moving = "";
    const timer = window.setInterval(keyframe, KEY_MS);
    return () => {
      window.clearInterval(timer);
      delete root.dataset.moving;
      for (const each of keys) {
        each.style.opacity = getComputedStyle(each).opacity;
        each.style.transition = "none";
      }
    };
  }, [drifting]);

  return (
    <div ref={rootRef} className={styles.root} data-overlay={overlay ? "" : undefined} aria-hidden="true">
      {showCanvas ? null : <div data-still="" className={styles.layer} style={{ background: stillBackground(colors) }} />}
      <div className={styles.motion}>
        <canvas ref={canvasRef} className={styles.layer} data-gl="" data-hidden={showCanvas ? undefined : ""} />
        {overlay
          ? [0, 1].map((index) => (
              <canvas
                key={index}
                ref={(node) => {
                  keysRef.current[index] = node;
                }}
                className={`${styles.layer} ${styles.key}`}
              />
            ))
          : null}
      </div>
      {overlay ? null : <div className={styles.shade} />}
    </div>
  );
}
