import { useEffect, useRef } from "react";
import { LAYER_ATTRIBUTE } from "../../components/layers";
import { lyricsCommands } from "../../ports/lyrics";
import { playerEngine } from "../../ports/player";

export interface StudioKeys {
  undo(): void;
  redo(): void;
  markIn(): void;
  markOut(): void;
}

const STEP_MS = 1_000;
const BIG_STEP_MS = 5_000;

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function useStudioKeys(keys: StudioKeys): void {
  const latest = useRef(keys);
  useEffect(() => {
    latest.current = keys;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // an open popover or menu keeps the keyboard
      if (event.defaultPrevented || typing(event.target) || document.querySelector(`[${LAYER_ATTRIBUTE}]`)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) latest.current.redo();
        else latest.current.undo();
        return;
      }
      if (mod || event.altKey) return;
      if (key === " ") {
        event.preventDefault();
        void playerEngine.togglePlayPause();
      } else if (key === "arrowleft" || key === "arrowright") {
        event.preventDefault();
        const step = (event.shiftKey ? BIG_STEP_MS : STEP_MS) * (key === "arrowleft" ? -1 : 1);
        void playerEngine.seek(Math.max(0, Math.round(lyricsCommands.clock().atMs + step)));
      } else if (key === "i") latest.current.markIn();
      else if (key === "o") latest.current.markOut();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
