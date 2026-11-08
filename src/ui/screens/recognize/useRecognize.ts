import { useCallback, useEffect, useRef, useState } from "react";
import { advance, findSong, forgetRecognized, grantFile, IDLE, listen, listening, recognizeHistory, startFailure } from "../../ports/recognize";
import type { RecognizedEntry, RecognizedSong, RecognizeInput, RecognizeSource, Session } from "../../ports/recognize";
import type { Track } from "../../ports/player";

const SOURCES: Record<Exclude<RecognizeInput, "file" | "link">, RecognizeSource> = { microphone: { microphone: true }, system: { system: true } };

/** One job at a time. Leaving the screen stops it, and the daemon stops its child processes with it. */
export function useRecognize() {
  const [session, setSession] = useState<Session>(IDLE);
  const job = useRef<AbortController | null>(null);
  const last = useRef<{ input: RecognizeInput; source: RecognizeSource } | null>(null);

  const stop = useCallback(() => {
    job.current?.abort();
    job.current = null;
    setSession(IDLE);
  }, []);

  useEffect(() => () => job.current?.abort(), []);

  const run = useCallback(async (input: RecognizeInput, source: RecognizeSource, part: 0 | 1) => {
    job.current?.abort();
    const controller = new AbortController();
    job.current = controller;
    last.current = { input, source };
    setSession(listening(input));
    try {
      await listen(source, part, controller.signal, (event) => {
        if (!controller.signal.aborted) setSession((current) => advance(current, event));
      });
    } catch (caught) {
      if (!controller.signal.aborted) setSession({ phase: "failed", input, code: startFailure(caught) });
    }
  }, []);

  const start = useCallback((input: Exclude<RecognizeInput, "file" | "link">) => void run(input, SOURCES[input], 0), [run]);

  /** A video or post link: the daemon fetches a short window of its audio through yt-dlp. */
  const startLink = useCallback((url: string) => void run("link", { url: url.trim() }, 0), [run]);

  const startFile = useCallback(
    async (file: File) => {
      const id = await grantFile(file);
      if (id) await run("file", { file: id }, 0);
      else setSession({ phase: "failed", input: "file", code: "unavailable" });
    },
    [run],
  );

  /** "Try another part": the windows the first run did not send. */
  const anotherPart = useCallback(() => {
    if (last.current) void run(last.current.input, last.current.source, 1);
  }, [run]);

  return { session, start, startFile, startLink, anotherPart, stop };
}

/** The saved recognitions, newest first; a new result reloads them. */
export function useRecognizeHistory(reloadKey: string | null) {
  const [items, setItems] = useState<RecognizedEntry[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    recognizeHistory(controller.signal).then(setItems, () => undefined);
    return () => controller.abort();
  }, [reloadKey]);

  const forget = useCallback((id: string) => {
    setItems((list) => list.filter((item) => item.id !== id));
    void forgetRecognized(id).catch(() => undefined);
  }, []);

  return { items, forget };
}

/** The catalog's copy of the song on the card: undefined while looking, null when there is none. */
export function useCatalogSong(song: RecognizedSong | null): Track | null | undefined {
  const [found, setFound] = useState<{ of: RecognizedSong; track: Track | null } | null>(null);

  useEffect(() => {
    if (!song) return;
    const controller = new AbortController();
    void findSong(song, controller.signal).then((track) => {
      if (!controller.signal.aborted) setFound({ of: song, track });
    });
    return () => controller.abort();
  }, [song]);

  return found?.of === song ? found.track : undefined;
}
