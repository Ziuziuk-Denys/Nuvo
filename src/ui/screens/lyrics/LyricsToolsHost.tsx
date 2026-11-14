import type { JSX } from "react";
import { LyricsEditor } from "./LyricsEditor";
import { useLyricsTools } from "./lyricsTools";
import { TranslationSheet } from "./TranslationSheet";

export function LyricsToolsHost(): JSX.Element | null {
  const { track, tool, draft, close } = useLyricsTools();
  if (!track) return null;
  return (
    <>
      <LyricsEditor open={tool === "edit"} track={track} draft={draft} onClose={close} />
      <TranslationSheet open={tool === "translate"} track={track} onClose={close} />
    </>
  );
}
