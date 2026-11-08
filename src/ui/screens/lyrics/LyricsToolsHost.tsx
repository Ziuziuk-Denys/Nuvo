import type { JSX } from "react";
import { LyricsEditor } from "./LyricsEditor";
import { useLyricsTools } from "./lyricsTools";
import { TranslationSheet } from "./TranslationSheet";

/** One place for the lyrics sheets, mounted once in the shell. */
export function LyricsToolsHost(): JSX.Element | null {
  const { track, tool, close } = useLyricsTools();
  if (!track) return null;
  return (
    <>
      <LyricsEditor open={tool === "edit"} track={track} onClose={close} />
      <TranslationSheet open={tool === "translate"} track={track} onClose={close} />
    </>
  );
}
