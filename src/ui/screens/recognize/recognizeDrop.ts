/** A sound or video file dropped anywhere in the window goes to Recognize, unless the spot it fell on took it. */
import { useEffect, useRef } from "react";
import { create } from "zustand";

export const useDroppedFile = create<{ file: File | null; take(): File | null }>((set, get) => ({
  file: null,
  take() {
    const file = get().file;
    if (file) set({ file: null });
    return file;
  },
}));

export function isRecognizable(file: { type: string }): boolean {
  return /^(audio|video)\//.test(file.type);
}

const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") === true;

/** Listens on the window; `open` shows the Recognize screen, which takes the file from `useDroppedFile`. */
export function useRecognizeDrop(open: () => void): void {
  const latest = useRef(open);
  useEffect(() => {
    latest.current = open;
  });
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!event.defaultPrevented && carriesFiles(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (event.defaultPrevented || !carriesFiles(event)) return;
      // the window never opens a dropped file as a page
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (!file || !isRecognizable(file)) return;
      useDroppedFile.setState({ file });
      latest.current();
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
}
