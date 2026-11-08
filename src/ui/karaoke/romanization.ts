import { create } from "zustand";
import { romanizeKana, romanizerFor, useLyrics } from "../ports/lyrics";

const KEY = "nuvo.lyricsRomanized";

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export const useRomanizedChoice = create<{ on: boolean; toggle(): void }>((set, get) => ({
  on: stored(),
  toggle() {
    const on = !get().on;
    set({ on });
    try {
      localStorage.setItem(KEY, on ? "1" : "0");
    } catch {
      // the choice still holds for this run
    }
  },
}));

/**
 * Romanized lyrics: `available` when the song is Korean, Chinese or Japanese, `romanize` set while the
 * choice is on. `kanaOnly` for Japanese, where kanji stays as written and the toggle says so.
 */
export function useRomanization(): { available: boolean; kanaOnly: boolean; on: boolean; toggle(): void; romanize: ((text: string) => string) | null } {
  const lines = useLyrics((state) => state.lines);
  const plainText = useLyrics((state) => state.plainText);
  const { on, toggle } = useRomanizedChoice();
  const texts = lines && lines.length > 0 ? lines.map((line) => line.text) : (plainText ?? "").split("\n");
  const romanizer = romanizerFor(texts);
  return { available: romanizer !== null, kanaOnly: romanizer === romanizeKana, on, toggle, romanize: on ? romanizer : null };
}
