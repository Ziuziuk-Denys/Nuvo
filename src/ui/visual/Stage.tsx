import { useEffect, useRef, type JSX } from "react";
import type { Line } from "../ports/lyrics";
import { useVisualQuality } from "../effects";
import { createLiveStage, mediaFor, type Aspect, type Live, type Media, type Template } from "../ports/visual";

interface StageProps {
  template: Template;
  aspect: Aspect;
  coverUrl: string;
  lines: Line[];
  media?: Media | null;
  onTone?: (light: boolean) => void;
  onLuma?: (cells: Uint8Array) => void;
  clock?: () => { atMs: number; playing: boolean };
  className?: string;
}

export function Stage({ template, aspect, coverUrl, lines, media: own = null, onTone, onLuma, clock, className }: StageProps): JSX.Element {
  const media = mediaFor(template, own);
  const host = useRef<HTMLDivElement>(null);
  const liveRef = useRef<Live | null>(null);
  const light = useVisualQuality() === "performance";
  const latest = useRef({ template, aspect, coverUrl, lines, media, onTone, onLuma, light });
  useEffect(() => {
    latest.current = { template, aspect, coverUrl, lines, media, onTone, onLuma, light };
  });

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    // a canvas can be handed to the stage worker only once, so each mount makes its own
    const canvas = Object.assign(document.createElement("canvas"), { className: className ?? "" });
    canvas.setAttribute("aria-hidden", "true");
    element.append(canvas);
    const live = createLiveStage(canvas, clock);
    liveRef.current = live;
    const now = latest.current;
    live?.setTemplate(now.template, now.aspect);
    live?.setCover(now.coverUrl);
    live?.setLyrics(now.lines);
    live?.setMedia(now.media);
    live?.onTone(now.onTone ?? null);
    live?.onLuma(now.onLuma ?? null);
    live?.setLight(now.light);
    const size = () => live?.resize(canvas.clientWidth * devicePixelRatio, canvas.clientHeight * devicePixelRatio);
    size();
    const observer = new ResizeObserver(size);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      live?.dispose();
      liveRef.current = null;
      canvas.remove();
    };
  }, [className, clock]);

  useEffect(() => liveRef.current?.setTemplate(template, aspect), [template, aspect]);
  useEffect(() => liveRef.current?.setCover(coverUrl), [coverUrl]);
  useEffect(() => liveRef.current?.setLyrics(lines), [lines]);
  useEffect(() => liveRef.current?.setMedia(media), [media]);
  useEffect(() => liveRef.current?.onTone(onTone ?? null), [onTone]);
  useEffect(() => liveRef.current?.onLuma(onLuma ?? null), [onLuma]);
  useEffect(() => liveRef.current?.setLight(light), [light]);

  return <div ref={host} style={{ display: "contents" }} />;
}
