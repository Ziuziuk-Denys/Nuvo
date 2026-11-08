import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { settingsStorage } from "../ports/tour";
import { CHAPTER_IDS, stepCount, type ChapterId } from "./chapters";

/*
  The tour over the real window. poster - the card before (or between) the chapters; chapter - one step on screen,
  one outline and one callout; brief - the short version for users who skip.
  Saved with the settings: whether the tour is still on, where it stopped, and the chapters left out
  because their part of the window was not there yet. Everything else lives for one run only
*/
export type TourPhase = "off" | "poster" | "chapter" | "brief";
export type PosterKind = "start" | "resume" | "more";
/** new - never offered (an existing profile); on - running or cut off by closing the window; later - the user chose Finish later */
export type TourStatus = "new" | "on" | "later" | "done";

export const TOUR_KEY = "nuvo_tour_v1";

interface Saved {
  status: TourStatus;
  at: { chapter: ChapterId; step: number } | null;
  missed: ChapterId[];
}

interface TourState extends Saved {
  phase: TourPhase;
  poster: PosterKind;
  chapterIds: ChapterId[];
  chapter: number;
  step: number;
  /** The way the user last moved, so a missing step is passed over in that direction */
  dir: 1 | -1;
  /** The read gates apply: the first run and its resumption, never a revisit */
  gated: boolean;
  /** Chapters whose gate already ran out */
  read: ChapterId[];
  briefRead: boolean;
  /** The skip prompt is open over the current step */
  prompt: boolean;
  /** The layer steps aside while a sheet opened from the start step is up */
  away: boolean;
  /** Music was brought in or favourites were sent on the start step */
  started: boolean;

  start: () => void;
  restore: () => void;
  offerMore: () => void;
  watch: () => void;
  /** From the short version: the tour from its first chapter */
  rewatch: () => void;
  /** From Settings or the palette: every chapter from the first, without the first run's read gates */
  replay: () => void;
  decline: () => void;
  next: () => void;
  back: () => void;
  skipChapter: () => void;
  missing: () => void;
  missingChapter: () => void;
  openPrompt: () => void;
  closePrompt: () => void;
  later: () => void;
  toBrief: () => void;
  finish: () => void;
  markRead: () => void;
  markBriefRead: () => void;
  setAway: (away: boolean) => void;
  markStarted: () => void;
}

const at = (chapterIds: ChapterId[], chapter: number, step: number) => ({ chapter: chapterIds[chapter], step });

export const useTour = create<TourState>()(
  persist(
    (set, get) => {
      /* Moves to a place in the run and saves it, so a closed window resumes there */
      const go = (chapter: number, step: number, dir: 1 | -1) =>
        set((state) => ({ chapter, step, dir, prompt: false, at: at(state.chapterIds, chapter, step) }));

      const nextChapter = () => {
        const { chapter, chapterIds } = get();
        if (chapter + 1 < chapterIds.length) go(chapter + 1, 0, 1);
        else get().finish();
      };

      const back = () => {
        const { chapter, step, chapterIds } = get();
        if (step > 0) go(chapter, step - 1, -1);
        else if (chapter > 0) go(chapter - 1, stepCount(chapterIds[chapter - 1]) - 1, -1);
        else set({ dir: -1 });
      };

      return {
        status: "new",
        at: null,
        missed: [],
        phase: "off",
        poster: "start",
        chapterIds: [],
        chapter: 0,
        step: 0,
        dir: 1,
        gated: false,
        read: [],
        briefRead: false,
        prompt: false,
        away: false,
        started: false,

        start: () =>
          set({
            phase: "poster",
            poster: "start",
            status: "on",
            at: null,
            missed: [],
            gated: true,
            read: [],
            briefRead: false,
            prompt: false,
            away: false,
            started: false,
          }),

        restore: () => {
          const { status, at: place, phase } = get();
          // closed on the start step: no chapter yet, so the start step comes back
          if (phase === "off" && (status === "on" || status === "later"))
            set({ phase: "poster", poster: place ? "resume" : "start", gated: true, read: [], briefRead: false });
        },

        offerMore: () => {
          const { status, missed, phase } = get();
          if (status === "done" && missed.length > 0 && phase === "off") set({ phase: "poster", poster: "more" });
        },

        watch: () => {
          const { poster, at: place, missed } = get();
          if (poster === "more") {
            set({
              phase: "chapter",
              chapterIds: missed,
              missed: [],
              status: "on",
              gated: false,
              chapter: 0,
              step: 0,
              dir: 1,
              prompt: false,
              at: at(missed, 0, 0),
            });
            return;
          }
          const found = place ? CHAPTER_IDS.indexOf(place.chapter) : -1;
          const chapter = Math.max(0, found);
          const step = place && found >= 0 ? Math.min(place.step, stepCount(place.chapter) - 1) : 0;
          set({ phase: "chapter", chapterIds: CHAPTER_IDS, status: "on", chapter, step, dir: 1, prompt: false, at: at(CHAPTER_IDS, chapter, step) });
        },

        rewatch: () => {
          set({ poster: "start", at: null });
          get().watch();
        },

        replay: () => {
          set({ gated: false, missed: [], prompt: false, away: false });
          get().rewatch();
        },

        decline: () => set({ phase: "off", missed: [] }),

        next: () => {
          const { chapter, step, chapterIds } = get();
          if (step + 1 < stepCount(chapterIds[chapter])) go(chapter, step + 1, 1);
          else nextChapter();
        },

        back,

        skipChapter: nextChapter,

        missing: () => {
          const { dir, chapter, step } = get();
          if (dir === -1 && (chapter > 0 || step > 0)) back();
          else get().next();
        },

        missingChapter: () => {
          const { dir, chapter, chapterIds, missed } = get();
          const id = chapterIds[chapter];
          if (!missed.includes(id)) set({ missed: [...missed, id] });
          if (dir === -1 && chapter > 0) go(chapter - 1, stepCount(chapterIds[chapter - 1]) - 1, -1);
          else nextChapter();
        },

        openPrompt: () => set({ prompt: true }),
        closePrompt: () => set({ prompt: false }),
        later: () => set({ phase: "off", status: "later", prompt: false }),
        toBrief: () => set({ phase: "brief", prompt: false }),
        finish: () => set({ phase: "off", status: "done", at: null, prompt: false }),
        markRead: () => {
          const { chapterIds, chapter, read } = get();
          const id = chapterIds[chapter];
          if (id && !read.includes(id)) set({ read: [...read, id] });
        },
        markBriefRead: () => set({ briefRead: true }),
        setAway: (away) => set({ away }),
        markStarted: () => set({ started: true }),
      };
    },
    {
      name: TOUR_KEY,
      storage: createJSONStorage(() => settingsStorage),
      partialize: ({ status, at: place, missed }): Saved => ({ status, at: place, missed }),
    },
  ),
);

/** Whether Next still waits: once per chapter, on the first run only */
export function waiting(state: Pick<TourState, "gated" | "read" | "chapterIds" | "chapter">): boolean {
  return state.gated && !state.read.includes(state.chapterIds[state.chapter]);
}

/** Whether the short version still waits */
export function briefWaiting(state: Pick<TourState, "gated" | "briefRead">): boolean {
  return state.gated && !state.briefRead;
}

export function lastStep(state: Pick<TourState, "chapterIds" | "chapter" | "step">): boolean {
  return state.chapter === state.chapterIds.length - 1 && state.step === stepCount(state.chapterIds[state.chapter]) - 1;
}
