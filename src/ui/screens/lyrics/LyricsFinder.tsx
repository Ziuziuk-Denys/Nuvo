import { useEffect, useRef, useState, type JSX } from "react";
import { TextField } from "../../components/TextField";
import { useTranslation } from "../../ports/i18n";
import { editableText, formatDuration, searchLyrics, type FoundVersion, type LyricsTrack } from "../../ports/lyricsTools";
import styles from "./Lyrics.module.css";

const SAME_LENGTH_MS = 2000;
const MAX_QUERY_CHARS = 200;

interface Search {
  status: "loading" | "done" | "error";
  results: FoundVersion[];
  partial: boolean;
}

const firstArtist = (artists: string) => (artists.split(",")[0] ?? "").trim();

const KIND: Record<string, string> = {
  word_level: "ui.lyrics.version_word",
  syllable_level: "ui.lyrics.version_word",
  line_level: "ui.lyrics.version_synced",
};

export function useLyricsFinder(track: LyricsTrack) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [search, setSearch] = useState<Search | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = (query: { title: string; artist: string }) => {
    controller.current?.abort();
    if (query.title.trim() === "" || query.artist.trim() === "") return;
    const current = new AbortController();
    controller.current = current;
    setSearch((last) => ({ status: "loading", results: last?.results ?? [], partial: false }));
    void searchLyrics({ title: query.title.trim(), artist: query.artist.trim(), durationMs: track.durationMs }, current.signal).then(
      (found) => {
        if (!current.signal.aborted) setSearch({ status: "done", results: found.results, partial: found.failed.length > 0 });
      },
      () => {
        if (!current.signal.aborted) setSearch({ status: "error", results: [], partial: false });
      },
    );
  };

  return {
    title,
    artist,
    search,
    setTitle,
    setArtist,
    ready: title.trim() !== "" && artist.trim() !== "" && search?.status !== "loading",
    start: () => {
      const query = { title: track.title, artist: firstArtist(track.artists) };
      setTitle(query.title);
      setArtist(query.artist);
      run(query);
    },
    run: () => run({ title, artist }),
    stop: () => controller.current?.abort(),
  };
}

export type LyricsFinderState = ReturnType<typeof useLyricsFinder>;

interface LyricsFinderProps {
  finder: LyricsFinderState;
  track: LyricsTrack;
  onPick(text: string): void;
}

export function LyricsFinder({ finder, track, onPick }: LyricsFinderProps): JSX.Element {
  const { t } = useTranslation();
  const { search } = finder;
  const sameLength = (version: FoundVersion) => {
    const length = version.matchedTrack?.durationMs ?? 0;
    return length > 0 && track.durationMs > 0 && Math.abs(length - track.durationMs) <= SAME_LENGTH_MS;
  };
  const results = [...(search?.results ?? [])].sort((a, b) => Number(sameLength(b)) - Number(sameLength(a)));

  return (
    <>
      <div className={styles.fields}>
        <TextField
          label={t("ui.lyrics.find_title")}
          placeholder={t("ui.lyrics.find_title")}
          value={finder.title}
          onChange={finder.setTitle}
          onSubmit={finder.run}
          maxLength={MAX_QUERY_CHARS}
          autoFocus
        />
        <TextField
          label={t("ui.lyrics.find_artist")}
          placeholder={t("ui.lyrics.find_artist")}
          value={finder.artist}
          onChange={finder.setArtist}
          onSubmit={finder.run}
          maxLength={MAX_QUERY_CHARS}
        />
      </div>
      {results.length > 0 ? (
        <ul className={styles.results} aria-label={t("ui.lyrics.find_results")} aria-busy={search?.status === "loading"}>
          {results.map((version, at) => {
            const length = version.matchedTrack?.durationMs ?? 0;
            const meta = [length > 0 ? formatDuration(length) : null, t(KIND[version.syncLevel] ?? "ui.lyrics.version_plain")].filter(Boolean).join(" · ");
            return (
              <li key={at}>
                <button type="button" className={styles.result} onClick={() => onPick(editableText(version.lyrics))}>
                  <span className={styles.resultName}>
                    {version.matchedTrack?.title ?? finder.title}
                    <span className={styles.resultArtist}> · {(version.matchedTrack?.artists ?? [finder.artist]).join(", ")}</span>
                  </span>
                  <span className={styles.resultMeta}>
                    {meta}
                    {sameLength(version) ? <span className={styles.fits}> · {t("ui.lyrics.find_fits")}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className={styles.note} role="status">
        {search === null
          ? null
          : search.status === "loading"
            ? t("ui.lyrics.find_searching")
            : search.status === "error"
              ? t("ui.lyrics.find_failed")
              : results.length === 0
                ? t("ui.lyrics.find_none")
                : t(search.partial ? "ui.lyrics.find_partial" : "ui.lyrics.find_hint")}
      </p>
    </>
  );
}
