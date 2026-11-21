import { useEffect, useRef } from "react";
import { create } from "zustand";
import { isMusicFile } from "../local/addMusic";

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

function musicIn(transfer: DataTransfer): File[] {
  const items = [...(transfer.items ?? [])];
  return [...transfer.files].filter((file, index) => isMusicFile(file.name) || items[index]?.webkitGetAsEntry?.()?.isDirectory === true);
}

export function useWindowDrop(open: () => void, addMusic: (files: File[]) => void): void {
  const latest = useRef({ open, addMusic });
  useEffect(() => {
    latest.current = { open, addMusic };
  });
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!event.defaultPrevented && carriesFiles(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (event.defaultPrevented || !carriesFiles(event)) return;
      // the window never opens a dropped file as a page
      event.preventDefault();
      const music = musicIn(event.dataTransfer!);
      if (music.length > 0) return latest.current.addMusic(music);
      const file = event.dataTransfer?.files[0];
      if (!file || !isRecognizable(file)) return;
      useDroppedFile.setState({ file });
      latest.current.open();
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
}
