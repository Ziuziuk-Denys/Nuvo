import type { Line } from "@/lyrics";
import { loadCover } from "./cover";
import { sharedNow, type FromStage, type ToStage } from "./stageProtocol";
import type { Aspect, Template } from "./template/schema";

export interface LiveFrame {
  wave: Float32Array;
  sampleRate: number;
}

export interface LiveDeps {
  subscribe(listener: (frame: LiveFrame) => void): () => void;
  clock(): { atMs: number; playing: boolean };
  decoded?(): { pcm: Float32Array; sampleRate: number } | null;
}

export interface Media {
  url: string;
  kind: "image" | "video";
}

export interface Live {
  setTemplate(template: Template, aspect: Aspect): void;
  setCover(url: string): void;
  setLyrics(lines: Line[]): void;
  setMedia(media: Media | null): void;
  setMirror(target: HTMLCanvasElement | null): void;
  onFoot(listener: ((rgb: [number, number, number]) => void) | null): void;
  onTone(listener: ((light: boolean) => void) | null): void;
  onLuma(listener: ((cells: Uint8Array) => void) | null): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

type VideoWithFrames = HTMLVideoElement & { requestVideoFrameCallback?(callback: () => void): number };

const handedOver = new WeakSet<HTMLCanvasElement>();

export function createLive(canvas: HTMLCanvasElement, deps: LiveDeps): Live | null {
  if (typeof canvas.transferControlToOffscreen !== "function" || handedOver.has(canvas)) return null;
  const worker = new Worker(new URL("./stage.worker.ts", import.meta.url), { type: "module" });
  const post = (message: ToStage, transfer: Transferable[] = []) => worker.postMessage(message, transfer);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const offscreen = canvas.transferControlToOffscreen();
  handedOver.add(canvas);
  post({ type: "init", canvas: offscreen, reduced: motion.matches }, [offscreen]);

  let footListener: ((rgb: [number, number, number]) => void) | null = null;
  let toneListener: ((light: boolean) => void) | null = null;
  let lumaListener: ((cells: Uint8Array) => void) | null = null;
  worker.onerror = (event) => console.error("[visual] the stage worker failed:", event.message);
  worker.onmessage = (event: MessageEvent<FromStage>) => {
    if (event.data.type === "foot") footListener?.(event.data.rgb);
    else if (event.data.type === "tone") toneListener?.(event.data.light);
    else lumaListener?.(event.data.cells);
  };
  const onMotion = () => post({ type: "motion", reduced: motion.matches });
  motion.addEventListener("change", onMotion);

  let coverUrl = "";
  let mediaUrl = "";
  let video: VideoWithFrames | null = null;
  let sentSong: { pcm: Float32Array; sampleRate: number } | null = null;
  let frameId: number | null = null;

  // each page frame sends the position; the worker runs on from it if the page falls behind
  const tick = () => {
    frameId = requestAnimationFrame(tick);
    const { atMs, playing } = deps.clock();
    post({ type: "clock", atMs, playing, stamp: sharedNow() });
    const decoded = deps.decoded?.() ?? null;
    if (decoded !== sentSong) {
      sentSong = decoded;
      // a copy, because the studio and export keep reading the page's own decoded song
      const pcm = decoded ? decoded.pcm.slice() : null;
      post({ type: "song", pcm, sampleRate: decoded?.sampleRate ?? 0 }, pcm ? [pcm.buffer] : []);
    }
    if (video) {
      if (playing && video.paused) void video.play().catch(() => undefined);
      else if (!playing && !video.paused) video.pause();
    }
  };
  frameId = requestAnimationFrame(tick);

  const unsubscribe = deps.subscribe((frame) => {
    if (sentSong) return;
    const wave = frame.wave.slice();
    post({ type: "tap", wave, sampleRate: frame.sampleRate }, [wave.buffer]);
  });

  // every decoded video frame goes over once, as a VideoFrame the worker uploads and closes
  const sendVideoFrames = (element: VideoWithFrames) => {
    const next = () => {
      if (video !== element) return;
      if (element.readyState >= 2) {
        const frame = new VideoFrame(element);
        post({ type: "image", source: frame, width: element.videoWidth, height: element.videoHeight }, [frame]);
      }
      element.requestVideoFrameCallback?.(next);
    };
    element.requestVideoFrameCallback?.(next);
  };

  return {
    setTemplate(template, aspect) {
      post({ type: "template", template, aspect });
    },
    setCover(url) {
      if (!url || url === coverUrl) return;
      coverUrl = url;
      loadCover(url).then(
        ({ bitmap, palette }) => {
          if (url === coverUrl) post({ type: "cover", bitmap, palette }, [bitmap]);
          else bitmap.close();
        },
        () => undefined,
      );
    },
    setLyrics(lines) {
      post({ type: "lyrics", lines });
    },
    setMedia(media) {
      if ((media?.url ?? "") === mediaUrl) return;
      mediaUrl = media?.url ?? "";
      video?.pause();
      video = null;
      if (!media) return post({ type: "image", source: null, width: 0, height: 0 });
      if (media.kind === "video") {
        video = Object.assign(document.createElement("video") as VideoWithFrames, { src: media.url, muted: true, loop: true, playsInline: true });
        sendVideoFrames(video);
        return;
      }
      const image = new Image();
      image.src = media.url;
      image
        .decode()
        .then(() => createImageBitmap(image))
        .then(
          (bitmap) => {
            if (mediaUrl === media.url) post({ type: "image", source: bitmap, width: bitmap.width, height: bitmap.height }, [bitmap]);
            else bitmap.close();
          },
          () => undefined,
        );
    },
    setMirror(target) {
      if (!target || handedOver.has(target)) return;
      handedOver.add(target);
      const mirror = target.transferControlToOffscreen();
      post({ type: "mirror", canvas: mirror }, [mirror]);
    },
    onFoot(listener) {
      footListener = listener;
    },
    onTone(listener) {
      toneListener = listener;
    },
    onLuma(listener) {
      lumaListener = listener;
    },
    resize(width, height) {
      post({ type: "size", width, height });
    },
    dispose() {
      if (frameId !== null) cancelAnimationFrame(frameId);
      unsubscribe();
      motion.removeEventListener("change", onMotion);
      video?.pause();
      video = null;
      post({ type: "dispose" });
      worker.terminate();
    },
  };
}
